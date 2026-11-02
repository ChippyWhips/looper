//! Model weights: downloaded once from demucs-rs's registry into `<app data>/models/`.
//! Native counterpart of the frontend's `ModelStore`; a later build could bundle the files.

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use demucs_core::model::metadata::{download_url, ModelInfo};
use tauri::{AppHandle, Manager, Runtime};

use crate::store::write_file;

pub fn models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Cached weights, downloading them first if needed. `progress` gets 0..1.
pub fn load<R: Runtime>(
    app: &AppHandle<R>,
    info: &ModelInfo,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(f64),
) -> Result<Vec<u8>, String> {
    let path = models_dir(app)?.join(info.filename);
    if let Ok(bytes) = fs::read(&path) {
        progress(1.0);
        return Ok(bytes);
    }
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new().tls_connector(std::sync::Arc::new(tls)).build();
    let res = agent.get(&download_url(info)).call().map_err(|e| format!("model download: {e}"))?;
    let total: usize = res
        .header("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(info.size_mb as usize * 1024 * 1024);
    let mut reader = res.into_reader();
    let mut bytes = Vec::with_capacity(total);
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        progress((bytes.len() as f64 / total as f64).min(1.0));
    }
    write_file(&path, &bytes)?;
    Ok(bytes)
}
