mod backup;
mod hotkey;
mod importer;
mod library;
mod pack_import;
mod llm;
mod model_manager;
mod project;
mod recorder;
mod stt;

use llm::LLMConfig;
use library::{CreateMemoryInput, Library, LibraryProject, MemoryDetail, MemorySummary, MigrationReport, RegisterRecordingInput, RegisteredRecording, TextVersion, TranscriptionTask, UpdateMemoryInput};
use model_manager::{WhisperModelInfo, WhisperModelManager};
use project::Project;
use recorder::Recorder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    recorder: Mutex<Recorder>,
    audio_dir: PathBuf,
    app_data_dir: PathBuf,
    hotkey: Mutex<Option<String>>,
    whisper_models: WhisperModelManager,
    library: Library,
}

/// Development builds use the project root; release builds use %APPDATA%
/// so that installed applications (e.g. under C:\Program Files) can write
/// without UAC elevation.
fn default_whisper_models_dir(app_data: &PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .unwrap_or(manifest_dir.as_path())
            .join("models");
    }
    app_data.join("models")
}

/// Store original recordings beside the application. Development builds live
/// below `src-tauri/target`, so they use the project root instead.
/// Release builds write to %APPDATA% to avoid UAC issues.
fn default_sounds_dir(app_data: &PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .unwrap_or(manifest_dir.as_path())
            .join("sounds");
    }
    app_data.join("sounds")
}

/// The long-term library must remain beside the local application data users
/// can back up directly.  Release builds use %APPDATA% to avoid UAC issues.
fn default_library_db_path(app_data: &PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .unwrap_or(manifest_dir.as_path())
            .join("data")
            .join("oral_history.sqlite3");
    }
    app_data.join("data").join("oral_history.sqlite3")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordResult {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

/// A1: 启动恢复结果——复位了多少中断任务、抢救了多少条已落盘录音。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryOutcome {
    pub reset_tasks: usize,
    pub recovered_recordings: usize,
    pub registered_memory_ids: Vec<String>,
    pub failures: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub text: String,
    pub confidence: f64,
}

#[tauri::command]
fn start_recording(state: State<'_, AppState>) -> Result<(), String> {
    let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
    rec.start()
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> Result<RecordResult, String> {
    let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
    let finished = rec.stop()?;
    Ok(RecordResult {
        audio_path: finished.audio_path,
        duration_secs: finished.duration_secs,
        sample_rate: finished.sample_rate,
    })
}

#[tauri::command]
fn is_recording(state: State<'_, AppState>) -> bool {
    state.recorder.lock().map(|r| r.is_recording()).unwrap_or(false)
}

#[tauri::command]
async fn transcribe_audio(
    state: State<'_, AppState>,
    audio_path: String,
    model_size: String,
    language: String,
    model_dir: Option<String>,
) -> Result<TranscribeResult, String> {
    log::info!("Transcribing: {} with model {} language {}", audio_path, model_size, language);
    let model_cache_dir = state.app_data_dir.join("models");
    fs::create_dir_all(&model_cache_dir).map_err(|e| format!("无法创建模型缓存目录: {}", e))?;
    let selected_model_dir = state.whisper_models.resolve_dir(model_dir.as_deref())?;
    let result = stt::transcribe(
        &audio_path,
        &model_size,
        &language,
        &model_cache_dir,
        &selected_model_dir,
    )?;
    Ok(TranscribeResult {
        text: result.text,
        confidence: result.confidence,
    })
}

// --- A1: recording registration and decoupled transcription ---

/// A1：录音落盘后**先登记**记忆、音频资产与 `pending` 转写任务，再执行转写。
/// 因此转写失败或应用崩溃都不会让音频变成"未引用的孤儿文件"而被清理删除。
#[tauri::command]
fn register_recording(
    state: State<'_, AppState>,
    input: RegisterRecordingInput,
) -> Result<RegisteredRecording, String> {
    let path = PathBuf::from(&input.audio_path);
    let registered = state.library.register_recording(input)?;
    recorder::acknowledge_recording(&path);
    Ok(registered)
}

#[tauri::command]
fn list_transcription_tasks(
    state: State<'_, AppState>,
    project_id: Option<String>,
    only_unfinished: Option<bool>,
) -> Result<Vec<TranscriptionTask>, String> {
    state.library.list_transcription_tasks(project_id.as_deref(), only_unfinished.unwrap_or(false))
}

/// A1：对已登记的记忆执行转写，任务状态持久化为 pending → processing → success/failed。
/// 失败时保留记忆与原始音频；再次调用同一命令即为"重新转写"。
#[tauri::command]
async fn transcribe_memory(
    state: State<'_, AppState>,
    memory_id: String,
    model_size: String,
    language: String,
    model_dir: Option<String>,
) -> Result<TranscribeResult, String> {
    let task = state
        .library
        .get_transcription_task(&memory_id)?
        .ok_or_else(|| "该记忆尚未登记转写任务".to_string())?;
    if task.status == library::TRANSCRIPTION_SUCCESS {
        return Err("该记忆的原始转写已完成，无需重复转写".to_string());
    }
    state.library.mark_transcription_processing(&task.id, &model_size, &language)?;

    log::info!("Transcribing memory {} ({}), attempt {}", memory_id, task.audio_path, task.attempts + 1);

    let model_cache_dir = state.app_data_dir.join("models");
    if let Err(error) = fs::create_dir_all(&model_cache_dir) {
        let message = format!("无法创建模型缓存目录: {}", error);
        let _ = state.library.mark_transcription_failed(&task.id, &message);
        return Err(message);
    }
    let selected_model_dir = match state.whisper_models.resolve_dir(model_dir.as_deref()) {
        Ok(dir) => dir,
        Err(error) => {
            let _ = state.library.mark_transcription_failed(&task.id, &error);
            return Err(error);
        }
    };
    let recognized = match stt::transcribe(&task.audio_path, &model_size, &language, &model_cache_dir, &selected_model_dir) {
        Ok(result) => result,
        Err(error) => {
            // 失败也要把状态落库，避免永久停留在"处理中"。
            let _ = state.library.mark_transcription_failed(&task.id, &error);
            return Err(error);
        }
    };

    let payload = TranscribeResult { text: recognized.text, confidence: recognized.confidence };
    state.library.mark_transcription_success(&task.id, &payload.text)?;
    log::info!("Memory {} transcribed ({} chars)", memory_id, payload.text.chars().count());
    Ok(payload)
}

/// A1：启动恢复。把上次异常退出遗留的 `processing` 任务复位为 `pending`，
/// 并把已落盘的录音片段抢救为可播放的 WAV 后登记为记忆（含待转写任务）。
#[tauri::command]
fn recover_interrupted_recordings(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<RecoveryOutcome, String> {
    recover_interrupted(&state, project_id.as_deref())
}

fn recover_interrupted(state: &AppState, project_id: Option<&str>) -> Result<RecoveryOutcome, String> {
    let reset_tasks = state.library.reset_interrupted_transcriptions().unwrap_or_else(|error| {
        log::error!("Cannot reset interrupted transcriptions: {}", error);
        0
    });
    if reset_tasks > 0 {
        log::warn!("已把 {} 个未完成的转写任务复位为待转写", reset_tasks);
    }

    let salvaged = recorder::recover_partial_recordings(&state.audio_dir);
    let mut registered_memory_ids = Vec::new();
    let mut failures = Vec::new();
    if !salvaged.is_empty() {
        match resolve_recovery_project(state, project_id) {
            Ok(target) => {
                for item in salvaged {
                    if state.library.referenced_audio_paths()?.iter().any(|p| normalize_audio_path(p) == normalize_audio_path(&item.audio_path)) {
                        recorder::acknowledge_recording(PathBuf::from(&item.audio_path).as_path());
                        continue;
                    }
                    log::info!("抢救录音片段 {} -> {}", item.partial_id, item.audio_path);
                    let title = format!("⚠️ 恢复的录音 {}", item.started_at.get(..19).unwrap_or(item.started_at.as_str()));
                    let input = RegisterRecordingInput {
                        project_id: target.clone(),
                        audio_path: item.audio_path.clone(),
                        duration_secs: item.duration_secs,
                        sample_rate: Some(item.sample_rate as i64),
                        recorded_at: Some(item.started_at.clone()),
                        title: Some(title),
                        original_filename: None,
                        source_format: Some("wav".to_string()),
                        file_checksum: None,
                    };
                    match state.library.register_recording(input) {
                        Ok(registered) => {
                            recorder::acknowledge_recording(PathBuf::from(&item.audio_path).as_path());
                            registered_memory_ids.push(registered.memory.id);
                        }
                        Err(error) => {
                            log::error!("无法登记恢复的录音 {}: {}", item.audio_path, error);
                            failures.push(format!("{}: {}", item.audio_path, error));
                        }
                    }
                }
            }
            Err(error) => failures.push(error),
        }
    }

    Ok(RecoveryOutcome {
        reset_tasks,
        recovered_recordings: registered_memory_ids.len(),
        registered_memory_ids,
        failures,
    })
}

/// 恢复的录音需要一个归属项目：优先用调用方指定的，其次最近使用的资料库项目，
/// 都没有时创建一个"录音恢复"项目，确保抢救出来的音频一定能被找到。
fn resolve_recovery_project(state: &AppState, project_id: Option<&str>) -> Result<String, String> {
    if let Some(id) = project_id.filter(|value| !value.trim().is_empty()) {
        return Ok(id.to_string());
    }
    if let Some(project) = state.library.list_projects()?.into_iter().next() {
        return Ok(project.id);
    }
    Ok(state.library.create_project("录音恢复")?.id)
}

// --- B1: import iPhone recordings ---

/// B1：探测单个待导入音频，返回格式/时长/采样率及是否已导入（供前端预览）。
#[tauri::command]
fn inspect_import_file(state: State<'_, AppState>, source_path: String) -> Result<importer::ImportCandidate, String> {
    Ok(importer::inspect_candidate(&state.library, PathBuf::from(source_path).as_path()))
}

/// B1：导入音频。复制原文件到应用目录，非 WAV 转码出独立派生 WAV，登记为记忆
/// + 音频资产（含原始文件名/实际格式/校验值）并创建待转写任务。损坏文件报错，
/// 不留伪成功记录。
#[tauri::command]
fn import_audio_file(
    state: State<'_, AppState>,
    project_id: String,
    source_path: String,
) -> Result<importer::ImportOutcome, String> {
    importer::import_audio(&state.library, &state.audio_dir, &project_id, PathBuf::from(source_path).as_path())
}

// --- B3: pack import ---

/// B3：预览素材包（解析 + 校验 + 统计重复/冲突/缺失）。
#[tauri::command]
fn preview_pack(state: State<'_, AppState>, project_id: String, pack_path: String) -> Result<pack_import::PackPreview, String> {
    pack_import::preview_pack(&state.library, &project_id, PathBuf::from(pack_path).as_path())
}

/// B3：导入素材包。按 recordId 去重，revision 大者更新，冲突保留双方。
#[tauri::command]
fn import_pack(
    state: State<'_, AppState>,
    project_id: String,
    pack_path: String,
) -> Result<pack_import::PackImportOutcome, String> {
    pack_import::import_pack(&state.library, &state.audio_dir, &project_id, PathBuf::from(pack_path).as_path())
}

// --- Whisper model management ---

#[tauri::command]
fn get_default_whisper_model_dir(state: State<'_, AppState>) -> String {
    state.whisper_models.default_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn list_whisper_models(
    state: State<'_, AppState>,
    model_dir: Option<String>,
) -> Result<Vec<WhisperModelInfo>, String> {
    state.whisper_models.list(model_dir.as_deref())
}

#[tauri::command]
async fn download_whisper_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
    model_dir: Option<String>,
) -> Result<(), String> {
    state
        .whisper_models
        .download(&app, &model_id, model_dir.as_deref())
        .await
}

#[tauri::command]
fn cancel_whisper_model_download(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    state.whisper_models.cancel(&model_id)
}

#[tauri::command]
fn delete_whisper_model(
    state: State<'_, AppState>,
    model_id: String,
    model_dir: Option<String>,
) -> Result<(), String> {
    state.whisper_models.delete(&model_id, model_dir.as_deref())
}

#[tauri::command]
async fn ai_polish(text: String, tier: String, config: LLMConfig) -> Result<String, String> {
    log::info!("AI polishing text ({} chars), tier={}", text.len(), tier);
    let tier = if tier.is_empty() { "faithful".to_string() } else { tier };
    llm::process_text(&config, "polish", &text, &tier).await
}

#[tauri::command]
async fn generate_essay(
    text: String,
    style_prompt: String,
    word_count: i32,
    config: LLMConfig,
) -> Result<String, String> {
    log::info!("Generating essay (style: {})", style_prompt);
    let system_prompt = "你是一位散文作家。根据用户的素材和风格要求，创作一篇优美的散文。\
        要求：标题自拟，要有场景感和画面感，素材中的细节尽量使用，不要凭空编造核心事实。\
        只输出散文正文，不要添加任何说明文字。";
    let user_prompt = format!(
        "{}\n\n以下是用户的原始素材：\n```\n{}\n```\n\n请写一篇约 {} 字的散文。",
        style_prompt, text, word_count
    );
    llm::chat_completion(&config, system_prompt, &user_prompt).await
}

#[tauri::command]
async fn ai_process_memory(
    state: State<'_, AppState>,
    memory_id: String,
    version_id: Option<String>,
    processing_type: String,
    tier: String,
    config: LLMConfig,
) -> Result<TextVersion, String> {
    log::info!("AI process memory={} type={} tier={}", memory_id, processing_type, tier);

    // Validate config before network request
    if config.base_url.is_empty() || config.model_name.is_empty() {
        return Err("LLM 未配置：请先在设置中填写 API 地址和模型名称。".to_string());
    }

    // 文学化改写天生属于创作档，忽略前端可能误传的保真档。
    let effective_tier = if processing_type == "rewrite" {
        "creative".to_string()
    } else if tier.is_empty() {
        "faithful".to_string()
    } else {
        tier.clone()
    };

    // Fetch memory detail
    let detail = state.library.get_memory(&memory_id)?
        .ok_or_else(|| "记忆不存在".to_string())?;

    // Determine input text
    let (input_text, parent_id) = if let Some(ref vid) = version_id {
        let v = detail.text_versions.iter()
            .find(|v| v.id == *vid)
            .ok_or_else(|| "指定版本不存在".to_string())?;
        (v.content.clone(), Some(vid.clone()))
    } else {
        let v = detail.text_versions.iter()
            .find(|v| v.is_current);
        match v {
            Some(current) => (current.content.clone(), Some(current.id.clone())),
            None => (String::new(), None),
        }
    };

    if input_text.trim().is_empty() {
        return Err("当前没有可处理的文本内容。".to_string());
    }

    // Call LLM
    let result = llm::process_text(&config, &processing_type, &input_text, &effective_tier).await?;

    // Skip creating a new version if the result is identical to the input
    if result.trim() == input_text.trim() {
        log::info!("ai_process_memory: result identical to input, skipping new version creation");
        let current = state.library.list_text_versions(&memory_id)?.into_iter()
            .find(|v| v.is_current)
            .ok_or_else(|| "无法找到当前版本".to_string())?;
        return Ok(current);
    }

    // Determine provider label
    let provider = if config.base_url.contains("localhost") || config.base_url.contains("127.0.0.1") {
        Some("ollama".to_string())
    } else {
        Some("openai-compatible".to_string())
    };

    // Determine a semantic version type from the processing type so the
    // version history reflects what actually happened (DESIGN 阶段 C).
    let version_type = match processing_type.as_str() {
        "rewrite" => "ai_rewrite",
        "summarize" => "ai_summary",
        "extract" => "ai_extract",
        "correct" => "ai_correct",
        _ => "ai_edit",
    }.to_string();

    // Save as new version
    state.library.create_text_version(
        &memory_id,
        result,
        version_type,
        Some(processing_type),
        parent_id,
        provider,
        Some(config.model_name),
        Some(effective_tier),
    )
}

#[tauri::command]
async fn test_llm_connection(config: LLMConfig) -> Result<String, String> {
    llm::test_connection(&config).await
}

// --- Project management ---

#[tauri::command]
fn create_project(state: State<'_, AppState>, name: String) -> Result<Project, String> {
    project::create_project(&state.app_data_dir, &name)
}

#[tauri::command]
fn save_project(state: State<'_, AppState>, project: Project) -> Result<(), String> {
    project::save_project(&state.app_data_dir, &project)
}

#[tauri::command]
fn load_project(state: State<'_, AppState>, project_id: String) -> Result<Project, String> {
    project::load_project(&state.app_data_dir, &project_id)
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<project::ProjectListItem>, String> {
    project::list_projects(&state.app_data_dir)
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    project::delete_project(&state.app_data_dir, &project_id)
}

#[tauri::command]
fn load_last_project_id(state: State<'_, AppState>) -> Result<Option<String>, String> {
    project::load_last_project_id(&state.app_data_dir)
}

#[tauri::command]
fn save_last_project_id(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    project::save_last_project_id(&state.app_data_dir, &project_id)
}

// --- Long-term oral-history library ---

#[tauri::command]
fn create_library_project(state: State<'_, AppState>, name: String) -> Result<LibraryProject, String> {
    state.library.create_project(&name)
}

#[tauri::command]
fn list_library_projects(state: State<'_, AppState>) -> Result<Vec<LibraryProject>, String> {
    state.library.list_projects()
}

#[tauri::command]
fn delete_library_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    state.library.delete_library_project(&project_id)
}

#[tauri::command]
fn create_memory(state: State<'_, AppState>, input: CreateMemoryInput) -> Result<MemorySummary, String> {
    state.library.create_memory(input)
}

#[tauri::command]
fn list_memories(state: State<'_, AppState>, project_id: Option<String>, include_deleted: Option<bool>) -> Result<Vec<MemorySummary>, String> {
    state.library.list_memories(project_id.as_deref(), include_deleted.unwrap_or(false))
}

#[tauri::command]
fn get_memory(state: State<'_, AppState>, memory_id: String) -> Result<Option<MemoryDetail>, String> {
    state.library.get_memory(&memory_id)
}

#[tauri::command]
fn update_memory_metadata(state: State<'_, AppState>, input: UpdateMemoryInput) -> Result<MemorySummary, String> {
    state.library.update_memory_metadata(input)
}

#[tauri::command]
fn delete_memory(state: State<'_, AppState>, memory_id: String) -> Result<(), String> {
    state.library.delete_memory(&memory_id)
}

#[tauri::command]
fn restore_memory(state: State<'_, AppState>, memory_id: String) -> Result<(), String> {
    state.library.restore_memory(&memory_id)
}

#[tauri::command]
fn search_memories(state: State<'_, AppState>, query: String, project_id: Option<String>) -> Result<Vec<MemorySummary>, String> {
    state.library.search_memories(&query, project_id.as_deref())
}

#[tauri::command]
fn list_text_versions(state: State<'_, AppState>, memory_id: String) -> Result<Vec<TextVersion>, String> {
    state.library.list_text_versions(&memory_id)
}

#[tauri::command]
fn create_text_version(state: State<'_, AppState>, memory_id: String, content: String, version_type: String, processing_type: Option<String>, parent_version_id: Option<String>, provider: Option<String>, model: Option<String>, tier: Option<String>) -> Result<TextVersion, String> {
    state.library.create_text_version(&memory_id, content, version_type, processing_type, parent_version_id, provider, model, tier)
}

#[tauri::command]
fn restore_text_version(state: State<'_, AppState>, version_id: String) -> Result<TextVersion, String> {
    state.library.restore_text_version(&version_id)
}

#[tauri::command]
fn delete_text_version(state: State<'_, AppState>, version_id: String) -> Result<(), String> {
    state.library.delete_text_version(&version_id)
}

#[tauri::command]
fn set_memory_tags(state: State<'_, AppState>, memory_id: String, names: Vec<String>) -> Result<(), String> {
    state.library.set_memory_tags(&memory_id, names)
}

#[tauri::command]
fn set_memory_people(state: State<'_, AppState>, memory_id: String, names: Vec<String>) -> Result<(), String> {
    state.library.set_memory_people(&memory_id, names)
}

#[tauri::command]
fn create_chapter(state: State<'_, AppState>, project_id: String, title: String) -> Result<library::Chapter, String> {
    state.library.create_chapter(&project_id, &title)
}

#[tauri::command]
fn list_chapters(state: State<'_, AppState>, project_id: String) -> Result<Vec<library::Chapter>, String> {
    state.library.list_chapters(&project_id)
}

#[tauri::command]
fn get_chapter(state: State<'_, AppState>, chapter_id: String) -> Result<Option<library::ChapterDetail>, String> {
    state.library.get_chapter(&chapter_id)
}

#[tauri::command]
fn update_chapter(state: State<'_, AppState>, chapter_id: String, title: Option<String>, sort_order: Option<i64>) -> Result<library::Chapter, String> {
    state.library.update_chapter(&chapter_id, title.as_deref(), sort_order)
}

#[tauri::command]
fn delete_chapter(state: State<'_, AppState>, chapter_id: String) -> Result<(), String> {
    state.library.delete_chapter(&chapter_id)
}

#[tauri::command]
fn add_memory_to_chapter(state: State<'_, AppState>, chapter_id: String, memory_id: String) -> Result<(), String> {
    state.library.add_memory_to_chapter(&chapter_id, &memory_id)
}

#[tauri::command]
fn remove_memory_from_chapter(state: State<'_, AppState>, chapter_id: String, memory_id: String) -> Result<(), String> {
    state.library.remove_memory_from_chapter(&chapter_id, &memory_id)
}

#[tauri::command]
fn list_memory_chapters(state: State<'_, AppState>, memory_id: String) -> Result<Vec<library::Chapter>, String> {
    state.library.list_memory_chapters(&memory_id)
}

#[tauri::command]
fn list_memories_by_filter(state: State<'_, AppState>, project_id: String, filter_type: String, filter_value: String) -> Result<Vec<MemorySummary>, String> {
    state.library.list_memories_by_filter(&project_id, &filter_type, &filter_value)
}

#[tauri::command]
fn list_all_people(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, String> {
    state.library.list_all_people(&project_id)
}

#[tauri::command]
fn list_all_tags(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, String> {
    state.library.list_all_tags(&project_id)
}

#[tauri::command]
fn list_all_locations(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, String> {
    state.library.list_all_locations(&project_id)
}

#[tauri::command]
fn get_chapter_with_drafts(state: State<'_, AppState>, chapter_id: String) -> Result<Option<library::ChapterWithDrafts>, String> {
    state.library.get_chapter_with_drafts(&chapter_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn create_chapter_draft(
    state: State<'_, AppState>,
    chapter_id: String,
    content: String,
    draft_type: String,
    processing_type: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    tier: Option<String>,
    requirement: Option<String>,
    sources: Option<Vec<library::DraftSourceInput>>,
) -> Result<library::ChapterDraft, String> {
    state.library.create_chapter_draft(
        &chapter_id, content, draft_type, processing_type, provider, model, tier,
        requirement, sources.unwrap_or_default(),
    )
}

#[tauri::command]
fn delete_chapter_draft(state: State<'_, AppState>, draft_id: String) -> Result<(), String> {
    state.library.delete_chapter_draft(&draft_id)
}

/// A2：恢复历史草稿只切换当前草稿，不新建内容相同的副本。
#[tauri::command]
fn restore_chapter_draft(state: State<'_, AppState>, draft_id: String) -> Result<library::ChapterDraft, String> {
    state.library.restore_chapter_draft(&draft_id)
}

#[tauri::command]
async fn ai_generate_chapter_draft(
    state: State<'_, AppState>,
    chapter_id: String,
    memory_ids: Vec<String>,
    style: String,
    tier: String,
    config: LLMConfig,
) -> Result<library::ChapterDraft, String> {
    log::info!("AI generate chapter draft for chapter={} tier={}", chapter_id, tier);
    if config.base_url.is_empty() || config.model_name.is_empty() {
        return Err("LLM 未配置：请先在设置中填写 API 地址和模型名称。".to_string());
    }

    let effective_tier = if tier.is_empty() { "faithful".to_string() } else { tier.clone() };

    let selected_memories: Vec<MemorySummary> = memory_ids
        .iter()
        .filter_map(|id| state.library.get_memory(id).ok().flatten().map(|d| d.memory))
        .collect();
    if selected_memories.is_empty() {
        return Err("所选记忆不存在或已被删除，无法生成草稿。请检查章节关联的记忆。".to_string());
    }
    
    // A2：构建素材的同时记录**实际使用**的文本版本 ID。这些 ID 会随草稿一起落库，
    // 因此日后素材被改写、记忆被改名或移出章节，旧草稿仍能准确定位当时的输入版本。
    let mut sources: Vec<library::DraftSourceInput> = Vec::new();
    let mut sections: Vec<String> = Vec::new();
    for memory in &selected_memories {
        let detail = state.library.get_memory(&memory.id).ok().flatten();
        let current_version = detail
            .and_then(|d| d.text_versions.into_iter().find(|version| version.is_current));
        let text = current_version.as_ref().map(|version| version.content.clone()).unwrap_or_default();
        sources.push(library::DraftSourceInput {
            memory_id: memory.id.clone(),
            text_version_id: current_version.as_ref().map(|version| version.id.clone()),
        });
        sections.push(format!("## {}\n{}\n", memory.title, text));
    }
    let material = sections.join("\n");

    if material.trim().is_empty() {
        return Err("所选记忆均无可用的转写正文，无法生成草稿。请先为记忆生成或录入文字版本。".to_string());
    }

    let style = if style.trim().is_empty() {
        "平实、忠实于口述者原意，保留真实语气与细节。".to_string()
    } else {
        style
    };

    // 两档写作策略：
    // - faithful（校订·保真）：忠于口述原意，保留真实语气/方言/细节，不虚构、不文学化夸张。
    // - creative（文学化改写·创作）：可在不编造核心事实前提下润色、重组、增强画面感，
    //   并明确标注为创作性草稿。
    let tier_directive = if llm::tier_is_creative(&effective_tier) {
        "你处于「文学化改写·创作」档位：在保持核心事实不变的前提下，可对素材进行文学化润色、\
叙事重组与画面感增强。⚠️ 这是创作性草稿，属于文学创作而非原始事实记录，请在行文中自然体现但不虚构核心事实。"
    } else {
        "你处于「校订·保真」档位：严格忠实于口述者的原意与口吻，保留其真实语气、方言与细节，\
不虚构、不夸张、不擅自文学化改写。"
    };

    let system_prompt = format!("你是一位回忆录撰稿人。根据用户提供的素材，撰写一个章节的草稿。

写作风格要求：{}

{}

核心约束（必须遵守）：
1. 不虚构任何事实。
2. 不擅自补充日期、地点、人物关系和对话。
3. 无法确定的信息保留不确定性。
4. 只输出章节正文，不要添加任何说明。", style, tier_directive);
    let user_prompt = format!("请根据以下素材撰写章节草稿：

{}", material);
    
    let result = llm::chat_completion(&config, &system_prompt, &user_prompt).await?;
    
    let provider = if config.base_url.contains("localhost") || config.base_url.contains("127.0.0.1") {
        Some("ollama".to_string())
    } else {
        Some("openai-compatible".to_string())
    };
    
    // A2：落库时一并保存模型、处理档位、**写作要求**、生成时间（created_at）以及
    // 每条来源记忆与其文本版本 ID。
    state.library.create_chapter_draft(
        &chapter_id,
        result,
        "ai_draft".to_string(),
        Some("chapter_generation".to_string()),
        provider,
        Some(config.model_name),
        Some(effective_tier),
        Some(style),
        sources,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelatedMemorySuggestion {
    memory: MemorySummary,
    reason: String,
}

/// Suggest memories that share people / tags / locations with the chapter's
/// already-associated memories, excluding those already in the chapter.
/// Returns each candidate with a human-readable `reason` (关联依据).
#[tauri::command]
fn suggest_related_memories(
    state: State<'_, AppState>,
    chapter_id: String,
) -> Result<Vec<RelatedMemorySuggestion>, String> {
    let detail = state.library.get_chapter_with_drafts(&chapter_id)?
        .ok_or_else(|| "章节不存在".to_string())?;

    let mut people: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut tags: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut locations: std::collections::HashSet<String> = std::collections::HashSet::new();
    for m in &detail.memories {
        for p in &m.people { people.insert(p.clone()); }
        for t in &m.tags { tags.insert(t.clone()); }
        if let Some(loc) = &m.location {
            if !loc.is_empty() { locations.insert(loc.clone()); }
        }
    }
    if people.is_empty() && tags.is_empty() && locations.is_empty() {
        return Ok(Vec::new());
    }

    let associated: std::collections::HashSet<String> =
        detail.memories.iter().map(|m| m.id.clone()).collect();

    let all = state.library.list_memories(Some(&detail.chapter.project_id), false)?;
    let mut suggestions: Vec<RelatedMemorySuggestion> = Vec::new();
    for m in all {
        if associated.contains(&m.id) { continue; }
        let shared_people: Vec<&String> =
            m.people.iter().filter(|p| people.contains(*p)).collect();
        let shared_tags: Vec<&String> =
            m.tags.iter().filter(|t| tags.contains(*t)).collect();
        let shared_location = m.location.as_ref().map(|l| locations.contains(l)).unwrap_or(false);
        if shared_people.is_empty() && shared_tags.is_empty() && !shared_location {
            continue;
        }
        let mut reason_parts: Vec<String> = Vec::new();
        if !shared_people.is_empty() {
            reason_parts.push(format!(
                "同人物：{}",
                shared_people.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("、")
            ));
        }
        if !shared_tags.is_empty() {
            reason_parts.push(format!(
                "同标签：{}",
                shared_tags.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("、")
            ));
        }
        if shared_location {
            reason_parts.push(format!("同地点：{}", m.location.clone().unwrap_or_default()));
        }
        suggestions.push(RelatedMemorySuggestion {
            memory: m,
            reason: reason_parts.join("；"),
        });
    }
    // Prefer memories with more shared signals; cap the list.
    suggestions.sort_by(|a, b| b.reason.len().cmp(&a.reason.len()));
    suggestions.truncate(15);
    Ok(suggestions)
}

/// Build a single Markdown document combining every chapter of a project,
/// with each chapter's current draft and a source-memory annotation list.
#[tauri::command]
fn generate_book_markdown(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<String, String> {
    let chapters = state.library.list_chapters(&project_id)?;
    let mut out = String::new();
    out.push_str("# 回忆录合订本\n\n");
    out.push_str("> 由「声文 Voice to Essay」自动合订。各章节保留其来源记忆清单，便于溯源与核对。\n\n---\n\n");
    if chapters.is_empty() {
        out.push_str("_（本项目暂无章节）_\n");
        return Ok(out);
    }
    for chapter in &chapters {
        out.push_str(&format!("## {}\n\n", chapter.title));
        match state.library.get_chapter_with_drafts(&chapter.id)? {
            Some(cwd) => {
                let current = cwd.drafts.iter().find(|d| d.is_current);
                let content = current.map(|d| d.content.clone()).unwrap_or_default();
                if content.trim().is_empty() {
                    out.push_str("_（本章暂无草稿内容）_\n\n");
                } else {
                    out.push_str(&content);
                    out.push_str("\n\n");
                }
                if !cwd.memories.is_empty() {
                    out.push_str("> **本章来源记忆（可追溯）**：\n");
                    for m in &cwd.memories {
                        let when = m.event_date_text.clone()
                            .or(m.audio_recorded_at.clone())
                            .unwrap_or_else(|| "未标注时间".to_string());
                        out.push_str(&format!("> - {}（{}）\n", m.title, when));
                    }
                    out.push_str("\n");
                }
            }
            None => {
                out.push_str("_（章节数据缺失）_\n\n");
            }
        }
        out.push_str("---\n\n");
    }
    Ok(out)
}

#[tauri::command]
fn migrate_legacy_projects(state: State<'_, AppState>) -> Result<MigrationReport, String> {
    state.library.migrate_legacy_projects(&project::projects_dir(&state.app_data_dir))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioCleanupResult {
    scanned: usize,
    removed: usize,
    retained: usize,
}

// --- Cleanup ---

#[tauri::command]
fn cleanup_temp_audio(state: State<'_, AppState>, max_age_hours: u64) -> Result<usize, String> {
    if max_age_hours == 0 {
        return Ok(0);
    }
    let dir = &state.audio_dir;
    if !dir.exists() {
        return Ok(0);
    }
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = now.duration_since(modified) {
                    if duration.as_secs() > max_age_hours * 3600 {
                        std::fs::remove_file(entry.path()).ok();
                        removed += 1;
                    }
                }
            }
        }
    }
    log::info!("已清理 {} 个过期临时音频文件", removed);
    Ok(removed)
}

/// Delete only recordings in `sounds` which are no longer referenced by a
/// legacy workspace or by the long-term library.  This deliberately does not
/// touch files outside the application recording directory.
#[tauri::command]
fn cleanup_unreferenced_audio(
    state: State<'_, AppState>,
    active_audio_paths: Vec<String>,
) -> Result<AudioCleanupResult, String> {
    let mut referenced = std::collections::HashSet::new();
    // The UI supplies the active workspace paths as an additional safeguard:
    // autosave is asynchronous, so relying only on the on-disk .vse file can
    // briefly make a live recording look orphaned.
    for path in active_audio_paths {
        referenced.insert(normalize_audio_path(&path));
    }
    for project_item in project::list_projects(&state.app_data_dir)? {
        let loaded = project::load_project(&state.app_data_dir, &project_item.id)?;
        for clip in loaded.clips {
            if let Some(path) = clip.audio_path {
                referenced.insert(normalize_audio_path(&path));
            }
        }
    }
    for path in state.library.referenced_audio_paths()? {
        referenced.insert(normalize_audio_path(&path));
    }
    // A1: 待转写、转写失败等尚未成功转写的任务同样持有原始音频，必须保护，
    // 否则"转写失败但仍要保留音频"的承诺会被清理动作破坏。
    for path in state.library.transcription_protected_paths()? {
        referenced.insert(normalize_audio_path(&path));
    }
    // A1: 正在录制中的片段是 .pcm/.recording.json，不属于本次清理范围，
    // 显式记录下来以便诊断，绝不删除。
    for path in recorder::active_partial_files(&state.audio_dir) {
        referenced.insert(normalize_audio_path(&path.to_string_lossy()));
        log::info!("清理时跳过录制中的片段文件: {}", path.display());
    }

    let mut result = AudioCleanupResult { scanned: 0, removed: 0, retained: 0 };
    if !state.audio_dir.is_dir() { return Ok(result); }
    // 仅扫描 .wav：录制中的分片（.pcm）与恢复用的元数据（.recording.json）
    // 不在此列，天然不会被清理。
    for entry in fs::read_dir(&state.audio_dir).map_err(|e| format!("Cannot scan sounds directory: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("wav")) != Some(true) { continue; }
        result.scanned += 1;
        if referenced.contains(&normalize_audio_path(&path.to_string_lossy())) {
            result.retained += 1;
        } else {
            fs::remove_file(&path).map_err(|e| format!("Cannot remove unreferenced recording {}: {e}", path.display()))?;
            result.removed += 1;
        }
    }
    Ok(result)
}

fn normalize_audio_path(path: &str) -> String {
    let value = PathBuf::from(path);
    value
        .canonicalize()
        .unwrap_or(value)
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod cleanup_tests {
    use super::normalize_audio_path;

    #[test]
    fn audio_path_matching_ignores_windows_case_and_separators() {
        assert_eq!(
            normalize_audio_path("F:/AI/sound_to_essay/sounds/clip.wav"),
            normalize_audio_path("f:\\ai\\sound_to_essay\\sounds\\clip.wav"),
        );
    }
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<String, String> {
    let bytes = fs::read(&file_path).map_err(|e| format!("无法读取音频文件: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
#[tauri::command]
fn export_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("导出文件失败: {}", e))
}

// --- A3: complete backup & restore ---

/// A3：创建完整备份 ZIP（一致性数据库快照 + 被引用音频 + 含校验值的清单）。
#[tauri::command]
fn create_full_backup(state: State<'_, AppState>, archive_path: String) -> Result<backup::BackupOutcome, String> {
    backup::create_backup(&state.library, &state.audio_dir, PathBuf::from(archive_path).as_path())
}

/// A3：恢复前校验备份包并返回预览信息（格式版本、备份时间、音频数、
/// 本地缺失的音频数）。任何校验失败都返回 Err，调用方不得继续恢复。
#[tauri::command]
fn validate_backup(state: State<'_, AppState>, archive_path: String) -> Result<backup::RestorePreview, String> {
    backup::validate_backup(PathBuf::from(archive_path).as_path(), &state.audio_dir)
}

/// A3：恢复备份（替换当前数据库与音频）。调用前必须先 validate_backup 并让用户确认。
/// 恢复前会把当前数据库复制到 `current_db_backup_path` 作为"后悔药"。
#[tauri::command]
fn restore_full_backup(
    state: State<'_, AppState>,
    archive_path: String,
    current_db_backup_path: String,
) -> Result<backup::RestoreOutcome, String> {
    backup::restore_backup(
        &state.library,
        &state.audio_dir,
        PathBuf::from(archive_path).as_path(),
        PathBuf::from(current_db_backup_path).as_path(),
    )
}

// --- Settings ---

#[tauri::command]
fn load_settings(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.app_data_dir.join("config.json");
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取设置失败: {}", e))
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: String) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&settings)
        .map_err(|e| format!("设置内容不是有效 JSON: {}", e))?;
    let requested_hotkey = parsed
        .get("hotkey")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Ctrl+Alt+R")
        .to_string();

    let mut active_hotkey = state.hotkey.lock().map_err(|e| e.to_string())?;
    let previous_hotkey = active_hotkey.clone();
    if previous_hotkey.as_deref() != Some(requested_hotkey.as_str()) {
        hotkey::register(&app, &requested_hotkey)?;
        if let Some(previous) = previous_hotkey.as_deref() {
            hotkey::unregister(&app, previous).ok();
        }
        *active_hotkey = Some(requested_hotkey);
    }

    let path = state.app_data_dir.join("config.json");
    fs::write(&path, &settings).map_err(|e| format!("保存设置失败: {}", e))
}

/// Rotate SQLite backups: keep the last 3 copies.
/// oral_history.sqlite3 -> .backup.1 -> .backup.2 -> .backup.3 (deleted)
fn rotate_sqlite_backups(db_path: &PathBuf) -> Result<(), String> {
    if !db_path.is_file() {
        return Ok(());
    }
    let parent = db_path.parent().ok_or("Invalid db path")?;
    let stem = db_path.file_stem().unwrap_or_default();
    let ext = db_path.extension().unwrap_or_default();

    let oldest = parent.join(format!("{}.{}.backup.3", stem.to_string_lossy(), ext.to_string_lossy()));
    if oldest.exists() {
        fs::remove_file(&oldest).map_err(|e| e.to_string())?;
    }

    for i in (1..=2).rev() {
        let src = parent.join(format!("{}.{}.backup.{}", stem.to_string_lossy(), ext.to_string_lossy(), i));
        let dst = parent.join(format!("{}.{}.backup.{}", stem.to_string_lossy(), ext.to_string_lossy(), i + 1));
        if src.exists() {
            fs::rename(&src, &dst).map_err(|e| e.to_string())?;
        }
    }

    let backup1 = parent.join(format!("{}.{}.backup.1", stem.to_string_lossy(), ext.to_string_lossy()));
    fs::copy(db_path, &backup1).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .targets([
                            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("shengwen".into()) }),
                        ])
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("data"));

            let audio_dir = default_sounds_dir(&app_data);
            std::fs::create_dir_all(&audio_dir).ok();
            std::fs::create_dir_all(&app_data).ok();

            let recorder = Recorder::new(audio_dir.clone());
            log::info!("Recording directory: {}", audio_dir.display());
            let whisper_models_dir = default_whisper_models_dir(&app_data);
            let library_path = default_library_db_path(&app_data);
            std::fs::create_dir_all(&whisper_models_dir).ok();
            log::info!("Whisper model directory: {}", whisper_models_dir.display());
            log::info!("Oral-history library: {}", library_path.display());

            app.manage(AppState {
                recorder: Mutex::new(recorder),
                audio_dir,
                app_data_dir: app_data.clone(),
                hotkey: Mutex::new(None),
                whisper_models: WhisperModelManager::new(whisper_models_dir),
                library: Library::new(library_path.clone()),
            });

            if let Some(state) = app.try_state::<AppState>() {
                if let Err(error) = state.library.initialize() {
                    log::error!("Cannot initialize oral-history library: {}", error);
                } else {
                    if let Err(error) = state.library.migrate_legacy_projects(&project::projects_dir(&app_data)) {
                        log::error!("Cannot migrate legacy projects: {}", error);
                    }
                    // A1: 启动恢复。复位上次异常退出遗留的"处理中"转写任务，
                    // 并把崩溃前已落盘的录音片段抢救为可播放、可重转写的记忆。
                    match recover_interrupted(state.inner(), None) {
                        Ok(outcome) => {
                            if outcome.reset_tasks > 0 || outcome.recovered_recordings > 0 {
                                log::warn!(
                                    "启动恢复：复位 {} 个未完成转写任务，抢救 {} 条已落盘录音",
                                    outcome.reset_tasks, outcome.recovered_recordings
                                );
                            }
                            for failure in &outcome.failures {
                                log::error!("启动恢复失败: {}", failure);
                            }
                        }
                        Err(error) => log::error!("启动恢复失败: {}", error),
                    }
                }
            }

            // Rotate SQLite backups on startup (keep last 3)
            if let Err(e) = rotate_sqlite_backups(&library_path) {
                log::warn!("Failed to rotate library backup: {}", e);
            }

            let configured_hotkey = fs::read_to_string(
                app.path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("data"))
                    .join("config.json"),
            )
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
            .and_then(|settings| settings.get("hotkey").and_then(Value::as_str).map(str::to_owned))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Ctrl+Alt+R".to_string());

            match hotkey::register(app.handle(), &configured_hotkey) {
                Ok(()) => {
                    if let Some(state) = app.try_state::<AppState>() {
                        if let Ok(mut active) = state.hotkey.lock() {
                            *active = Some(configured_hotkey);
                        }
                    }
                }
                Err(error) => log::warn!("全局快捷键注册失败: {}", error),
            }

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("global-recording-toggle", shortcut.id());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording,
            transcribe_audio,
            register_recording,
            list_transcription_tasks,
            transcribe_memory,
            recover_interrupted_recordings,
            inspect_import_file,
            import_audio_file,
            preview_pack,
            import_pack,
            ai_polish,
            ai_process_memory,
            generate_essay,
            test_llm_connection,
            create_library_project,
            list_library_projects,
            delete_library_project,
            create_memory,
            list_memories,
            get_memory,
            update_memory_metadata,
            delete_memory,
            restore_memory,
            search_memories,
            list_text_versions,
            create_text_version,
            restore_text_version,
            delete_text_version,
            set_memory_tags,
            set_memory_people,
            migrate_legacy_projects,
            get_chapter_with_drafts,
            create_chapter_draft,
            delete_chapter_draft,
            restore_chapter_draft,
            ai_generate_chapter_draft,
            create_chapter,
            list_chapters,
            get_chapter,
            update_chapter,
            delete_chapter,
            add_memory_to_chapter,
            remove_memory_from_chapter,
            list_memory_chapters,
            list_memories_by_filter,
            list_all_people,
            list_all_tags,
            list_all_locations,
            cleanup_unreferenced_audio,
            create_project,
            save_project,
            load_project,
            list_projects,
            delete_project,
            load_last_project_id,
            save_last_project_id,
            cleanup_temp_audio,
            read_audio_file,
            export_file,
            create_full_backup,
            validate_backup,
            restore_full_backup,
            load_settings,
            save_settings,
            get_default_whisper_model_dir,
            list_whisper_models,
            download_whisper_model,
            cancel_whisper_model_download,
            delete_whisper_model,
            suggest_related_memories,
            generate_book_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}







