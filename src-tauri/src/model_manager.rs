use futures_util::StreamExt;
use reqwest::{Client, Response, StatusCode};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// In the target network the official resolver is frequently unreachable, so use
// the mirror first and retain the official resolver as a fallback.
const HF_ENDPOINTS: [&str; 2] = ["https://hf-mirror.com", "https://huggingface.co"];

#[derive(Clone, Copy)]
struct WhisperModelSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    size_mb: u64,
    files: &'static [&'static str],
}

const MODEL_FILES: &[&str] = &[
    "config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.txt",
];

const MODEL_SPECS: &[WhisperModelSpec] = &[
    WhisperModelSpec {
        id: "tiny",
        name: "Whisper Tiny",
        description: "最快、占用空间最小，适合快速记录和低配电脑。",
        size_mb: 75,
        files: MODEL_FILES,
    },
    WhisperModelSpec {
        id: "base",
        name: "Whisper Base",
        description: "速度和准确率平衡，中文口述的默认推荐。",
        size_mb: 145,
        files: MODEL_FILES,
    },
    WhisperModelSpec {
        id: "small",
        name: "Whisper Small",
        description: "准确率更高，但需要更多磁盘空间和计算时间。",
        size_mb: 465,
        files: MODEL_FILES,
    },
    WhisperModelSpec {
        id: "medium",
        name: "Whisper Medium",
        description: "更强的多语言识别能力，适合长期口述史整理。",
        size_mb: 1530,
        files: MODEL_FILES,
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size_mb: u64,
    pub installed: bool,
    pub downloading: bool,
    pub partial_size: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperDownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
    pub current_file: String,
    pub status: String,
}

struct ActiveDownload {
    cancelled: Arc<AtomicBool>,
}

pub struct WhisperModelManager {
    default_dir: PathBuf,
    active: Mutex<std::collections::HashMap<String, ActiveDownload>>,
}

impl WhisperModelManager {
    pub fn new(default_dir: PathBuf) -> Self {
        Self {
            default_dir,
            active: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn default_dir(&self) -> &Path {
        &self.default_dir
    }

    pub fn resolve_dir(&self, requested: Option<&str>) -> Result<PathBuf, String> {
        let path = requested
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_dir.clone());
        if path.exists() && !path.is_dir() {
            return Err(format!("模型存放位置不是文件夹：{}", path.display()));
        }
        fs::create_dir_all(&path).map_err(|e| format!("无法创建模型存放位置：{}", e))?;
        Ok(path)
    }

    pub fn list(&self, requested_dir: Option<&str>) -> Result<Vec<WhisperModelInfo>, String> {
        let root = self.resolve_dir(requested_dir)?;
        let active = self.active.lock().map_err(|e| e.to_string())?;
        let mut models = MODEL_SPECS
            .iter()
            .map(|spec| {
                let model_path = root.join(spec.id);
                let partial_dir = root.join(format!(".{}.download", spec.id));
                let installed = is_complete_model(&model_path);
                let partial_size = directory_size(&partial_dir);
                WhisperModelInfo {
                    id: spec.id.to_string(),
                    name: spec.name.to_string(),
                    description: spec.description.to_string(),
                    size_mb: spec.size_mb,
                    installed,
                    downloading: active.contains_key(spec.id),
                    partial_size,
                    path: model_path.to_string_lossy().to_string(),
                }
            })
            .collect::<Vec<_>>();
        models.sort_by_key(|model| match model.id.as_str() {
            "tiny" => 0,
            "base" => 1,
            "small" => 2,
            "medium" => 3,
            _ => 99,
        });
        Ok(models)
    }

    pub fn cancel(&self, model_id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|e| e.to_string())?;
        if let Some(download) = active.get(model_id) {
            download.cancelled.store(true, Ordering::SeqCst);
            Ok(())
        } else {
            Err(format!("模型 {} 当前没有正在进行的下载", model_id))
        }
    }

    pub fn delete(&self, model_id: &str, requested_dir: Option<&str>) -> Result<(), String> {
        let root = self.resolve_dir(requested_dir)?;
        if self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(model_id)
        {
            return Err("请先取消正在进行的下载".to_string());
        }
        let spec = find_spec(model_id).ok_or_else(|| format!("未知的模型：{}", model_id))?;
        let final_dir = root.join(spec.id);
        let partial_dir = root.join(format!(".{}.download", spec.id));
        let mut removed = false;
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir).map_err(|e| format!("删除模型失败：{}", e))?;
            removed = true;
        }
        if partial_dir.exists() {
            fs::remove_dir_all(&partial_dir).map_err(|e| format!("删除未完成下载失败：{}", e))?;
            removed = true;
        }
        if !removed {
            return Err("没有找到可删除的模型文件".to_string());
        }
        Ok(())
    }

    pub async fn download(
        &self,
        app: &AppHandle,
        model_id: &str,
        requested_dir: Option<&str>,
    ) -> Result<(), String> {
        let spec = find_spec(model_id).ok_or_else(|| format!("未知的模型：{}", model_id))?;
        let root = self.resolve_dir(requested_dir)?;
        let final_dir = root.join(spec.id);
        if is_complete_model(&final_dir) {
            return Ok(());
        }
        if final_dir.exists() {
            return Err(format!(
                "模型目录已存在但不完整，请先删除后重新下载：{}",
                final_dir.display()
            ));
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut active = self.active.lock().map_err(|e| e.to_string())?;
            if active.contains_key(model_id) {
                return Err("该模型已经在下载中".to_string());
            }
            active.insert(
                model_id.to_string(),
                ActiveDownload {
                    cancelled: cancelled.clone(),
                },
            );
        }

        let partial_dir = root.join(format!(".{}.download", spec.id));
        let result = self
            .download_inner(app, spec, &partial_dir, &final_dir, cancelled)
            .await;
        self.active
            .lock()
            .map_err(|e| e.to_string())?
            .remove(model_id);
        result
    }

    async fn download_inner(
        &self,
        app: &AppHandle,
        spec: &WhisperModelSpec,
        partial_dir: &Path,
        final_dir: &Path,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), String> {
        fs::create_dir_all(partial_dir).map_err(|e| format!("无法创建临时下载目录：{}", e))?;
        let client = Client::builder()
            .user_agent("sound-to-essay model manager")
            .connect_timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("无法初始化下载器：{}", e))?;
        let estimated_total = spec.size_mb.saturating_mul(1024 * 1024);

        for filename in spec.files {
            if cancelled.load(Ordering::SeqCst) {
                return self.cancelled(app, spec.id);
            }
            let destination = partial_dir.join(filename);
            let part_path = partial_dir.join(format!("{}.part", filename));
            if destination.is_file() {
                continue;
            }
            let mut resume_from = fs::metadata(&part_path).map(|meta| meta.len()).unwrap_or(0);
            // Handy emits an initial event before the response body arrives. This
            // keeps the UI honest when a Hugging Face/Xet redirect is slow.
            emit_progress(
                app,
                spec.id,
                directory_size(partial_dir),
                estimated_total,
                filename,
                "connecting",
            );
            let mut response = request_file(&client, spec.id, filename, resume_from).await?;
            if resume_from > 0 && response.status() == StatusCode::OK {
                fs::remove_file(&part_path).ok();
                resume_from = 0;
                response = request_file(&client, spec.id, filename, 0).await?;
            }
            if !response.status().is_success() && response.status() != StatusCode::PARTIAL_CONTENT {
                return Err(format!(
                    "下载 {} 失败：HTTP {}",
                    filename,
                    response.status()
                ));
            }

            let response_total = response
                .content_length()
                .map(|length| length.saturating_add(resume_from));
            let total = response_total
                .map(|file_total| {
                    estimated_total.max(directory_size(partial_dir).saturating_add(file_total))
                })
                .unwrap_or(estimated_total);
            emit_progress(
                app,
                spec.id,
                directory_size(partial_dir),
                total,
                filename,
                "downloading",
            );

            let mut file = if resume_from > 0 {
                fs::OpenOptions::new()
                    .append(true)
                    .open(&part_path)
                    .map_err(|e| format!("无法继续写入 {}：{}", filename, e))?
            } else {
                fs::File::create(&part_path).map_err(|e| format!("无法创建 {}：{}", filename, e))?
            };
            let mut stream = response.bytes_stream();
            let mut last_emit = Instant::now();
            loop {
                let next_chunk = tokio::time::timeout(Duration::from_secs(60), stream.next())
                    .await
                    .map_err(|_| {
                        format!("下载 {} 已 60 秒未收到数据，请检查网络或重试", filename)
                    })?;
                let Some(chunk) = next_chunk else {
                    break;
                };
                if cancelled.load(Ordering::SeqCst) {
                    drop(file);
                    return self.cancelled(app, spec.id);
                }
                let chunk = chunk.map_err(|e| format!("下载 {} 时网络中断：{}", filename, e))?;
                file.write_all(&chunk)
                    .map_err(|e| format!("保存 {} 失败：{}", filename, e))?;
                if last_emit.elapsed() >= Duration::from_millis(100) {
                    emit_progress(
                        app,
                        spec.id,
                        directory_size(partial_dir),
                        total,
                        filename,
                        "downloading",
                    );
                    last_emit = Instant::now();
                }
            }
            file.flush()
                .map_err(|e| format!("完成 {} 写入失败：{}", filename, e))?;
            drop(file);
            fs::rename(&part_path, &destination)
                .map_err(|e| format!("整理 {} 下载文件失败：{}", filename, e))?;
            emit_progress(
                app,
                spec.id,
                directory_size(partial_dir),
                total,
                filename,
                "downloading",
            );
        }

        if cancelled.load(Ordering::SeqCst) {
            return self.cancelled(app, spec.id);
        }
        if !is_complete_model(partial_dir) {
            return Err("模型下载完成但缺少必要文件，请重试".to_string());
        }
        let _ = app.emit("whisper-model-verification-started", spec.id);
        verify_model_files(partial_dir)?;
        if final_dir.exists() {
            fs::remove_dir_all(final_dir).map_err(|e| format!("替换旧模型目录失败：{}", e))?;
        }
        fs::rename(partial_dir, final_dir).map_err(|e| format!("模型安装失败：{}", e))?;
        let installed_size = directory_size(final_dir);
        emit_progress(
            app,
            spec.id,
            installed_size,
            installed_size,
            "完成",
            "completed",
        );
        let _ = app.emit("whisper-model-download-complete", spec.id);
        Ok(())
    }

    fn cancelled(&self, app: &AppHandle, model_id: &str) -> Result<(), String> {
        let _ = app.emit("whisper-model-download-cancelled", model_id);
        Err("下载已取消，已保留已下载部分，下次可继续".to_string())
    }
}

fn find_spec(model_id: &str) -> Option<&'static WhisperModelSpec> {
    MODEL_SPECS.iter().find(|spec| spec.id == model_id)
}

fn model_repo(model_id: &str) -> String {
    format!("Systran/faster-whisper-{}", model_id)
}

async fn request_file(
    client: &Client,
    model_id: &str,
    filename: &str,
    resume_from: u64,
) -> Result<Response, String> {
    let mut last_error = String::new();
    for endpoint in HF_ENDPOINTS {
        let url = format!(
            "{}/{}/resolve/main/{}?download=true",
            endpoint,
            model_repo(model_id),
            filename
        );
        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }
        match request.send().await {
            Ok(response)
                if response.status().is_success()
                    || response.status() == StatusCode::PARTIAL_CONTENT =>
            {
                return Ok(response)
            }
            Ok(response) => last_error = format!("HTTP {}", response.status()),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("无法下载 {}：{}", filename, last_error))
}

fn is_complete_model(path: &Path) -> bool {
    path.is_dir()
        && path.join("config.json").is_file()
        && path.join("model.bin").is_file()
        && path.join("tokenizer.json").is_file()
        && (path.join("vocabulary.txt").is_file() || path.join("vocabulary.json").is_file())
}

fn verify_model_files(path: &Path) -> Result<(), String> {
    let required = ["config.json", "model.bin", "tokenizer.json"];
    for filename in required {
        let file = path.join(filename);
        let metadata = fs::metadata(&file).map_err(|e| format!("校验 {} 失败：{}", filename, e))?;
        if metadata.len() == 0 {
            return Err(format!("模型文件为空：{}", filename));
        }
    }
    let vocabulary = if path.join("vocabulary.txt").is_file() {
        path.join("vocabulary.txt")
    } else {
        path.join("vocabulary.json")
    };
    let metadata = fs::metadata(&vocabulary).map_err(|e| format!("校验词表失败：{}", e))?;
    if metadata.len() == 0 {
        return Err("模型词表文件为空".to_string());
    }
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    if !path.is_dir() {
        return 0;
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}

fn emit_progress(
    app: &AppHandle,
    model_id: &str,
    downloaded: u64,
    total: u64,
    filename: &str,
    status: &str,
) {
    let percentage = if total == 0 {
        0.0
    } else {
        ((downloaded as f64 / total as f64) * 100.0).min(100.0)
    };
    let _ = app.emit(
        "whisper-model-download-progress",
        WhisperDownloadProgress {
            model_id: model_id.to_string(),
            downloaded,
            total,
            percentage,
            current_file: filename.to_string(),
            status: status.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_validation_requires_faster_whisper_files() {
        let path = std::env::temp_dir().join(format!(
            "sound-to-essay-model-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("config.json"), "{}").unwrap();
        fs::write(path.join("model.bin"), "model").unwrap();
        fs::write(path.join("tokenizer.json"), "{}").unwrap();
        assert!(!is_complete_model(&path));
        fs::write(path.join("vocabulary.txt"), "vocab").unwrap();
        assert!(is_complete_model(&path));
        fs::remove_dir_all(path).unwrap();
    }
}
