// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
extern "system" {
    fn SetConsoleOutputCP(codepage: u32) -> i32;
}

#[cfg(windows)]
fn ensure_console_utf8() {
    unsafe {
        SetConsoleOutputCP(65001);
    }
}

fn main() {
    #[cfg(windows)]
    ensure_console_utf8();
    app_lib::run();
}
