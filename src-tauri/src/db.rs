use rayon::prelude::*;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Instant, UNIX_EPOCH},
};
use walkdir::WalkDir;

use crate::{is_markdown, normalize_path, relative_from_root, should_skip_entry};

// Shared compiled regexes. Compiling once instead of on every file
// noticeably reduces the per-file overhead when parsing a large workspace.
fn wiki_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]").unwrap())
}

fn md_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(?:[^\]]*)\]\(([^)]+\.(?:md|markdown|mdx))\)").unwrap())
}

fn inline_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)#([a-zA-Z\p{L}][a-zA-Z0-9\p{L}_/-]*)").unwrap())
}

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct IndexStats {
    pub files_indexed: usize,
    pub links_found: usize,
    pub tags_found: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct BacklinkEntry {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub context_line: String,
}

#[derive(Debug, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct FtsResult {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub snippet: String,
}

// ── Database connection ──────────────────────────────────────────────

fn db_dir(root: &Path) -> PathBuf {
    root.join(".md-workshop")
}

pub fn open_index(root: &Path) -> Result<Connection, String> {
    let dir = db_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {dir:?}: {e}"))?;

    let db_path = dir.join("index.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| e.to_string())?;

    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS indexed_files (
            path          TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            name          TEXT NOT NULL,
            modified_unix INTEGER,
            size          INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
            path     UNINDEXED,
            name,
            content,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TABLE IF NOT EXISTS wiki_links (
            source_path TEXT NOT NULL,
            target_name TEXT NOT NULL COLLATE NOCASE,
            FOREIGN KEY (source_path) REFERENCES indexed_files(path) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS md_links (
            source_path TEXT NOT NULL,
            target_href TEXT NOT NULL,
            FOREIGN KEY (source_path) REFERENCES indexed_files(path) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            file_path TEXT NOT NULL,
            tag       TEXT NOT NULL COLLATE NOCASE,
            source    TEXT NOT NULL CHECK(source IN ('inline', 'frontmatter')),
            FOREIGN KEY (file_path) REFERENCES indexed_files(path) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_wl_source ON wiki_links(source_path);
        CREATE INDEX IF NOT EXISTS idx_wl_target ON wiki_links(target_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_ml_source ON md_links(source_path);
        CREATE INDEX IF NOT EXISTS idx_tags_file  ON tags(file_path);
        CREATE INDEX IF NOT EXISTS idx_tags_tag   ON tags(tag COLLATE NOCASE);",
    )
    .map_err(|e| e.to_string())
}

// ── Incremental indexing ─────────────────────────────────────────────

struct FileOnDisk {
    path: PathBuf,
    modified_unix: Option<i64>,
    size: u64,
}

struct IndexedFile {
    path: String,
    modified_unix: Option<i64>,
    size: i64,
}

/// A file whose contents have already been read and parsed off the SQLite
/// thread. Holding the results lets us batch the actual DB writes serially
/// while the expensive I/O + regex work happens on the rayon pool.
struct ParsedFile {
    norm_path: String,
    rel_path: String,
    name: String,
    modified_unix: Option<i64>,
    size: u64,
    content: String,
    wiki_links: Vec<String>,
    md_links: Vec<String>,
    inline_tags: Vec<String>,
    fm_tags: Vec<String>,
}

pub fn reindex(conn: &Connection, root: &Path) -> Result<IndexStats, String> {
    let start = Instant::now();

    // 1. Walk filesystem
    let on_disk: Vec<FileOnDisk> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !should_skip_entry(e))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_markdown(e.path()))
        .filter_map(|e| {
            let meta = fs::metadata(e.path()).ok()?;
            let modified_unix = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            Some(FileOnDisk {
                path: e.into_path(),
                modified_unix,
                size: meta.len(),
            })
        })
        .collect();

    // 2. Load what's in the DB
    let mut stmt = conn
        .prepare("SELECT path, modified_unix, size FROM indexed_files")
        .map_err(|e| e.to_string())?;
    let in_db: Vec<IndexedFile> = stmt
        .query_map([], |row| {
            Ok(IndexedFile {
                path: row.get(0)?,
                modified_unix: row.get(1)?,
                size: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let disk_paths: HashSet<String> = on_disk.iter().map(|f| normalize_path(&f.path)).collect();
    let db_paths: HashSet<String> = in_db.iter().map(|f| f.path.clone()).collect();

    // 3. Determine what changed
    let deleted: Vec<&str> = in_db
        .iter()
        .filter(|f| !disk_paths.contains(&f.path))
        .map(|f| f.path.as_str())
        .collect();

    let new_or_modified: Vec<&FileOnDisk> = on_disk
        .iter()
        .filter(|f| {
            let norm = normalize_path(&f.path);
            if !db_paths.contains(&norm) {
                return true; // new file
            }
            // Check if modified
            let db_entry = in_db.iter().find(|d| d.path == norm);
            match db_entry {
                Some(d) => d.modified_unix != f.modified_unix || d.size != f.size as i64,
                None => true,
            }
        })
        .collect();

    // 4. Read + parse new/modified files in parallel (off the SQLite thread)
    let parsed: Vec<ParsedFile> = new_or_modified
        .par_iter()
        .filter_map(|file| {
            let content = fs::read_to_string(&file.path).ok()?;
            let name = file
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.md")
                .to_string();
            let wiki_links = extract_wiki_links(&content);
            let md_links = extract_md_links(&content);
            let inline_tags = extract_inline_tags(&content);
            let fm_tags = extract_frontmatter_tags(&content);
            Some(ParsedFile {
                norm_path: normalize_path(&file.path),
                rel_path: relative_from_root(root, &file.path),
                name,
                modified_unix: file.modified_unix,
                size: file.size,
                content,
                wiki_links,
                md_links,
                inline_tags,
                fm_tags,
            })
        })
        .collect();

    // 5. Apply all DB changes in a single transaction on the main thread
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;

    for path in &deleted {
        remove_file_from_index(conn, path)?;
    }

    let mut total_links = 0usize;
    let mut total_tags = 0usize;

    for p in &parsed {
        let (links, tags) = write_parsed_file(conn, p)?;
        total_links += links;
        total_tags += tags;
    }

    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

    Ok(IndexStats {
        files_indexed: parsed.len(),
        links_found: total_links,
        tags_found: total_tags,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn write_parsed_file(conn: &Connection, p: &ParsedFile) -> Result<(usize, usize), String> {
    remove_file_from_index(conn, &p.norm_path)?;

    conn.execute(
        "INSERT INTO indexed_files (path, relative_path, name, modified_unix, size)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![p.norm_path, p.rel_path, p.name, p.modified_unix, p.size as i64],
    )
    .map_err(|e| e.to_string())?;

    let body = strip_front_matter(&p.content);
    conn.execute(
        "INSERT INTO fts_content (path, name, content) VALUES (?1, ?2, ?3)",
        params![p.norm_path, p.name, body],
    )
    .map_err(|e| e.to_string())?;

    for target in &p.wiki_links {
        conn.execute(
            "INSERT INTO wiki_links (source_path, target_name) VALUES (?1, ?2)",
            params![p.norm_path, target],
        )
        .map_err(|e| e.to_string())?;
    }

    for href in &p.md_links {
        conn.execute(
            "INSERT INTO md_links (source_path, target_href) VALUES (?1, ?2)",
            params![p.norm_path, href],
        )
        .map_err(|e| e.to_string())?;
    }

    for tag in &p.inline_tags {
        conn.execute(
            "INSERT INTO tags (file_path, tag, source) VALUES (?1, ?2, 'inline')",
            params![p.norm_path, tag],
        )
        .map_err(|e| e.to_string())?;
    }

    for tag in &p.fm_tags {
        conn.execute(
            "INSERT INTO tags (file_path, tag, source) VALUES (?1, ?2, 'frontmatter')",
            params![p.norm_path, tag],
        )
        .map_err(|e| e.to_string())?;
    }

    let link_count = p.wiki_links.len() + p.md_links.len();
    let tag_count = p.inline_tags.len() + p.fm_tags.len();
    Ok((link_count, tag_count))
}

fn remove_file_from_index(conn: &Connection, path: &str) -> Result<(), String> {
    conn.execute("DELETE FROM wiki_links WHERE source_path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM md_links WHERE source_path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE file_path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM fts_content WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM indexed_files WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn index_file_content(
    conn: &Connection,
    path: &str,
    rel_path: &str,
    name: &str,
    file: &FileOnDisk,
    content: &str,
) -> Result<(usize, usize), String> {
    // Remove old data if re-indexing
    remove_file_from_index(conn, path)?;

    // Insert file metadata
    conn.execute(
        "INSERT INTO indexed_files (path, relative_path, name, modified_unix, size)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![path, rel_path, name, file.modified_unix, file.size as i64],
    )
    .map_err(|e| e.to_string())?;

    // Strip front matter for FTS content
    let body = strip_front_matter(content);

    // FTS
    conn.execute(
        "INSERT INTO fts_content (path, name, content) VALUES (?1, ?2, ?3)",
        params![path, name, body],
    )
    .map_err(|e| e.to_string())?;

    // Extract & store wiki-links
    let wiki_links = extract_wiki_links(content);
    for target in &wiki_links {
        conn.execute(
            "INSERT INTO wiki_links (source_path, target_name) VALUES (?1, ?2)",
            params![path, target],
        )
        .map_err(|e| e.to_string())?;
    }

    // Extract & store markdown links
    let md_links = extract_md_links(content);
    for href in &md_links {
        conn.execute(
            "INSERT INTO md_links (source_path, target_href) VALUES (?1, ?2)",
            params![path, href],
        )
        .map_err(|e| e.to_string())?;
    }

    // Extract & store tags
    let inline_tags = extract_inline_tags(content);
    let fm_tags = extract_frontmatter_tags(content);

    for tag in &inline_tags {
        conn.execute(
            "INSERT INTO tags (file_path, tag, source) VALUES (?1, ?2, 'inline')",
            params![path, tag],
        )
        .map_err(|e| e.to_string())?;
    }

    for tag in &fm_tags {
        conn.execute(
            "INSERT INTO tags (file_path, tag, source) VALUES (?1, ?2, 'frontmatter')",
            params![path, tag],
        )
        .map_err(|e| e.to_string())?;
    }

    let link_count = wiki_links.len() + md_links.len();
    let tag_count = inline_tags.len() + fm_tags.len();
    Ok((link_count, tag_count))
}

pub fn index_single_file(conn: &Connection, root: &Path, file_path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let meta = fs::metadata(file_path).map_err(|e| e.to_string())?;
    let modified_unix = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let file = FileOnDisk {
        path: file_path.to_path_buf(),
        modified_unix,
        size: meta.len(),
    };

    let norm_path = normalize_path(file_path);
    let rel_path = relative_from_root(root, file_path);
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.md")
        .to_string();

    index_file_content(conn, &norm_path, &rel_path, &name, &file, &content)?;
    Ok(())
}

// ── Parsing ──────────────────────────────────────────────────────────

fn strip_front_matter(content: &str) -> &str {
    let normalized = content;
    if !normalized.starts_with("---") {
        return normalized;
    }
    // Find the closing ---
    if let Some(end) = normalized[3..].find("\n---") {
        let skip = 3 + end + 4; // "---" + content + "\n---"
        if skip < normalized.len() {
            return &normalized[skip..];
        }
    }
    normalized
}

fn extract_wiki_links(content: &str) -> Vec<String> {
    wiki_link_re()
        .captures_iter(content)
        .map(|cap| cap[1].trim().to_string())
        .collect()
}

fn extract_md_links(content: &str) -> Vec<String> {
    md_link_re()
        .captures_iter(content)
        .map(|cap| cap[1].trim().to_string())
        .collect()
}

fn extract_inline_tags(content: &str) -> Vec<String> {
    let body = strip_front_matter(content);
    let re = inline_tag_re();

    let mut tags: Vec<String> = Vec::new();
    let mut in_code_block = false;

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        // Skip headings (# Heading)
        if trimmed.starts_with('#') && trimmed.chars().nth(1).map_or(true, |c| c == ' ' || c == '#') {
            continue;
        }

        for cap in re.captures_iter(line) {
            let tag = cap[1].to_string();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }

    tags
}

fn extract_frontmatter_tags(content: &str) -> Vec<String> {
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return Vec::new();
    }

    let fm_end = match normalized[4..].find("\n---") {
        Some(pos) => pos + 4,
        None => return Vec::new(),
    };

    let front_matter = &normalized[4..fm_end];
    let mut tags = Vec::new();

    // Match inline array: tags: [tag1, tag2, tag3]
    let re_inline = Regex::new(r"(?m)^tags:\s*\[([^\]]+)\]").unwrap();
    if let Some(cap) = re_inline.captures(front_matter) {
        for item in cap[1].split(',') {
            let tag = item.trim().trim_matches('"').trim_matches('\'').trim();
            if !tag.is_empty() {
                tags.push(tag.to_string());
            }
        }
        return tags;
    }

    // Match YAML list:
    // tags:
    //   - tag1
    //   - tag2
    let re_list = Regex::new(r"(?m)^tags:\s*\n((?:\s+-\s+.+\n?)+)").unwrap();
    if let Some(cap) = re_list.captures(front_matter) {
        let re_item = Regex::new(r"(?m)^\s+-\s+(.+)$").unwrap();
        for item_cap in re_item.captures_iter(&cap[1]) {
            let tag = item_cap[1].trim().trim_matches('"').trim_matches('\'').trim();
            if !tag.is_empty() {
                tags.push(tag.to_string());
            }
        }
    }

    tags
}

// ── Queries ──────────────────────────────────────────────────────────

pub fn search_fts(conn: &Connection, query: &str) -> Result<Vec<FtsResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Escape FTS5 special characters and add prefix matching
    let fts_query = trimmed
        .split_whitespace()
        .map(|word| {
            let escaped = word.replace('"', "\"\"");
            format!("\"{escaped}\"*")
        })
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.relative_path, f.name, snippet(fts_content, 2, '→', '←', '…', 32)
             FROM fts_content
             JOIN indexed_files f ON f.path = fts_content.path
             WHERE fts_content MATCH ?1
             ORDER BY rank
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(params![fts_query], |row| {
            Ok(FtsResult {
                path: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                snippet: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

pub fn get_backlinks(conn: &Connection, file_path: &str) -> Result<Vec<BacklinkEntry>, String> {
    // Get the target file's name without extension for wiki-link matching
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let rel_path_of_target = conn
        .query_row(
            "SELECT relative_path FROM indexed_files WHERE path = ?1",
            params![file_path],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let mut results: Vec<BacklinkEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // 1. Wiki-links pointing to this file (match by name stem, case-insensitive)
    {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT f.path, f.relative_path, f.name
                 FROM wiki_links wl
                 JOIN indexed_files f ON f.path = wl.source_path
                 WHERE wl.target_name = ?1 COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![stem], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            if row.0 != file_path && seen.insert(row.0.clone()) {
                let context = find_link_context(&row.0, stem);
                results.push(BacklinkEntry {
                    path: row.0,
                    relative_path: row.1,
                    name: row.2,
                    context_line: context,
                });
            }
        }
    }

    // 2. Markdown links pointing to this file (match by relative path)
    if let Some(ref rel) = rel_path_of_target {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT f.path, f.relative_path, f.name
                 FROM md_links ml
                 JOIN indexed_files f ON f.path = ml.source_path
                 WHERE ml.target_href LIKE ?1",
            )
            .map_err(|e| e.to_string())?;

        let pattern = format!("%{}", rel.replace('/', "%"));
        let rows = stmt
            .query_map(params![pattern], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            if row.0 != file_path && seen.insert(row.0.clone()) {
                results.push(BacklinkEntry {
                    path: row.0,
                    relative_path: row.1,
                    name: row.2,
                    context_line: String::new(),
                });
            }
        }
    }

    results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(results)
}

fn find_link_context(source_path: &str, target_stem: &str) -> String {
    let content = match fs::read_to_string(source_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let needle_lower = target_stem.to_lowercase();

    for line in content.lines() {
        let lower = line.to_lowercase();
        if lower.contains(&format!("[[{needle_lower}"))
            || lower.contains(&format!("[[{needle_lower}|"))
        {
            return line.trim().to_string();
        }
    }

    String::new()
}

pub fn get_all_tags(conn: &Connection) -> Result<Vec<TagCount>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT tag, COUNT(DISTINCT file_path) as cnt
             FROM tags
             GROUP BY tag COLLATE NOCASE
             ORDER BY cnt DESC, tag ASC",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map([], |row| {
            Ok(TagCount {
                tag: row.get(0)?,
                count: row.get::<_, usize>(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

// ── Broken links ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct BrokenLink {
    /// Absolute path of the file containing the broken link
    pub source_path: String,
    /// Relative path of the source file
    pub source_relative: String,
    /// Display name of the source file
    pub source_name: String,
    /// Target as referenced in the source (wiki-link name or md-link href)
    pub target: String,
    /// Kind: "wiki" for [[...]] or "md" for [](...)
    pub kind: String,
    /// Line number in the source where the link appears (1-based)
    pub line_number: usize,
    /// Excerpt of the line containing the link
    pub context: String,
}

/// Check all wiki-links and relative md-links in the index against the
/// actual file list. Returns links whose target does not resolve.
pub fn find_broken_links(conn: &Connection, root: &Path) -> Result<Vec<BrokenLink>, String> {
    // Build the set of known file stems (lowercase) and relative paths
    let mut known_stems: HashSet<String> = HashSet::new();
    let mut known_relatives: HashSet<String> = HashSet::new();

    {
        let mut stmt = conn
            .prepare("SELECT name, relative_path FROM indexed_files")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.filter_map(|r| r.ok()) {
            let (name, rel) = row;
            // Stem without extension
            let stem = name
                .rsplit_once('.')
                .map(|(s, _)| s)
                .unwrap_or(&name)
                .to_ascii_lowercase();
            known_stems.insert(stem);
            known_relatives.insert(rel.replace('\\', "/").to_ascii_lowercase());
            // Also add the relative path without extension for [[path/to/note]] style
            let rel_norm = rel.replace('\\', "/");
            if let Some(without_ext) = rel_norm.rsplit_once('.').map(|(s, _)| s) {
                known_relatives.insert(without_ext.to_ascii_lowercase());
            }
        }
    }

    // Now iterate through all indexed files and re-parse to get line numbers
    let mut stmt = conn
        .prepare("SELECT path, relative_path, name FROM indexed_files ORDER BY relative_path")
        .map_err(|e| e.to_string())?;

    let files: Vec<(String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let wiki_re = Regex::new(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]").unwrap();
    let md_re = Regex::new(r"\[(?:[^\]]*)\]\(([^)]+\.(?:md|markdown|mdx))\)").unwrap();

    let mut broken: Vec<BrokenLink> = Vec::new();

    for (path, relative_path, name) in files {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, line) in content.lines().enumerate() {
            // Wiki-links
            for cap in wiki_re.captures_iter(line) {
                let target = cap[1].trim().to_string();
                let target_lower = target.to_ascii_lowercase();
                let target_lower_no_ext = target_lower
                    .rsplit_once('.')
                    .map(|(s, _)| s.to_string())
                    .unwrap_or_else(|| target_lower.clone());

                let resolved = known_stems.contains(&target_lower)
                    || known_stems.contains(&target_lower_no_ext)
                    || known_relatives.contains(&target_lower)
                    || known_relatives.contains(&target_lower_no_ext);

                if !resolved {
                    broken.push(BrokenLink {
                        source_path: path.clone(),
                        source_relative: relative_path.clone(),
                        source_name: name.clone(),
                        target,
                        kind: "wiki".to_string(),
                        line_number: line_idx + 1,
                        context: line.trim().to_string(),
                    });
                }
            }

            // Relative md-links
            for cap in md_re.captures_iter(line) {
                let href = cap[1].trim().to_string();

                // Skip absolute URLs
                if href.starts_with("http://")
                    || href.starts_with("https://")
                    || href.starts_with("mailto:")
                {
                    continue;
                }

                // Resolve relative to the file's directory
                let source_dir = Path::new(&path).parent().unwrap_or(root);
                let target_abs = source_dir.join(&href);
                let resolved = target_abs.exists()
                    || fs::canonicalize(&target_abs).is_ok();

                if !resolved {
                    broken.push(BrokenLink {
                        source_path: path.clone(),
                        source_relative: relative_path.clone(),
                        source_name: name.clone(),
                        target: href,
                        kind: "md".to_string(),
                        line_number: line_idx + 1,
                        context: line.trim().to_string(),
                    });
                }
            }
        }
    }

    Ok(broken)
}

pub fn get_files_by_tag(conn: &Connection, tag: &str) -> Result<Vec<FtsResult>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.path, f.relative_path, f.name
             FROM tags t
             JOIN indexed_files f ON f.path = t.file_path
             WHERE t.tag = ?1 COLLATE NOCASE
             ORDER BY f.relative_path",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(params![tag], |row| {
            Ok(FtsResult {
                path: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                snippet: String::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}
