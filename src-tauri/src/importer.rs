//! B1：导入 iPhone 录音（M4A/AAC/WAV 等）。
//!
//! 流程：探测 → 复制原文件到应用音频目录 → （非 WAV 时）转码出独立派生 WAV →
//! 登记为记忆 + 音频资产（含原始文件名/实际格式/校验值）→ 创建待转写任务。
//! 转写失败或转码失败都不留伪成功记录；录制时间无法可靠读取时留空，不冒充。

use crate::library::{Library, RegisterRecordingInput};
use crate::stt;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ProbeResult {
    format: Option<String>,
    duration_secs: Option<f64>,
    sample_rate: Option<i64>,
    channels: Option<i64>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ConvertResult {
    output_path: Option<String>,
    sample_rate: Option<i64>,
    channels: Option<i64>,
    duration_secs: Option<f64>,
    error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub source_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub format: String,
    pub duration_secs: Option<f64>,
    pub sample_rate: Option<i64>,
    pub already_imported: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub memory_id: String,
    pub audio_path: String,
    /// 实际用于播放/转写的文件（WAV 原文件或转码派生）。
    pub playable_path: String,
    pub duration_secs: f64,
    pub sample_rate: Option<i64>,
    pub source_format: String,
    pub file_checksum: String,
    pub transcribe_task_created: bool,
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取文件 {:?}: {}", path, e))?;
    Ok(crate::backup::sha256(&bytes))
}

fn run_python_script(script: &str, args: &[&str]) -> Result<String, String> {
    let python = stt::find_python()?;
    let output = std::process::Command::new(&python)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .arg(script)
        .args(args)
        .output()
        .map_err(|e| format!("无法启动 Python 进程: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python 退出码 {}: {}", output.status, stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn probe_audio(path: &Path) -> Result<ProbeResult, String> {
    let script = stt::find_script("audio_probe.py")?;
    let stdout = run_python_script(&script, &[&path.to_string_lossy()])?;
    serde_json::from_str(&stdout).map_err(|e| format!("解析音频探测结果失败: {} - {}", e, stdout))
}

fn convert_audio(input: &Path, output: &Path) -> Result<ConvertResult, String> {
    let script = stt::find_script("convert_audio.py")?;
    let stdout = run_python_script(&script, &[&input.to_string_lossy(), &output.to_string_lossy()])?;
    serde_json::from_str(&stdout).map_err(|e| format!("解析转码结果失败: {} - {}", e, stdout))
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 探测单个文件，返回导入候选信息（供前端展示与预校验）。
pub fn inspect_candidate(library: &Library, source_path: &Path) -> ImportCandidate {
    let file_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let size_bytes = fs::metadata(source_path).map(|m| m.len()).unwrap_or(0);
    let ext = extension_of(source_path);

    let supported = matches!(ext.as_str(), "wav" | "m4a" | "aac" | "mp3" | "ogg" | "flac" | "aiff" | "aif");
    if !supported {
        return ImportCandidate {
            source_path: source_path.to_string_lossy().to_string(),
            file_name,
            size_bytes,
            format: ext.clone(),
            duration_secs: None,
            sample_rate: None,
            already_imported: false,
            error: Some(format!("不支持的音频格式 .{}", ext)),
        };
    }

    match sha256_file(source_path) {
        Ok(checksum) => {
            let already = library
                .find_audio_by_checksum(&checksum)
                .ok()
                .flatten()
                .is_some();
            match probe_audio(source_path) {
                Ok(probe) => ImportCandidate {
                    source_path: source_path.to_string_lossy().to_string(),
                    file_name,
                    size_bytes,
                    format: probe.format.unwrap_or(ext),
                    duration_secs: probe.duration_secs,
                    sample_rate: probe.sample_rate,
                    already_imported: already,
                    error: probe.error,
                },
                Err(error) => ImportCandidate {
                    source_path: source_path.to_string_lossy().to_string(),
                    file_name,
                    size_bytes,
                    format: ext,
                    duration_secs: None,
                    sample_rate: None,
                    already_imported: already,
                    error: Some(error),
                },
            }
        }
        Err(error) => ImportCandidate {
            source_path: source_path.to_string_lossy().to_string(),
            file_name,
            size_bytes,
            format: ext,
            duration_secs: None,
            sample_rate: None,
            already_imported: false,
            error: Some(error),
        },
    }
}

/// 执行导入：复制原文件 → 必要时转码 → 登记记忆与音频资产 → 创建待转写任务。
pub fn import_audio(
    library: &Library,
    audio_dir: &Path,
    project_id: &str,
    source_path: &Path,
) -> Result<ImportOutcome, String> {
    if !source_path.is_file() {
        return Err(format!("源文件不存在: {:?}", source_path));
    }
    let ext = extension_of(source_path);
    if !matches!(ext.as_str(), "wav" | "m4a" | "aac" | "mp3" | "ogg" | "flac" | "aiff" | "aif") {
        return Err(format!("不支持的音频格式 .{}", ext));
    }

    // 1) 探测（损坏文件在此报错，不留伪成功记录）。
    let probe = probe_audio(source_path)?;
    if let Some(error) = probe.error {
        // 探测有警告但可能有格式信息；仅当完全无法识别时才中止。
        if probe.format.is_none() {
            return Err(format!("无法识别音频文件: {}", error));
        }
    }
    let source_format = probe.format.clone().unwrap_or_else(|| ext.clone());

    // 2) 校验值去重。
    let checksum = sha256_file(source_path)?;
    if let Some(existing) = library.find_audio_by_checksum(&checksum)? {
        return Err(format!(
            "该文件已导入过（对应记忆音频：{}）。如需重新导入请先删除原记录。",
            existing.file_path
        ));
    }

    // 3) 复制原文件到应用音频目录（不依赖源文件永久存在）。
    fs::create_dir_all(audio_dir).map_err(|e| format!("无法创建音频目录: {e}"))?;
    let original_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("源文件名无效: {:?}", source_path))?;
    let id = uuid::Uuid::new_v4().to_string();
    let copied_original = audio_dir.join(format!("{}.{}", id, ext));
    fs::copy(source_path, &copied_original)
        .map_err(|e| format!("复制音频文件失败: {e}"))?;

    // 4) 非 WAV 转码出独立派生 WAV（不覆盖原音频）。
    let (playable_path, sample_rate, duration_secs) = if ext == "wav" {
        (
            copied_original.clone(),
            probe.sample_rate,
            probe.duration_secs.unwrap_or(0.0),
        )
    } else {
        let derived_wav = audio_dir.join(format!("{}.wav", id));
        match convert_audio(&copied_original, &derived_wav) {
            Ok(converted) => {
                if let Some(error) = converted.error {
                    let _ = fs::remove_file(&copied_original);
                    let _ = fs::remove_file(&derived_wav);
                    return Err(format!("转码失败: {}", error));
                }
                let sr = converted.sample_rate.or(probe.sample_rate);
                let dur = converted.duration_secs.or(probe.duration_secs).unwrap_or(0.0);
                (derived_wav, sr, dur)
            }
            Err(error) => {
                let _ = fs::remove_file(&copied_original);
                let _ = fs::remove_file(&derived_wav);
                return Err(format!("转码失败: {}", error));
            }
        }
    };

    // 5) 登记记忆 + 音频资产（含原始文件名/实际格式/校验值）+ 待转写任务。
    let title = Path::new(&original_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("导入录音 {}", id));
    let input = RegisterRecordingInput {
        project_id: project_id.to_string(),
        audio_path: playable_path.to_string_lossy().to_string(),
        duration_secs,
        sample_rate,
        recorded_at: None, // 录制时间无法可靠读取时留空，不将导入时间冒充录制时间。
        title: Some(title),
        original_filename: Some(original_name.clone()),
        source_format: Some(source_format.clone()),
        file_checksum: Some(checksum.clone()),
    };
    let registered = library.register_recording(input)?;

    Ok(ImportOutcome {
        memory_id: registered.memory.id,
        audio_path: copied_original.to_string_lossy().to_string(),
        playable_path: playable_path.to_string_lossy().to_string(),
        duration_secs,
        sample_rate,
        source_format,
        file_checksum: checksum,
        transcribe_task_created: true,
    })
}
