use serde::Deserialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct STTResult {
    pub text: String,
    pub confidence: f64,
    pub segments: i32,
    pub language: String,
    pub error: Option<String>,
}

/// 调用 `python_stt/transcribe.py` 转写音频。
///
/// `custom_hotwords` 为用户自定义热词（人名 / 地名 / 术语，空格分隔），
/// 会与语言内置热词在 Python 侧合并；传 `None` 或空串表示不附加。
pub fn transcribe(
    audio_path: &str,
    model_size: &str,
    language: &str,
    custom_hotwords: Option<&str>,
    model_cache_dir: &Path,
    model_dir: &Path,
) -> Result<STTResult, String> {
    let python = find_python()?;
    let script = find_transcribe_script()?;

    log::info!("Python: {:?}, Script: {:?}, Audio: {}", python, script, audio_path);

    let output = Command::new(&python)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("HF_HOME", model_cache_dir)
        .env("HF_HUB_CACHE", model_cache_dir.join("hub"))
        .env("WHISPER_MODEL_DIR", model_dir)
        .arg(&script)
        .arg(audio_path)
        .arg(model_size)
        .arg(language)
        // 固定占用第 4 个 argv 位，空串由 Python 侧忽略，避免参数错位。
        .arg(custom_hotwords.unwrap_or(""))
        .output()
        .map_err(|e| format!("无法启动 Python 进程: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python 退出码 {}: {}", output.status, stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: STTResult =
        serde_json::from_str(&stdout).map_err(|e| format!("解析 STT 结果失败: {} - {}", e, stdout))?;

    if let Some(err) = result.error {
        return Err(err);
    }

    Ok(result)
}

pub(crate) fn find_python() -> Result<String, String> {
    if let Ok(explicit) = env::var("SHENGWEN_PYTHON") {
        let check = Command::new(&explicit).args(["-c", "import faster_whisper, av"]).output()
            .map_err(|e| format!("无法启动 SHENGWEN_PYTHON 指定的 Python: {e}"))?;
        if check.status.success() { return Ok(explicit); }
        return Err("SHENGWEN_PYTHON 缺少 faster-whisper / av，请安装 python_stt/requirements.txt 中的依赖".into());
    }
    let candidates = vec![
        find_venv_python("python_stt/.venv"),
        find_venv_python("../python_stt/.venv"),
        find_venv_python("python_stt/.venv/Scripts"),
        find_venv_python("../python_stt/.venv/Scripts"),
        find_venv_python_from_exe("python_stt/.venv"),
        find_venv_python_from_exe("python_stt/.venv/Scripts"),
        Some("python".to_string()),
    ];

    for c in candidates.into_iter().flatten() {
        if c == "python" || Path::new(&c).exists() {
            if Command::new(&c).args(["-c", "import faster_whisper, av"]).output().map(|o| o.status.success()).unwrap_or(false) {
                return Ok(c);
            }
        }
    }

    Err("找不到 Python 环境，请安装 Python 或检查 python_stt/.venv".to_string())
}

fn find_venv_python(relative: &str) -> Option<String> {
    let paths = [
        Path::new(relative).join("bin").join("python"),
        Path::new(relative).join("bin").join("python3"),
        Path::new(relative).join("Scripts").join("python.exe"),
        Path::new(relative).join("python.exe"),
    ];
    for p in &paths {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn find_venv_python_from_exe(relative: &str) -> Option<String> {
    let base = project_root_from_exe()?;
    let paths = [
        base.join(relative).join("bin").join("python"),
        base.join(relative).join("bin").join("python3"),
        base.join(relative).join("Scripts").join("python.exe"),
        base.join(relative).join("python.exe"),
    ];
    for p in &paths {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// 在 python_stt/ 目录下查找指定脚本（如 `audio_probe.py` / `convert_audio.py`）。
pub(crate) fn find_script(script_name: &str) -> Result<String, String> {
    let candidates = vec![
        Path::new("../python_stt").join(script_name),
        Path::new("python_stt").join(script_name),
        Path::new("resources/python_stt").join(script_name),
        Path::new("../resources/python_stt").join(script_name),
    ];
    for path in &candidates {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }
    if let Some(base) = project_root_from_exe() {
        for rel in ["python_stt", "resources/python_stt"] {
            let full = base.join(rel).join(script_name);
            if full.exists() {
                return Ok(full.to_string_lossy().to_string());
            }
        }
        let from_parent = base.join("..").join("python_stt").join(script_name);
        if from_parent.exists() {
            return Ok(from_parent.to_string_lossy().to_string());
        }
    }
    Err(format!("找不到 {}，请确保 python_stt/{} 存在", script_name, script_name))
}

fn find_transcribe_script() -> Result<String, String> {
    let candidates = vec![
        Path::new("../python_stt/transcribe.py").to_path_buf(),
        Path::new("python_stt/transcribe.py").to_path_buf(),
        Path::new("resources/python_stt/transcribe.py").to_path_buf(),
        Path::new("../resources/python_stt/transcribe.py").to_path_buf(),
    ];

    for path in &candidates {
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // Try from exe location
    if let Some(base) = project_root_from_exe() {
        let from_root = base.join("python_stt").join("transcribe.py");
        if from_root.exists() {
            return Ok(from_root.to_string_lossy().to_string());
        }
        let from_resources = base.join("resources").join("python_stt").join("transcribe.py");
        if from_resources.exists() {
            return Ok(from_resources.to_string_lossy().to_string());
        }
        let from_parent = base.join("..").join("python_stt").join("transcribe.py");
        if from_parent.exists() {
            return Ok(from_parent.to_string_lossy().to_string());
        }
    }

    Err("找不到 transcribe.py，请确保 python_stt/transcribe.py 存在".to_string())
}

pub(crate) fn project_root_from_exe() -> Option<PathBuf> {
    env::current_exe().ok().and_then(|exe| {
        // exe is at  src-tauri/target/{profile}/app.exe
        // Walk up to find project root (where python_stt/ or src-tauri/ lives)
        let mut dir = exe.parent()?;
        for _ in 0..5 {
            if dir.join("python_stt").is_dir() || dir.join("src-tauri").is_dir() {
                return Some(dir.to_path_buf());
            }
            dir = dir.parent()?;
        }
        None
    })
}
