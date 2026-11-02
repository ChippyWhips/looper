//! Measurement hook: with `LOOPER_AUTOTEST=<audio file>` the frontend opens that file, lets it
//! separate, and reports timing back here; the report is printed and the app exits. Without the
//! variable every command is inert.

use std::fs;

use tauri::ipc::Response;
use tauri::AppHandle;

fn target() -> Option<String> {
    std::env::var("LOOPER_AUTOTEST").ok().filter(|p| !p.is_empty())
}

/// The file name to open, or null when not measuring.
#[tauri::command]
pub fn autotest_config() -> Option<String> {
    target().map(|p| {
        std::path::Path::new(&p)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(p)
    })
}

/// Bytes of the configured file (only that file).
#[tauri::command]
pub fn autotest_read() -> Result<Response, String> {
    let p = target().ok_or("autotest is off")?;
    fs::read(p).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autotest_report(app: AppHandle, report: String) {
    if target().is_none() {
        return;
    }
    println!("LOOPER_AUTOTEST_REPORT {report}");
    app.exit(0);
}
