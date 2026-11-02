#![recursion_limit = "256"]
mod autotest;
mod models;
mod pcm;
mod separate;
mod store;

pub fn run() {
    tauri::Builder::default()
        .manage(separate::Separation::default())
        .invoke_handler(tauri::generate_handler![
            store::store_write,
            store::store_read,
            store::store_remove,
            store::store_mkdir,
            store::store_list,
            store::store_ingest,
            separate::separate_start,
            separate::separate_cancel,
            autotest::autotest_config,
            autotest::autotest_read,
            autotest::autotest_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Looper");
}
