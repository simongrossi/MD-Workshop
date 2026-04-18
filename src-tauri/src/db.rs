use rayon::prelude::*;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, OnceLock},
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

#[derive(Debug, Serialize, Clone)]
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

/// Base directory for all workspace indexes, resolved once at app startup
/// via `app.path().app_data_dir()`. Every workspace gets its own
/// `<digest>/index.db` subdirectory below this base.
static INDEX_BASE: OnceLock<PathBuf> = OnceLock::new();

/// Initialise the global index base directory. Must be called once at setup,
/// before the first Tauri command tries to open a connection.
pub fn init_index_base(base: PathBuf) -> Result<(), String> {
    INDEX_BASE
        .set(base)
        .map_err(|_| "Index base déjà initialisée.".to_string())
}

/// Short, stable, per-workspace identifier derived from the canonical root
/// path. A non-crypto hash is enough here — we only need to avoid collisions
/// between workspaces on the same machine, not resist adversarial input.
fn workspace_digest(root: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    crate::normalize_path(root).to_ascii_lowercase().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn db_dir(root: &Path) -> PathBuf {
    let base = INDEX_BASE
        .get()
        .expect("INDEX_BASE non initialisée — vérifier le setup hook Tauri.");
    base.join(workspace_digest(root))
}

/// Record the workspace ↔ digest mapping in a best-effort `registry.json`
/// stored alongside the per-workspace index directories. Used to diagnose
/// "which folder maps to this hash" and, later, to clean up orphan indexes
/// from Settings. Silent on any I/O error — the registry is auxiliary data.
fn update_registry(root: &Path) {
    let Some(base) = INDEX_BASE.get() else {
        return;
    };
    let registry_path = base.join("registry.json");
    let digest = workspace_digest(root);
    let canonical = crate::normalize_path(root);

    let mut map: HashMap<String, String> = fs::read_to_string(&registry_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Skip the write if the entry is already correct — avoids unnecessary
    // disk churn when repeatedly opening the same workspace.
    if map.get(&digest).map(|s| s.as_str()) == Some(canonical.as_str()) {
        return;
    }
    map.insert(digest, canonical);

    if let Ok(serialized) = serde_json::to_string_pretty(&map) {
        let _ = fs::write(&registry_path, serialized);
    }
}

/// Process-wide pool of SQLite connections keyed by canonical root path.
/// Reusing a connection avoids re-running `open_index` (file open +
/// PRAGMA batch + schema bootstrap) on every Tauri command.
static CONN_POOL: OnceLock<Mutex<HashMap<String, Arc<Mutex<Connection>>>>> = OnceLock::new();

fn conn_pool() -> &'static Mutex<HashMap<String, Arc<Mutex<Connection>>>> {
    CONN_POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Handle to a pooled connection. Lock it via [`ConnHandle::lock`] to run
/// queries; the handle keeps the underlying `Arc<Mutex<Connection>>` alive.
pub struct ConnHandle(Arc<Mutex<Connection>>);

impl ConnHandle {
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(|_| "Connexion SQLite corrompue.".to_string())
    }
}

/// Return a pooled connection for the given workspace, opening it on first use.
pub fn get_connection(root: &Path) -> Result<ConnHandle, String> {
    let key = crate::normalize_path(root);
    let mut map = conn_pool().lock().map_err(|_| "Pool SQLite corrompu.".to_string())?;
    if let Some(arc) = map.get(&key) {
        return Ok(ConnHandle(Arc::clone(arc)));
    }
    let conn = open_index(root)?;
    let arc = Arc::new(Mutex::new(conn));
    map.insert(key, Arc::clone(&arc));
    update_registry(root);
    Ok(ConnHandle(arc))
}

pub fn open_index(root: &Path) -> Result<Connection, String> {
    let dir = db_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {dir:?}: {e}"))?;

    let db_path = dir.join("index.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // WAL + NORMAL sync: good durability with much less fsync traffic.
    // mmap_size / cache_size / temp_store: keep hot index pages in memory.
    // On a 10k-file workspace this can cut FTS query time by 30-50%.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA mmap_size = 268435456;
         PRAGMA cache_size = -20000;
         PRAGMA temp_store = MEMORY;",
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

pub fn remove_indexed_file(conn: &Connection, path: &str) -> Result<(), String> {
    remove_file_from_index(conn, path)
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

    let mut seen: HashSet<String> = HashSet::new();
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
            let raw = &cap[1];
            if !seen.contains(raw) {
                seen.insert(raw.to_string());
                tags.push(raw.to_string());
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

/// Returns true when the FTS index has at least one indexed file. Callers can
/// use this to decide between a fast FTS candidate lookup and a full disk
/// walk fallback (fresh workspaces have an empty index).
pub fn index_has_files(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT 1 FROM indexed_files LIMIT 1", [], |_| Ok(true))
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other.to_string()),
        })
}

/// Returns ordered candidate paths matching the FTS query. Used to narrow the
/// set of files that need a line-level regex pass for SearchPanel results.
pub fn search_fts_paths(conn: &Connection, query: &str, limit: i64) -> Result<Vec<String>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

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
            "SELECT f.path FROM fts_content
             JOIN indexed_files f ON f.path = fts_content.path
             WHERE fts_content MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(params![fts_query, limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

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

/// Hard cap on the number of backlinks we return in one call. `find_link_context`
/// reads each source file from disk, so running unbounded is the real cost for
/// heavily linked hub files — 200 is more than the panel ever shows anyway.
const BACKLINKS_LIMIT: i64 = 200;

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
                 WHERE wl.target_name = ?1 COLLATE NOCASE
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![stem, BACKLINKS_LIMIT], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            if results.len() >= BACKLINKS_LIMIT as usize {
                break;
            }
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
        let remaining = (BACKLINKS_LIMIT as usize).saturating_sub(results.len()) as i64;
        if remaining > 0 {
            let mut stmt = conn
                .prepare(
                    "SELECT DISTINCT f.path, f.relative_path, f.name
                     FROM md_links ml
                     JOIN indexed_files f ON f.path = ml.source_path
                     WHERE ml.target_href LIKE ?1
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;

            let pattern = format!("%{}", rel.replace('/', "%"));
            let rows = stmt
                .query_map(params![pattern, remaining], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;

            for row in rows.flatten() {
                if results.len() >= BACKLINKS_LIMIT as usize {
                    break;
                }
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

// ── Graph data ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct GraphNode {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub tags: Vec<String>,
    pub degree: usize,
    pub is_unresolved: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

struct FileRow {
    path: String,
    relative_path: String,
    name: String,
}

struct Resolver {
    by_stem: HashMap<String, String>,         // lowercase stem -> path
    by_rel: HashMap<String, String>,          // lowercase normalized relative -> path
    by_rel_no_ext: HashMap<String, String>,   // lowercase relative without extension -> path
}

fn load_files(conn: &Connection) -> Result<Vec<FileRow>, String> {
    let mut stmt = conn
        .prepare("SELECT path, relative_path, name FROM indexed_files")
        .map_err(|e| e.to_string())?;
    let rows: Vec<FileRow> = stmt
        .query_map([], |row| {
            Ok(FileRow {
                path: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn build_resolver(files: &[FileRow]) -> Resolver {
    let mut by_stem: HashMap<String, String> = HashMap::new();
    let mut by_rel: HashMap<String, String> = HashMap::new();
    let mut by_rel_no_ext: HashMap<String, String> = HashMap::new();
    for f in files {
        let stem = Path::new(&f.name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        by_stem.entry(stem).or_insert_with(|| f.path.clone());

        let rel_norm = f.relative_path.replace('\\', "/").to_ascii_lowercase();
        by_rel.insert(rel_norm.clone(), f.path.clone());
        if let Some((no_ext, _)) = rel_norm.rsplit_once('.') {
            by_rel_no_ext
                .entry(no_ext.to_string())
                .or_insert_with(|| f.path.clone());
        }
    }
    Resolver {
        by_stem,
        by_rel,
        by_rel_no_ext,
    }
}

fn resolve_wiki(target: &str, r: &Resolver) -> Option<String> {
    let t = target.trim().to_ascii_lowercase();
    let t_no_ext = t
        .rsplit_once('.')
        .map(|(s, _)| s.to_string())
        .unwrap_or_else(|| t.clone());
    if let Some(p) = r.by_stem.get(&t_no_ext) {
        return Some(p.clone());
    }
    if let Some(p) = r.by_rel.get(&t) {
        return Some(p.clone());
    }
    if let Some(p) = r.by_rel_no_ext.get(&t_no_ext) {
        return Some(p.clone());
    }
    None
}

fn resolve_md(source_path: &str, href: &str, r: &Resolver) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") || href.starts_with("mailto:") {
        return None;
    }
    let source_dir = Path::new(source_path).parent()?;
    let joined = source_dir.join(href);
    if let Ok(canon) = fs::canonicalize(&joined) {
        let norm = normalize_path(&canon);
        // Match by relative path (case-insensitive)
        let rel_norm = norm.replace('\\', "/").to_ascii_lowercase();
        for (rel, path) in r.by_rel.iter() {
            if rel_norm.ends_with(rel) {
                return Some(path.clone());
            }
        }
    }
    // Fallback: direct lookup by href-as-relative
    let href_norm = href.replace('\\', "/").to_ascii_lowercase();
    if let Some(p) = r.by_rel.get(&href_norm) {
        return Some(p.clone());
    }
    None
}

fn tags_map(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut stmt = conn
        .prepare("SELECT file_path, tag FROM tags")
        .map_err(|e| e.to_string())?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for (path, tag) in rows.filter_map(|r| r.ok()) {
        map.entry(path).or_default().push(tag);
    }
    Ok(map)
}

fn load_edges_for(
    conn: &Connection,
    source_path: &str,
    r: &Resolver,
) -> Result<Vec<(String, String, String)>, String> {
    // Returns (source_path, target_path_or_unresolved_key, kind)
    let mut edges: Vec<(String, String, String)> = Vec::new();

    {
        let mut stmt = conn
            .prepare("SELECT target_name FROM wiki_links WHERE source_path = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![source_path], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for target in rows.filter_map(|r| r.ok()) {
            let resolved = resolve_wiki(&target, r)
                .unwrap_or_else(|| format!("__unresolved::{}", target.to_ascii_lowercase()));
            if resolved != source_path {
                edges.push((source_path.to_string(), resolved, "wiki".to_string()));
            }
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT target_href FROM md_links WHERE source_path = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![source_path], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for href in rows.filter_map(|r| r.ok()) {
            if let Some(resolved) = resolve_md(source_path, &href, r) {
                if resolved != source_path {
                    edges.push((source_path.to_string(), resolved, "md".to_string()));
                }
            }
        }
    }

    Ok(edges)
}

pub fn get_graph_global(
    conn: &Connection,
    filter_folder: Option<&str>,
    filter_tags: &[String],
    include_orphans: bool,
) -> Result<GraphData, String> {
    let files = load_files(conn)?;
    let resolver = build_resolver(&files);
    let tags = tags_map(conn)?;

    // Candidate node set after filtering
    let folder_norm = filter_folder
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_matches('/').to_string());

    let filter_tags_lower: HashSet<String> = filter_tags
        .iter()
        .map(|t| t.to_ascii_lowercase())
        .collect();

    let mut candidates: HashMap<String, &FileRow> = HashMap::new();
    for f in &files {
        if let Some(ref folder) = folder_norm {
            let rel = f.relative_path.replace('\\', "/");
            if !rel.starts_with(&format!("{}/", folder)) && rel != *folder {
                continue;
            }
        }
        if !filter_tags_lower.is_empty() {
            let file_tags = tags.get(&f.path).cloned().unwrap_or_default();
            let file_tags_lower: HashSet<String> =
                file_tags.iter().map(|t| t.to_ascii_lowercase()).collect();
            if !filter_tags_lower.iter().all(|t| file_tags_lower.contains(t)) {
                continue;
            }
        }
        candidates.insert(f.path.clone(), f);
    }

    // Collect edges where BOTH endpoints are candidates
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut degree: HashMap<String, usize> = HashMap::new();
    let mut unresolved_targets: HashMap<String, (String, usize)> = HashMap::new();

    for (_, f) in candidates.iter() {
        let raw_edges = load_edges_for(conn, &f.path, &resolver)?;
        for (src, tgt, kind) in raw_edges {
            if tgt.starts_with("__unresolved::") {
                // Only relevant for local view typically, but we can keep counts
                let display = tgt.trim_start_matches("__unresolved::").to_string();
                let entry = unresolved_targets
                    .entry(tgt.clone())
                    .or_insert_with(|| (display, 0));
                entry.1 += 1;
                *degree.entry(src.clone()).or_insert(0) += 1;
                *degree.entry(tgt.clone()).or_insert(0) += 1;
                edges.push(GraphEdge {
                    source: src,
                    target: tgt,
                    kind,
                });
                continue;
            }
            if candidates.contains_key(&tgt) {
                *degree.entry(src.clone()).or_insert(0) += 1;
                *degree.entry(tgt.clone()).or_insert(0) += 1;
                edges.push(GraphEdge {
                    source: src,
                    target: tgt,
                    kind,
                });
            }
        }
    }

    // Build nodes
    let mut nodes: Vec<GraphNode> = Vec::new();
    for (path, f) in candidates.iter() {
        let d = *degree.get(path).unwrap_or(&0);
        if !include_orphans && d == 0 {
            continue;
        }
        nodes.push(GraphNode {
            path: path.clone(),
            relative_path: f.relative_path.clone(),
            name: Path::new(&f.name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&f.name)
                .to_string(),
            tags: tags.get(path).cloned().unwrap_or_default(),
            degree: d,
            is_unresolved: false,
        });
    }
    for (key, (display, d)) in unresolved_targets.iter() {
        nodes.push(GraphNode {
            path: key.clone(),
            relative_path: display.clone(),
            name: display.clone(),
            tags: Vec::new(),
            degree: *d,
            is_unresolved: true,
        });
    }

    // Drop edges referring to nodes we didn't keep (orphans filtered)
    let node_keys: HashSet<String> = nodes.iter().map(|n| n.path.clone()).collect();
    edges.retain(|e| node_keys.contains(&e.source) && node_keys.contains(&e.target));

    Ok(GraphData { nodes, edges })
}

pub fn get_graph_local(
    conn: &Connection,
    file_path: &str,
    depth: u32,
) -> Result<GraphData, String> {
    let files = load_files(conn)?;
    let resolver = build_resolver(&files);
    let tags = tags_map(conn)?;
    let by_path: HashMap<String, &FileRow> = files.iter().map(|f| (f.path.clone(), f)).collect();

    // Verify the starting file exists
    if !by_path.contains_key(file_path) {
        return Ok(GraphData {
            nodes: Vec::new(),
            edges: Vec::new(),
        });
    }

    // BFS
    let mut visited: HashSet<String> = HashSet::new();
    let mut frontier: Vec<String> = vec![file_path.to_string()];
    visited.insert(file_path.to_string());

    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut unresolved_display: HashMap<String, String> = HashMap::new();
    let max_depth = depth.max(1);

    for _ in 0..max_depth {
        let mut next_frontier: Vec<String> = Vec::new();
        for node in &frontier {
            if node.starts_with("__unresolved::") {
                continue;
            }

            // Outgoing
            let out_edges = load_edges_for(conn, node, &resolver)?;
            for (src, tgt, kind) in out_edges {
                if tgt.starts_with("__unresolved::") {
                    let display = tgt.trim_start_matches("__unresolved::").to_string();
                    unresolved_display.insert(tgt.clone(), display);
                }
                edges.push(GraphEdge {
                    source: src.clone(),
                    target: tgt.clone(),
                    kind,
                });
                if visited.insert(tgt.clone()) {
                    next_frontier.push(tgt);
                }
            }

            // Incoming (backlinks via wiki_links and md_links)
            let stem = by_path
                .get(node)
                .map(|f| {
                    Path::new(&f.name)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string()
                })
                .unwrap_or_default();

            if !stem.is_empty() {
                let mut stmt = conn
                    .prepare(
                        "SELECT DISTINCT source_path FROM wiki_links WHERE target_name = ?1 COLLATE NOCASE",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![stem], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                for src in rows.filter_map(|r| r.ok()) {
                    if src == *node {
                        continue;
                    }
                    edges.push(GraphEdge {
                        source: src.clone(),
                        target: node.clone(),
                        kind: "wiki".to_string(),
                    });
                    if visited.insert(src.clone()) {
                        next_frontier.push(src);
                    }
                }
            }

            if let Some(f) = by_path.get(node) {
                let rel_norm = f.relative_path.replace('\\', "/");
                let pattern = format!("%{}", rel_norm.replace('/', "%"));
                let mut stmt = conn
                    .prepare(
                        "SELECT DISTINCT source_path FROM md_links WHERE target_href LIKE ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![pattern], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                for src in rows.filter_map(|r| r.ok()) {
                    if src == *node {
                        continue;
                    }
                    edges.push(GraphEdge {
                        source: src.clone(),
                        target: node.clone(),
                        kind: "md".to_string(),
                    });
                    if visited.insert(src.clone()) {
                        next_frontier.push(src);
                    }
                }
            }
        }
        frontier = next_frontier;
        if frontier.is_empty() {
            break;
        }
    }

    // Dedup edges
    let mut seen_edges: HashSet<(String, String, String)> = HashSet::new();
    edges.retain(|e| seen_edges.insert((e.source.clone(), e.target.clone(), e.kind.clone())));

    // Compute degrees
    let mut degree: HashMap<String, usize> = HashMap::new();
    for e in &edges {
        *degree.entry(e.source.clone()).or_insert(0) += 1;
        *degree.entry(e.target.clone()).or_insert(0) += 1;
    }

    // Build nodes
    let mut nodes: Vec<GraphNode> = Vec::new();
    for key in &visited {
        if let Some(display) = unresolved_display.get(key) {
            nodes.push(GraphNode {
                path: key.clone(),
                relative_path: display.clone(),
                name: display.clone(),
                tags: Vec::new(),
                degree: *degree.get(key).unwrap_or(&0),
                is_unresolved: true,
            });
        } else if let Some(f) = by_path.get(key) {
            nodes.push(GraphNode {
                path: key.clone(),
                relative_path: f.relative_path.clone(),
                name: Path::new(&f.name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&f.name)
                    .to_string(),
                tags: tags.get(key).cloned().unwrap_or_default(),
                degree: *degree.get(key).unwrap_or(&0),
                is_unresolved: false,
            });
        }
    }

    Ok(GraphData { nodes, edges })
}
