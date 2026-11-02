//! Track storage on the native file system, mirroring the web build's OPFS layout under
//! `<app data>/looper/`. The frontend's `TrackStore` calls these commands through its
//! native backend; nothing else in the app touches these files except the separator,
//! which writes stems into the same layout.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime};

pub const ROOT: &str = "looper";

pub fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(ROOT);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Join validated path segments onto the root. Rejects anything that could escape it.
pub fn resolve(root: &Path, segments: &[String]) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for s in segments {
        let bad = s.is_empty()
            || s == "."
            || s == ".."
            || s.contains('/')
            || s.contains('\\')
            || s.contains('\0');
        if bad {
            return Err(format!("invalid path segment {s:?}"));
        }
        p.push(s);
    }
    Ok(p)
}

fn header_path(request: &Request<'_>) -> Result<Vec<String>, String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or("missing x-path header")?
        .to_str()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(raw).map_err(|e| e.to_string())
}

fn body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        InvokeBody::Json(_) => Err("expected a binary body".into()),
    }
}

/// Write atomically: a temp file renamed over the target, so a reader never sees half a file.
pub fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp-write");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn store_write<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let path = resolve(&root(&app)?, &header_path(&request)?)?;
    write_file(&path, &body(&request)?)
}

/// File bytes, or an error whose message is `NotFound` when the file does not exist.
#[tauri::command]
pub async fn store_read<R: Runtime>(app: AppHandle<R>, path: Vec<String>) -> Result<Response, String> {
    let p = resolve(&root(&app)?, &path)?;
    match fs::read(&p) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("NotFound".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn store_remove<R: Runtime>(app: AppHandle<R>, path: Vec<String>) -> Result<(), String> {
    if path.is_empty() {
        return Err("refusing to remove the store root".into());
    }
    let p = resolve(&root(&app)?, &path)?;
    let r = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
    match r {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn store_mkdir<R: Runtime>(app: AppHandle<R>, path: Vec<String>) -> Result<(), String> {
    let p = resolve(&root(&app)?, &path)?;
    fs::create_dir_all(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn store_list<R: Runtime>(app: AppHandle<R>, path: Vec<String>) -> Result<Vec<String>, String> {
    let p = resolve(&root(&app)?, &path)?;
    let Ok(entries) = fs::read_dir(&p) else {
        return Ok(vec![]);
    };
    Ok(entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.ends_with(".tmp-write"))
        .collect())
}

#[derive(Serialize)]
pub struct Ingested {
    hash: String,
    existed: bool,
}

/// Hash the bytes (SHA-256) and store them at `dir/<hash>/<name>` unless already there.
#[tauri::command]
pub async fn store_ingest<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<Ingested, String> {
    let segs = header_path(&request)?;
    let (name, dir) = segs.split_last().ok_or("x-path must end with the file name")?;
    let data = body(&request)?;
    let hash = hex::encode(Sha256::digest(&data));
    let root = root(&app)?;
    let mut target = dir.to_vec();
    target.push(hash.clone());
    let track_dir = resolve(&root, &target)?;
    let file = resolve(&track_dir, std::slice::from_ref(name))?;
    let existed = file.is_file();
    if !existed {
        write_file(&file, &data)?;
        fs::create_dir_all(track_dir.join("stems")).map_err(|e| e.to_string())?;
    }
    Ok(Ingested { hash, existed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_segments() {
        let r = Path::new("/tmp/root");
        for bad in ["..", ".", "", "a/b", "a\\b"] {
            assert!(resolve(r, &[bad.to_string()]).is_err(), "{bad:?} accepted");
        }
        assert_eq!(
            resolve(r, &["tracks".into(), "abc".into()]).unwrap(),
            PathBuf::from("/tmp/root/tracks/abc")
        );
    }

    #[test]
    fn writes_atomically() {
        let dir = std::env::temp_dir().join(format!("looper-store-test-{}", std::process::id()));
        let f = dir.join("x/y.bin");
        write_file(&f, b"hello").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"hello");
        assert!(!f.with_extension("tmp-write").exists());
        fs::remove_dir_all(dir).ok();
    }
}
