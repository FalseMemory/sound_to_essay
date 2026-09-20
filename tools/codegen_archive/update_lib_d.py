
path = r'F:/AI/sound_to_essay/src-tauri/src/lib.rs'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add commands before migrate_legacy_projects
old = '''#[tauri::command]
fn migrate_legacy_projects(state: State<'_, AppState>) -> Result<MigrationReport, String> {'''

new = '''#[tauri::command]
fn get_chapter_with_drafts(state: State<'_, AppState>, chapter_id: String) -> Result<Option<library::ChapterWithDrafts>, String> {
    state.library.get_chapter_with_drafts(&chapter_id)
}

#[tauri::command]
fn create_chapter_draft(state: State<'_, AppState>, chapter_id: String, content: String, draft_type: String, processing_type: Option<String>, provider: Option<String>, model: Option<String>) -> Result<library::ChapterDraft, String> {
    state.library.create_chapter_draft(&chapter_id, content, draft_type, processing_type, provider, model)
}

#[tauri::command]
fn delete_chapter_draft(state: State<'_, AppState>, draft_id: String) -> Result<(), String> {
    state.library.delete_chapter_draft(&draft_id)
}

#[tauri::command]
async fn ai_generate_chapter_draft(
    state: State<'_, AppState>,
    chapter_id: String,
    memory_ids: Vec<String>,
    style: String,
    config: LLMConfig,
) -> Result<library::ChapterDraft, String> {
    log::info!("AI generate chapter draft for chapter={}", chapter_id);
    if config.base_url.is_empty() || config.model_name.is_empty() {
        return Err("LLM 未配置：请先在设置中填写 API 地址和模型名称。".to_string());
    }

    let memories = state.library.list_memories_by_filter(&state.library.list_projects()?.get(0).map(|p| p.id.clone()).unwrap_or_default(), "", "")?;
    let selected_memories: Vec<_> = memories.into_iter().filter(|m| memory_ids.contains(&m.id)).collect();
    
    let material = selected_memories.iter().map(|m| {
        let detail = state.library.get_memory(&m.id).ok().flatten();
        let text = detail.and_then(|d| d.text_versions.iter().find(|v| v.is_current).map(|v| v.content.clone())).unwrap_or_default();
        format!("## {}\n{}\n", m.title, text)
    }).collect::<Vec<_>>().join("\n");

    let system_prompt = format!("你是一位回忆录撰稿人。根据用户提供的素材，撰写一个章节的草稿。\n\n写作风格要求：{}\n\n核心约束（必须遵守）：\n1. 不虚构任何事实。\n2. 不擅自补充日期、地点、人物关系和对话。\n3. 无法确定的信息保留不确定性。\n4. 只输出章节正文，不要添加任何说明。", style);
    let user_prompt = format!("请根据以下素材撰写章节草稿：\n\n{}", material);
    
    let result = llm::chat_completion(&config, &system_prompt, &user_prompt).await?;
    
    let provider = if config.base_url.contains("localhost") || config.base_url.contains("127.0.0.1") {
        Some("ollama".to_string())
    } else {
        Some("openai-compatible".to_string())
    };
    
    state.library.create_chapter_draft(&chapter_id, result, "ai_draft".to_string(), Some("chapter_generation".to_string()), provider, Some(config.model_name))
}

#[tauri::command]
fn migrate_legacy_projects(state: State<'_, AppState>) -> Result<MigrationReport, String> {'''

content = content.replace(old, new)

# Register in generate_handler
old_handler = '''            migrate_legacy_projects,
            create_chapter,'''
new_handler = '''            migrate_legacy_projects,
            get_chapter_with_drafts,
            create_chapter_draft,
            delete_chapter_draft,
            ai_generate_chapter_draft,
            create_chapter,'''

content = content.replace(old_handler, new_handler)

# Add imports
old_import = '''use library::{CreateMemoryInput, Library, LibraryProject, MemoryDetail, MemorySummary, MigrationReport, TextVersion, UpdateMemoryInput, Chapter, ChapterDetail};'''
new_import = '''use library::{CreateMemoryInput, Library, LibraryProject, MemoryDetail, MemorySummary, MigrationReport, TextVersion, UpdateMemoryInput, Chapter, ChapterDetail, ChapterWithDrafts, ChapterDraft};'''

content = content.replace(old_import, new_import)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('lib.rs updated')
