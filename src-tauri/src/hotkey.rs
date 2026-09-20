use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[allow(dead_code)]
pub fn register(app_handle: &tauri::AppHandle, hotkey_str: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey_str)?;
    app_handle
        .global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("注册快捷键失败: {}", e))
}

#[allow(dead_code)]
pub fn unregister(app_handle: &tauri::AppHandle, hotkey_str: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey_str)?;
    app_handle
        .global_shortcut()
        .unregister(shortcut)
        .map_err(|e| format!("注销快捷键失败: {}", e))
}

fn parse_hotkey(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    let mut modifiers = Modifiers::empty();
    let mut code = None;

    for part in parts {
        match part.to_uppercase().as_str() {
            "CTRL" => modifiers |= Modifiers::CONTROL,
            "ALT" => modifiers |= Modifiers::ALT,
            "SHIFT" => modifiers |= Modifiers::SHIFT,
            "SUPER" | "WIN" | "CMD" => modifiers |= Modifiers::SUPER,
            other => {
                code = Some(match other {
                    "A" => Code::KeyA,  "B" => Code::KeyB,  "C" => Code::KeyC,
                    "D" => Code::KeyD,  "E" => Code::KeyE,  "F" => Code::KeyF,
                    "G" => Code::KeyG,  "H" => Code::KeyH,  "I" => Code::KeyI,
                    "J" => Code::KeyJ,  "K" => Code::KeyK,  "L" => Code::KeyL,
                    "M" => Code::KeyM,  "N" => Code::KeyN,  "O" => Code::KeyO,
                    "P" => Code::KeyP,  "Q" => Code::KeyQ,  "R" => Code::KeyR,
                    "S" => Code::KeyS,  "T" => Code::KeyT,  "U" => Code::KeyU,
                    "V" => Code::KeyV,  "W" => Code::KeyW,  "X" => Code::KeyX,
                    "Y" => Code::KeyY,  "Z" => Code::KeyZ,
                    "F1" => Code::F1,   "F2" => Code::F2,   "F3" => Code::F3,
                    "F4" => Code::F4,   "F5" => Code::F5,   "F6" => Code::F6,
                    "F7" => Code::F7,   "F8" => Code::F8,   "F9" => Code::F9,
                    "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
                    _ => return Err(format!("不支持的按键: {}", other)),
                });
            }
        }
    }

    let sc = code.ok_or_else(|| "快捷键缺少按键".to_string())?;
    Ok(Shortcut::new(Some(modifiers), sc))
}
