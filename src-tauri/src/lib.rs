mod db;

use anyhow::Context;
use regex::RegexBuilder;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Instant, UNIX_EPOCH},
};
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
struct MarkdownFileEntry {
    path: String,
    relative_path: String,
    name: String,
    modified_unix: Option<i64>,
    size: u64,
}

#[derive(Debug, Serialize)]
struct SearchMatch {
    line_number: usize,
    line: String,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    path: String,
    relative_path: String,
    matches: Vec<SearchMatch>,
}

#[derive(Default)]
struct AssetScopeState {
    current_root: Mutex<Option<PathBuf>>,
}

/// Short-lived cache for `list_markdown_files` results. The UI fires the list
/// command on every tab switch / panel refresh; without a file watcher we
/// cap freshness with a TTL and bust the cache explicitly on any in-app
/// mutation (create/rename/delete/save_as). External edits are still picked
/// up within `FILE_LIST_CACHE_TTL_MS`.
#[derive(Default)]
struct FileListCache {
    entries: Mutex<HashMap<String, CachedFileList>>,
}

struct CachedFileList {
    stored_at: Instant,
    files: Vec<MarkdownFileEntry>,
}

const FILE_LIST_CACHE_TTL_MS: u128 = 1500;

impl FileListCache {
    fn get(&self, root: &str) -> Option<Vec<MarkdownFileEntry>> {
        let map = self.entries.lock().ok()?;
        let cached = map.get(root)?;
        if cached.stored_at.elapsed().as_millis() > FILE_LIST_CACHE_TTL_MS {
            return None;
        }
        Some(cached.files.clone())
    }

    fn put(&self, root: String, files: Vec<MarkdownFileEntry>) {
        if let Ok(mut map) = self.entries.lock() {
            map.insert(
                root,
                CachedFileList {
                    stored_at: Instant::now(),
                    files,
                },
            );
        }
    }

    fn invalidate(&self, root: &str) {
        if let Ok(mut map) = self.entries.lock() {
            map.remove(root);
        }
    }
}

impl Clone for MarkdownFileEntry {
    fn clone(&self) -> Self {
        MarkdownFileEntry {
            path: self.path.clone(),
            relative_path: self.relative_path.clone(),
            name: self.name.clone(),
            modified_unix: self.modified_unix,
            size: self.size,
        }
    }
}

/// Per-workspace cache for `get_all_tags`. The tag aggregation is a join over
/// the whole tags table so recomputing per sidebar render is wasteful when
/// nothing changed. Invalidated on any command that touches workspace files.
#[derive(Default)]
struct TagsCache {
    entries: Mutex<HashMap<String, Vec<db::TagCount>>>,
}

impl TagsCache {
    fn get(&self, root: &str) -> Option<Vec<db::TagCount>> {
        self.entries.lock().ok()?.get(root).cloned()
    }
    fn put(&self, root: String, tags: Vec<db::TagCount>) {
        if let Ok(mut m) = self.entries.lock() {
            m.insert(root, tags);
        }
    }
    fn invalidate(&self, root: &str) {
        if let Ok(mut m) = self.entries.lock() {
            m.remove(root);
        }
    }
}

/// Holds the active notify debouncer for the current workspace. Dropping the
/// previous debouncer (by replacing this Option) stops the old watcher. We
/// keep the debouncer in a Mutex because Tauri commands may swap workspaces
/// concurrently with ongoing events.
#[derive(Default)]
struct WorkspaceWatcher {
    active: Mutex<Option<WatchHandle>>,
}

struct WatchHandle {
    root: PathBuf,
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

pub fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|s| s.to_ascii_lowercase()),
        Some(ext) if ext == "md" || ext == "markdown" || ext == "mdx"
    )
}

pub fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Returns true when a `WalkDir` entry should be pruned. Used with
/// `.filter_entry(|e| !should_skip_entry(e))` so that heavy or irrelevant
/// directories (VCS metadata, dependency folders, build artefacts, hidden
/// dotfolders, our own index dir) are never descended into. Keeping this in
/// one place avoids the app freezing when opening a project-style folder.
pub fn should_skip_entry(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    if !entry.file_type().is_dir() {
        return false;
    }
    let Some(name) = entry.file_name().to_str() else {
        return false;
    };
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | "vendor"
            | "__pycache__"
            | "venv"
    )
}

/// Process-wide cache for `canonicalize_root`. Every Tauri command calls
/// canonicalize_root at least once, each call is a syscall; paths rarely
/// change within a session so caching the resolved form is a net win.
static CANON_CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn canon_cache() -> &'static Mutex<HashMap<String, PathBuf>> {
    CANON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonicalize_root(root_path: &str) -> Result<PathBuf, String> {
    if let Ok(map) = canon_cache().lock() {
        if let Some(cached) = map.get(root_path) {
            return Ok(cached.clone());
        }
    }

    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err("Le dossier n'existe pas.".to_string());
    }
    if !root.is_dir() {
        return Err("Le chemin fourni n'est pas un dossier.".to_string());
    }

    let resolved = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    if let Ok(mut map) = canon_cache().lock() {
        map.insert(root_path.to_string(), resolved.clone());
    }
    Ok(resolved)
}

/// Swap the workspace watcher to a new root. Creating the debouncer starts a
/// background thread; dropping the old one stops the previous watch. Events
/// land on that thread and invalidate caches + re-index on the fly so the UI
/// stays coherent with disk state without polling.
fn start_watching(app: tauri::AppHandle, root: PathBuf) -> Result<(), String> {
    use notify::RecursiveMode;
    use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
    use std::time::Duration;

    let watcher_state = app.state::<WorkspaceWatcher>();

    // Early-out if we're already watching this exact root.
    {
        let guard = watcher_state
            .active
            .lock()
            .map_err(|_| "Watcher state corrompu.".to_string())?;
        if let Some(handle) = guard.as_ref() {
            if handle.root == root {
                return Ok(());
            }
        }
    }

    let watched_root = root.clone();
    let cb_app = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| match res {
            Ok(events) => handle_watch_events(&cb_app, &watched_root, events),
            Err(errors) => eprintln!("md-workshop watcher error: {errors:?}"),
        },
    )
    .map_err(|e| format!("Impossible de créer le watcher : {e}"))?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("Impossible de surveiller {root:?} : {e}"))?;

    let mut guard = watcher_state
        .active
        .lock()
        .map_err(|_| "Watcher state corrompu.".to_string())?;
    *guard = Some(WatchHandle {
        root,
        _debouncer: debouncer,
    });
    Ok(())
}

fn handle_watch_events(
    app: &tauri::AppHandle,
    root: &Path,
    events: Vec<notify_debouncer_mini::DebouncedEvent>,
) {
    let root_key = normalize_path(root);
    let mut invalidate_lists = false;
    let mut changed_md: Vec<PathBuf> = Vec::new();

    for ev in events {
        invalidate_lists = true;
        if is_markdown(&ev.path) {
            changed_md.push(ev.path);
        }
    }

    if !invalidate_lists {
        return;
    }

    if let Some(list_cache) = app.try_state::<FileListCache>() {
        list_cache.invalidate(&root_key);
    }
    if let Some(tags_cache) = app.try_state::<TagsCache>() {
        tags_cache.invalidate(&root_key);
    }

    if changed_md.is_empty() {
        return;
    }

    if let Ok(handle) = db::get_connection(root) {
        if let Ok(conn) = handle.lock() {
            for p in changed_md {
                if p.exists() {
                    db::index_single_file(&conn, root, &p).ok();
                } else if let Ok(norm) = fs::canonicalize(p.parent().unwrap_or(root))
                    .map(|_| normalize_path(&p))
                {
                    db::remove_indexed_file(&conn, &norm).ok();
                }
            }
        }
    }
}

fn ensure_path_is_within_root(root: &Path, target: &Path) -> Result<(), String> {
    target
        .strip_prefix(root)
        .map(|_| ())
        .map_err(|_| "Accès refusé : le fichier demandé est hors du dossier ouvert.".to_string())
}

fn resolve_markdown_file(root_path: &str, file_path: &str) -> Result<PathBuf, String> {
    let root = canonicalize_root(root_path)?;
    let target = fs::canonicalize(file_path).map_err(|e| e.to_string())?;

    if !target.is_file() {
        return Err("Le chemin fourni n'est pas un fichier.".to_string());
    }
    if !is_markdown(&target) {
        return Err("Le fichier demandé n'est pas un Markdown pris en charge.".to_string());
    }

    ensure_path_is_within_root(&root, &target)?;
    Ok(target)
}

#[tauri::command]
fn set_workspace_asset_scope(
    app: tauri::AppHandle,
    state: tauri::State<'_, AssetScopeState>,
    root_path: String,
) -> Result<(), String> {
    let root = canonicalize_root(&root_path)?;
    let asset_scope = app.asset_protocol_scope();
    let mut current_root = state
        .current_root
        .lock()
        .map_err(|_| "Impossible de mettre à jour le scope des assets.".to_string())?;

    if current_root.as_ref() == Some(&root) {
        return Ok(());
    }

    if let Some(previous_root) = current_root.as_ref() {
        asset_scope
            .forbid_directory(previous_root, true)
            .map_err(|e| e.to_string())?;
    }

    asset_scope
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;

    *current_root = Some(root.clone());
    drop(current_root);

    // v0.4.x and earlier stored the SQLite index in `<workspace>/.md-workshop/`.
    // From v0.5.0 it lives under the per-user app-data directory instead, so
    // any legacy folder still sitting inside a workspace is pure garbage —
    // remove it silently on open. The new index will be rebuilt on first use.
    cleanup_legacy_index(&root);

    // Start (or swap) the file-system watcher for this workspace so external
    // edits stay reflected in our caches and SQLite index.
    if let Err(e) = start_watching(app.clone(), root) {
        eprintln!("md-workshop: watcher init failed: {e}");
    }
    Ok(())
}

/// Remove any leftover `.md-workshop/` directory that older versions created
/// at the root of the workspace. Best-effort: never aborts the caller.
fn cleanup_legacy_index(root: &Path) {
    let legacy = root.join(".md-workshop");
    if legacy.is_dir() {
        if let Err(e) = fs::remove_dir_all(&legacy) {
            eprintln!("md-workshop: nettoyage legacy {legacy:?} échoué : {e}");
        }
    }
}

fn has_markdown_extension(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase()),
        Some(ext) if ext == "md" || ext == "markdown" || ext == "mdx"
    )
}

fn ensure_markdown_extension(path: &str) -> String {
    if has_markdown_extension(path) {
        path.to_string()
    } else {
        format!("{path}.md")
    }
}

fn join_workspace_path(base: &Path, input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("Le nom du fichier ne peut pas être vide.".to_string());
    }

    let requested = Path::new(input.trim());
    if requested.is_absolute() {
        return Err("Les chemins absolus ne sont pas autorisés.".to_string());
    }

    let mut joined = base.to_path_buf();
    for component in requested.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => joined.push(segment),
            Component::ParentDir => {
                joined.pop();
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err("Les chemins absolus ne sont pas autorisés.".to_string());
            }
        }
    }

    Ok(joined)
}

fn ensure_directory_exists_within_root(root: &Path, directory: &Path) -> Result<PathBuf, String> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| "Accès refusé : le chemin demandé est hors du dossier ouvert.".to_string())?;

    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("Chemin de dossier invalide.".to_string());
        };

        current.push(segment);
        if current.exists() {
            let resolved = fs::canonicalize(&current).map_err(|e| e.to_string())?;
            ensure_path_is_within_root(root, &resolved)?;
            current = resolved;
            continue;
        }

        fs::create_dir(&current).map_err(|e| e.to_string())?;
        let resolved = fs::canonicalize(&current).map_err(|e| e.to_string())?;
        ensure_path_is_within_root(root, &resolved)?;
        current = resolved;
    }

    Ok(current)
}

fn resolve_writable_markdown_target(
    root: &Path,
    base: &Path,
    requested_path: &str,
    create_parent_dirs: bool,
) -> Result<PathBuf, String> {
    let requested = requested_path.trim();
    if requested.is_empty() {
        return Err("Le nom du fichier ne peut pas être vide.".to_string());
    }

    let joined = join_workspace_path(base, &ensure_markdown_extension(requested))?;
    let parent = joined
        .parent()
        .ok_or_else(|| "Chemin parent introuvable.".to_string())?;

    let resolved_parent = if create_parent_dirs {
        ensure_directory_exists_within_root(root, parent)?
    } else {
        let resolved_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
        ensure_path_is_within_root(root, &resolved_parent)?;
        resolved_parent
    };

    let file_name = joined
        .file_name()
        .ok_or_else(|| "Nom de fichier invalide.".to_string())?;
    let target = resolved_parent.join(file_name);
    ensure_path_is_within_root(root, &target)?;
    Ok(target)
}

pub fn relative_from_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

// ── Existing commands ────────────────────────────────────────────────

#[tauri::command]
fn list_markdown_files(
    root_path: String,
    cache: tauri::State<FileListCache>,
) -> Result<Vec<MarkdownFileEntry>, String> {
    let root = canonicalize_root(&root_path)?;
    let cache_key = normalize_path(&root);

    if let Some(hit) = cache.get(&cache_key) {
        return Ok(hit);
    }

    let mut files = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| !should_skip_entry(e))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_markdown(path) {
            continue;
        }

        // Prefer WalkDir's already-fetched metadata to avoid an extra stat syscall.
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_unix = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);

        files.push(MarkdownFileEntry {
            path: normalize_path(path),
            relative_path: relative_from_root(&root, path),
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.md")
                .to_string(),
            modified_unix,
            size: metadata.len(),
        });
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    cache.put(cache_key, files.clone());
    Ok(files)
}

#[tauri::command]
async fn read_markdown_file(root_path: String, path: String) -> Result<String, String> {
    let target = resolve_markdown_file(&root_path, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(target).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Lecture interrompue : {e}"))?
}

#[tauri::command]
fn save_markdown_file(
    root_path: String,
    path: String,
    content: String,
    tags_cache: tauri::State<TagsCache>,
) -> Result<(), String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_markdown_file(&root_path, &path)?;
    let backup_path = backup_path_for(&target);

    if target.exists() {
        fs::copy(&target, &backup_path)
            .with_context(|| format!("Impossible de créer le backup {:?}", backup_path))
            .map_err(|e| e.to_string())?;
    }

    fs::write(&target, content).map_err(|e| e.to_string())?;

    // Refresh this file's entry in the FTS / link / tag index so backlinks,
    // search and tag lists stay in sync without a full workspace walk.
    if let Ok(handle) = db::get_connection(&root) {
        if let Ok(conn) = handle.lock() {
            db::index_single_file(&conn, &root, &target).ok();
        }
    }
    tags_cache.invalidate(&normalize_path(&root));
    Ok(())
}

fn backup_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    path.with_file_name(format!("{}.bak", file_name))
}

#[derive(Debug, Serialize)]
struct PdfConversionResult {
    pdf_type: String,
    markdown: Option<String>,
    page_count: u32,
    pages_needing_ocr: Vec<u32>,
    title: Option<String>,
}

fn do_convert_pdf(bytes: &[u8]) -> Result<PdfConversionResult, String> {
    let result = pdf_inspector::process_pdf_mem(bytes)
        .map_err(|e| format!("Échec de l'analyse du PDF : {e}"))?;

    let pdf_type = match result.pdf_type {
        pdf_inspector::PdfType::TextBased => "text_based",
        pdf_inspector::PdfType::Scanned => "scanned",
        pdf_inspector::PdfType::ImageBased => "image_based",
        pdf_inspector::PdfType::Mixed => "mixed",
    }
    .to_string();

    Ok(PdfConversionResult {
        pdf_type,
        markdown: result.markdown,
        page_count: result.page_count,
        pages_needing_ocr: result.pages_needing_ocr,
        title: result.title,
    })
}

#[tauri::command]
async fn convert_pdf_to_markdown(pdf_bytes: Vec<u8>) -> Result<PdfConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || do_convert_pdf(&pdf_bytes))
        .await
        .map_err(|e| format!("Tâche PDF interrompue : {e}"))?
}

#[tauri::command]
async fn convert_pdf_path_to_markdown(path: String) -> Result<PdfConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|e| format!("Impossible de lire le PDF : {e}"))?;
        do_convert_pdf(&bytes)
    })
    .await
    .map_err(|e| format!("Tâche PDF interrompue : {e}"))?
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    use std::process::Command;
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Le fichier n'existe pas.".into());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|e| format!("Impossible d'ouvrir le Finder : {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path))
            .status()
            .map_err(|e| format!("Impossible d'ouvrir l'Explorateur : {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let target = p.parent().unwrap_or(p);
        Command::new("xdg-open")
            .arg(target.as_os_str())
            .status()
            .map_err(|e| format!("Impossible d'ouvrir le gestionnaire de fichiers : {e}"))?;
    }

    Ok(())
}

#[tauri::command]
fn create_markdown_file(
    root_path: String,
    name: String,
    cache: tauri::State<FileListCache>,
    tags_cache: tauri::State<TagsCache>,
) -> Result<String, String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_writable_markdown_target(&root, &root, &name, true)?;
    let display_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.md");

    if target.exists() {
        return Err(format!("Le fichier \"{}\" existe déjà.", display_name));
    }

    // Create with minimal front matter
    let title = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    let content = format!("---\ntitle: {}\n---\n\n", title);
    fs::write(&target, &content).map_err(|e| e.to_string())?;

    // Re-index
    if let Ok(resolved) = fs::canonicalize(&target) {
        if let Ok(handle) = db::get_connection(&root) {
            if let Ok(conn) = handle.lock() {
                db::index_single_file(&conn, &root, &resolved).ok();
            }
        }
    }

    cache.invalidate(&normalize_path(&root));
    tags_cache.invalidate(&normalize_path(&root));
    Ok(normalize_path(&fs::canonicalize(&target).map_err(|e| e.to_string())?))
}

#[derive(Debug, Serialize)]
struct RenameResult {
    /// Canonical path of the renamed file
    new_path: String,
    /// Number of files whose links were rewritten
    files_updated: usize,
    /// Total number of link occurrences rewritten
    links_updated: usize,
}

#[tauri::command]
fn rename_markdown_file(
    root_path: String,
    path: String,
    new_name: String,
    update_links: bool,
    cache: tauri::State<FileListCache>,
    tags_cache: tauri::State<TagsCache>,
) -> Result<RenameResult, String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_markdown_file(&root_path, &path)?;

    let parent = target
        .parent()
        .ok_or_else(|| "Chemin parent introuvable.".to_string())?;
    let new_target = resolve_writable_markdown_target(&root, parent, &new_name, false)?;
    let new_file_name = new_target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nom de fichier invalide.".to_string())?
        .to_string();

    if new_target.exists() {
        return Err(format!("Le fichier \"{}\" existe déjà.", new_file_name));
    }

    // Capture old info before the rename
    let old_stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let old_file_name_full = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let new_stem = Path::new(&new_file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&new_file_name)
        .to_string();

    fs::rename(&target, &new_target).map_err(|e| e.to_string())?;

    let mut files_updated = 0usize;
    let mut links_updated = 0usize;

    if update_links && !old_stem.is_empty() && old_stem != new_stem {
        let (fu, lu) = rewrite_links_in_workspace(
            &root,
            &new_target,
            &old_stem,
            &new_stem,
            &old_file_name_full,
            &new_file_name,
        )?;
        files_updated = fu;
        links_updated = lu;
    }

    // Full reindex to clean up stale references
    if let Ok(handle) = db::get_connection(&root) {
        if let Ok(conn) = handle.lock() {
            db::reindex(&conn, &root).ok();
        }
    }

    let new_path = normalize_path(&fs::canonicalize(&new_target).map_err(|e| e.to_string())?);
    cache.invalidate(&normalize_path(&root));
    tags_cache.invalidate(&normalize_path(&root));
    Ok(RenameResult {
        new_path,
        files_updated,
        links_updated,
    })
}

/// Walk the workspace, rewriting wiki-links `[[old_stem]]` → `[[new_stem]]`
/// (preserving the alias if any: `[[old|alias]]` → `[[new|alias]]`),
/// and relative markdown links that reference the old file name.
fn rewrite_links_in_workspace(
    root: &Path,
    renamed_target: &Path,
    old_stem: &str,
    new_stem: &str,
    old_file_name_full: &str,
    new_file_name: &str,
) -> Result<(usize, usize), String> {
    // Escape the stem for regex insertion
    let escaped_stem = regex::escape(old_stem);
    let escaped_file = regex::escape(old_file_name_full);

    // [[old]] or [[old|alias]] — capture optional alias
    let wiki_re = RegexBuilder::new(&format!(
        r"\[\[{}(\|[^\]]*)?\]\]",
        escaped_stem
    ))
    .case_insensitive(true)
    .build()
    .map_err(|e| e.to_string())?;

    // [text](path/to/old.md) — match the file name at the end of a link href
    // We match path ending with old_file_name (allow leading ./ or folder/)
    let md_re = RegexBuilder::new(&format!(
        r"(\]\()([^)]*?){}(\))",
        escaped_file
    ))
    .case_insensitive(true)
    .build()
    .map_err(|e| e.to_string())?;

    let renamed_canon = fs::canonicalize(renamed_target).ok();

    let mut files_updated = 0usize;
    let mut links_updated = 0usize;

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !should_skip_entry(e))
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_markdown(path) {
            continue;
        }

        // Skip the renamed file itself — its own content isn't affected
        if let Some(canon) = &renamed_canon {
            if let Ok(current) = fs::canonicalize(path) {
                if current == *canon {
                    continue;
                }
            }
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut file_changes = 0usize;

        // Rewrite wiki-links
        let after_wiki = wiki_re.replace_all(&content, |caps: &regex::Captures| {
            file_changes += 1;
            match caps.get(1) {
                Some(alias) => format!("[[{}{}]]", new_stem, alias.as_str()),
                None => format!("[[{}]]", new_stem),
            }
        });

        // Rewrite md-links that point to the old file name
        let after_md = md_re.replace_all(&after_wiki, |caps: &regex::Captures| {
            file_changes += 1;
            format!("{}{}{}{}", &caps[1], &caps[2], new_file_name, &caps[3])
        });

        if file_changes > 0 {
            // Make a backup before writing
            let backup = backup_path_for(path);
            fs::copy(path, &backup).ok();

            fs::write(path, after_md.as_ref()).map_err(|e| e.to_string())?;
            files_updated += 1;
            links_updated += file_changes;
        }
    }

    Ok((files_updated, links_updated))
}

#[derive(Debug, Serialize)]
struct SavedImage {
    /// Absolute canonical path of the saved image
    path: String,
    /// Relative markdown-friendly path (forward slashes), e.g. `assets/1234.png`
    relative: String,
}

/// Save an image dropped/pasted into the editor into an `assets/` folder
/// inside the workspace. Returns the relative path to use in markdown.
#[tauri::command]
fn save_image(
    root_path: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<SavedImage, String> {
    let root = canonicalize_root(&root_path)?;

    // Sanitize the filename: keep only the base name + extension
    let base = Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.png")
        .to_string();

    // Split stem + extension
    let (stem, ext) = {
        let dot = base.rfind('.');
        match dot {
            Some(i) => (base[..i].to_string(), base[i..].to_string()),
            None => (base.clone(), ".png".to_string()),
        }
    };

    // Only allow a safe subset of image extensions
    let lower_ext = ext.to_ascii_lowercase();
    let allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"];
    if !allowed.iter().any(|e| *e == lower_ext) {
        return Err(format!("Extension non autorisée : {}", ext));
    }

    let assets_dir = root.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    // Find a non-colliding name: stem.ext, stem-1.ext, stem-2.ext, …
    let mut candidate = assets_dir.join(format!("{}{}", stem, lower_ext));
    let mut i = 1;
    while candidate.exists() {
        candidate = assets_dir.join(format!("{}-{}{}", stem, i, lower_ext));
        i += 1;
        if i > 999 {
            return Err("Trop de collisions de noms d'images.".to_string());
        }
    }

    fs::write(&candidate, &bytes).map_err(|e| e.to_string())?;

    let absolute = fs::canonicalize(&candidate).map_err(|e| e.to_string())?;
    let relative = relative_from_root(&root, &absolute);

    Ok(SavedImage {
        path: normalize_path(&absolute),
        relative,
    })
}

#[tauri::command]
fn delete_markdown_file(
    root_path: String,
    path: String,
    cache: tauri::State<FileListCache>,
    tags_cache: tauri::State<TagsCache>,
) -> Result<(), String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_markdown_file(&root_path, &path)?;

    // Move to trash via OS-aware deletion (here we do a simple fs::remove for now)
    fs::remove_file(&target).map_err(|e| e.to_string())?;

    // Also remove backup if present
    let backup = backup_path_for(&target);
    if backup.exists() {
        fs::remove_file(&backup).ok();
    }

    // Reindex
    if let Ok(handle) = db::get_connection(&root) {
        if let Ok(conn) = handle.lock() {
            db::reindex(&conn, &root).ok();
        }
    }

    cache.invalidate(&normalize_path(&root));
    tags_cache.invalidate(&normalize_path(&root));
    Ok(())
}

#[tauri::command]
fn save_as_markdown_file(
    root_path: String,
    name: String,
    content: String,
    cache: tauri::State<FileListCache>,
    tags_cache: tauri::State<TagsCache>,
) -> Result<String, String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_writable_markdown_target(&root, &root, &name, true)?;
    let display_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.md");

    if target.exists() {
        return Err(format!("Le fichier \"{}\" existe déjà.", display_name));
    }

    fs::write(&target, &content).map_err(|e| e.to_string())?;

    // Re-index
    if let Ok(resolved) = fs::canonicalize(&target) {
        if let Ok(handle) = db::get_connection(&root) {
            if let Ok(conn) = handle.lock() {
                db::index_single_file(&conn, &root, &resolved).ok();
            }
        }
    }

    cache.invalidate(&normalize_path(&root));
    tags_cache.invalidate(&normalize_path(&root));
    Ok(normalize_path(&fs::canonicalize(&target).map_err(|e| e.to_string())?))
}

fn collect_line_matches(content: &str, regex: &regex::Regex) -> Vec<SearchMatch> {
    content
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| {
            if regex.is_match(line) {
                Some(SearchMatch {
                    line_number: idx + 1,
                    line: line.trim().to_string(),
                })
            } else {
                None
            }
        })
        .take(8)
        .collect()
}

#[tauri::command]
async fn search_markdown(root_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SearchResult>, String> {
        let root = canonicalize_root(&root_path)?;
        let needle = query.trim();
        if needle.is_empty() {
            return Ok(Vec::new());
        }

        let regex = RegexBuilder::new(&regex::escape(needle))
            .case_insensitive(true)
            .build()
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();

        let candidates = (|| -> Result<Vec<String>, String> {
            let handle = db::get_connection(&root)?;
            let conn = handle.lock()?;
            if db::index_has_files(&conn)? {
                db::search_fts_paths(&conn, needle, 200)
            } else {
                Ok(Vec::new())
            }
        })()
        .ok();

        if let Some(paths) = candidates.filter(|p| !p.is_empty()) {
            for path_str in &paths {
                let path = Path::new(path_str);
                let content = match fs::read_to_string(path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let matches = collect_line_matches(&content, &regex);
                if !matches.is_empty() {
                    results.push(SearchResult {
                        path: normalize_path(path),
                        relative_path: relative_from_root(&root, path),
                        matches,
                    });
                }
            }
        } else {
            // Fallback: no index yet. Walk the workspace directly.
            for entry in WalkDir::new(&root)
                .into_iter()
                .filter_entry(|e| !should_skip_entry(e))
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if !entry.file_type().is_file() || !is_markdown(path) {
                    continue;
                }

                let content = match fs::read_to_string(path) {
                    Ok(content) => content,
                    Err(_) => continue,
                };

                let matches = collect_line_matches(&content, &regex);

                if !matches.is_empty() {
                    results.push(SearchResult {
                        path: normalize_path(path),
                        relative_path: relative_from_root(&root, path),
                        matches,
                    });
                }
            }
        }

        results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(results)
    })
    .await
    .map_err(|e| format!("Tâche recherche interrompue : {e}"))?
}

// ── Index commands ───────────────────────────────────────────────────

#[tauri::command]
fn reindex_workspace(root_path: String) -> Result<db::IndexStats, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    db::reindex(&conn, &root)
}

#[tauri::command]
fn index_file(root_path: String, path: String) -> Result<(), String> {
    let root = canonicalize_root(&root_path)?;
    let target = resolve_markdown_file(&root_path, &path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    db::index_single_file(&conn, &root, &target)
}

#[tauri::command]
fn search_index(root_path: String, query: String) -> Result<Vec<db::FtsResult>, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    db::search_fts(&conn, &query)
}

#[tauri::command]
fn get_backlinks(root_path: String, file_path: String) -> Result<Vec<db::BacklinkEntry>, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    db::get_backlinks(&conn, &file_path)
}

#[tauri::command]
fn get_all_tags(
    root_path: String,
    cache: tauri::State<TagsCache>,
) -> Result<Vec<db::TagCount>, String> {
    let root = canonicalize_root(&root_path)?;
    let key = normalize_path(&root);
    if let Some(hit) = cache.get(&key) {
        return Ok(hit);
    }
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    let tags = db::get_all_tags(&conn)?;
    cache.put(key, tags.clone());
    Ok(tags)
}

#[tauri::command]
fn get_files_by_tag(root_path: String, tag: String) -> Result<Vec<db::FtsResult>, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    db::get_files_by_tag(&conn, &tag)
}

#[tauri::command]
fn find_broken_links(root_path: String) -> Result<Vec<db::BrokenLink>, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    // Make sure the index is up-to-date before auditing
    db::reindex(&conn, &root).ok();
    db::find_broken_links(&conn, &root)
}

// Recursively copy a directory. Used by `load_demo_workspace` to materialise
// the bundled `demo/` resources into a user-writable location on first use.
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Copy the bundled demo folder into `Documents/MD-Workshop-Demo/` if it
/// doesn't exist yet, then return the target path. Use `reset=true` to
/// overwrite an existing copy (handy for the "Réinitialiser la démo" command).
#[tauri::command]
fn load_demo_workspace(app: tauri::AppHandle, reset: Option<bool>) -> Result<String, String> {
    let resolver = app.path();
    let source = resolver
        .resolve("demo", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Impossible de localiser les ressources démo : {e}"))?;

    if !source.exists() {
        return Err(format!(
            "Le dossier démo n'est pas disponible (chemin attendu : {}).",
            source.display()
        ));
    }

    let documents = resolver
        .document_dir()
        .map_err(|e| format!("Impossible de localiser le dossier Documents : {e}"))?;
    let target = documents.join("MD-Workshop-Demo");

    let should_reset = reset.unwrap_or(false);
    if target.exists() && should_reset {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("Impossible de réinitialiser la démo : {e}"))?;
    }

    if !target.exists() {
        copy_dir_recursive(&source, &target)
            .map_err(|e| format!("Impossible de copier la démo : {e}"))?;
    }

    Ok(normalize_path(&target))
}

#[tauri::command]
fn get_graph_data(
    root_path: String,
    mode: String,
    file_path: Option<String>,
    depth: Option<u32>,
    filter_folder: Option<String>,
    filter_tags: Option<Vec<String>>,
    include_orphans: Option<bool>,
) -> Result<db::GraphData, String> {
    let root = canonicalize_root(&root_path)?;
    let handle = db::get_connection(&root)?;
    let conn = handle.lock()?;
    let tags = filter_tags.unwrap_or_default();
    match mode.as_str() {
        "local" => {
            let fp = file_path.ok_or_else(|| "file_path requis pour le mode local".to_string())?;
            db::get_graph_local(&conn, &fp, depth.unwrap_or(1))
        }
        "global" => db::get_graph_global(
            &conn,
            filter_folder.as_deref(),
            &tags,
            include_orphans.unwrap_or(true),
        ),
        other => Err(format!("Mode graphe inconnu : {other}")),
    }
}

// ── Replace commands ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct ReplaceLine {
    line_number: usize,
    before: String,
    after: String,
}

#[derive(Debug, Serialize)]
struct ReplaceFilePreview {
    path: String,
    relative_path: String,
    lines: Vec<ReplaceLine>,
}

#[derive(Debug, Serialize)]
struct ReplaceResult {
    files_changed: usize,
    replacements: usize,
}

#[tauri::command]
fn preview_replace(
    root_path: String,
    search: String,
    replace: String,
    is_regex: bool,
    case_sensitive: bool,
) -> Result<Vec<ReplaceFilePreview>, String> {
    let root = canonicalize_root(&root_path)?;
    let needle = search.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let regex = build_search_regex(needle, is_regex, case_sensitive)?;
    let mut results = Vec::new();

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_markdown(path) {
            continue;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut lines = Vec::new();

        for (idx, line) in content.lines().enumerate() {
            if regex.is_match(line) {
                let after = regex.replace_all(line, replace.as_str()).to_string();
                if after != line {
                    lines.push(ReplaceLine {
                        line_number: idx + 1,
                        before: line.to_string(),
                        after,
                    });
                }
            }
        }

        if !lines.is_empty() {
            results.push(ReplaceFilePreview {
                path: normalize_path(path),
                relative_path: relative_from_root(&root, path),
                lines,
            });
        }
    }

    results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(results)
}

#[tauri::command]
fn apply_replace(
    root_path: String,
    search: String,
    replace: String,
    is_regex: bool,
    case_sensitive: bool,
    file_paths: Vec<String>,
) -> Result<ReplaceResult, String> {
    let root = canonicalize_root(&root_path)?;
    let needle = search.trim();
    if needle.is_empty() {
        return Ok(ReplaceResult {
            files_changed: 0,
            replacements: 0,
        });
    }

    let regex = build_search_regex(needle, is_regex, case_sensitive)?;
    let mut files_changed = 0usize;
    let mut total_replacements = 0usize;

    for file_path in &file_paths {
        let target = resolve_markdown_file(&root_path, file_path)?;

        let content = fs::read_to_string(&target).map_err(|e| e.to_string())?;

        // Build new content directly into a String buffer to avoid cloning
        // every unchanged line into a Vec before joining at the end.
        let mut new_content = String::with_capacity(content.len());
        let mut file_replacements = 0usize;
        let mut first = true;

        for line in content.lines() {
            if !first {
                new_content.push('\n');
            }
            first = false;

            if regex.is_match(line) {
                let replaced = regex.replace_all(line, replace.as_str());
                if replaced != line {
                    file_replacements += 1;
                }
                new_content.push_str(&replaced);
            } else {
                new_content.push_str(line);
            }
        }

        if file_replacements > 0 {
            // Create backup
            let backup = backup_path_for(&target);
            if target.exists() {
                fs::copy(&target, &backup).ok();
            }

            // Preserve trailing newline if original had one
            if content.ends_with('\n') {
                new_content.push('\n');
            }

            fs::write(&target, &new_content).map_err(|e| e.to_string())?;

            // Re-index the file
            if let Ok(handle) = db::get_connection(&root) {
                if let Ok(conn) = handle.lock() {
                    db::index_single_file(&conn, &root, &target).ok();
                }
            }

            files_changed += 1;
            total_replacements += file_replacements;
        }
    }

    Ok(ReplaceResult {
        files_changed,
        replacements: total_replacements,
    })
}

/// Returns `true` on the very first launch after a fresh install. We write a
/// marker into Tauri's per-app config dir (which Windows removes on MSI
/// uninstall); the frontend uses the result to drop stale localStorage state
/// left behind by previous installs or dev sessions sharing the same
/// WebView2 identifier.
#[tauri::command]
fn check_first_run(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let marker = dir.join(".initialized");
    if marker.exists() {
        return Ok(false);
    }

    fs::write(&marker, b"").map_err(|e| e.to_string())?;
    Ok(true)
}

fn build_search_regex(
    needle: &str,
    is_regex: bool,
    case_sensitive: bool,
) -> Result<regex::Regex, String> {
    let pattern = if is_regex {
        needle.to_string()
    } else {
        regex::escape(needle)
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Expression invalide : {e}"))
}

// ── App entry ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AssetScopeState::default())
        .manage(FileListCache::default())
        .manage(TagsCache::default())
        .manage(WorkspaceWatcher::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_workspace_asset_scope,
            list_markdown_files,
            read_markdown_file,
            save_markdown_file,
            create_markdown_file,
            convert_pdf_to_markdown,
            convert_pdf_path_to_markdown,
            reveal_in_file_manager,
            save_as_markdown_file,
            rename_markdown_file,
            delete_markdown_file,
            save_image,
            search_markdown,
            reindex_workspace,
            index_file,
            search_index,
            get_backlinks,
            get_all_tags,
            get_files_by_tag,
            find_broken_links,
            get_graph_data,
            load_demo_workspace,
            preview_replace,
            apply_replace,
            check_first_run
        ])
        .setup(|app| {
            let _main_window = app
                .get_webview_window("main")
                .context("main window not found")?;

            // Resolve the per-user app-data directory once and hand it to the
            // db module. All workspace indexes now live under
            // `<app_data_dir>/workspaces/<digest>/index.db`, so nothing is
            // ever written inside the workspace itself.
            let base = app
                .path()
                .app_data_dir()
                .context("app_data_dir introuvable")?
                .join("workspaces");
            std::fs::create_dir_all(&base)
                .with_context(|| format!("Impossible de créer {base:?}"))?;
            db::init_index_base(base)
                .map_err(|e| anyhow::anyhow!("{e}"))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
