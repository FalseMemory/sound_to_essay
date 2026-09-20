
path = r'F:/AI/sound_to_essay/src-tauri/src/library.rs'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add chapter draft methods after list_all_locations, before set_named_links
marker = '''    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT location FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    fn set_named_links'''

new_methods = '''    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT location FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    // --- Chapter drafts ---

    pub fn get_chapter_with_drafts(&self, chapter_id: &str) -> Result<Option<ChapterWithDrafts>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let chapter = match connection.query_row(
            "SELECT id,project_id,title,sort_order,created_at,updated_at,deleted_at FROM chapters WHERE id=?1 AND deleted_at IS NULL", [chapter_id],
            |row| Ok(Chapter { id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?, sort_order: row.get(3)?, created_at: row.get(4)?, updated_at: row.get(5)?, deleted_at: row.get(6)? }),
        ).optional().map_err(|e| e.to_string())? {
            Some(c) => c,
            None => return Ok(None),
        };
        let mut stmt = connection.prepare(
            "SELECT memory_id FROM chapter_memories WHERE chapter_id=?1 ORDER BY sort_order, added_at"
        ).map_err(|e| e.to_string())?;
        let memory_ids: Vec<String> = stmt.query_map([chapter_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        let memories = memory_ids.iter().filter_map(|id| memory_summary(&connection, id).ok()).collect();
        let drafts = list_chapter_drafts(&connection, chapter_id)?;
        Ok(Some(ChapterWithDrafts { chapter, memories, drafts }))
    }

    pub fn create_chapter_draft(&self, chapter_id: &str, content: String, draft_type: String, processing_type: Option<String>, provider: Option<String>, model: Option<String>) -> Result<ChapterDraft, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute("UPDATE chapter_drafts SET is_current=0 WHERE chapter_id=?1", [chapter_id]).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now_str = now();
        transaction.execute(
            "INSERT INTO chapter_drafts(id,chapter_id,content,draft_type,processing_type,provider,model,is_current,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id, chapter_id, content, draft_type, processing_type, provider, model, 1, now_str],
        ).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(ChapterDraft { id, chapter_id: chapter_id.to_string(), content, draft_type, processing_type, provider, model, is_current: true, created_at: now_str })
    }

    pub fn delete_chapter_draft(&self, draft_id: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        connection.execute("DELETE FROM chapter_drafts WHERE id=?1", [draft_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn set_named_links'''

content = content.replace(marker, new_methods)

# Add helper function list_chapter_drafts before memory_summary
marker2 = '''fn memory_summary(connection: &Connection, id: &str) -> Result<MemorySummary, String> {'''

new_helper = '''fn list_chapter_drafts(connection: &Connection, chapter_id: &str) -> Result<Vec<ChapterDraft>, String> {
    let mut stmt = connection.prepare(
        "SELECT id,chapter_id,content,draft_type,processing_type,provider,model,is_current,created_at FROM chapter_drafts WHERE chapter_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let drafts = stmt.query_map([chapter_id], |row| Ok(ChapterDraft {
        id: row.get(0)?, chapter_id: row.get(1)?, content: row.get(2)?, draft_type: row.get(3)?,
        processing_type: row.get(4)?, provider: row.get(5)?, model: row.get(6)?,
        is_current: row.get::<_, i64>(7)? != 0, created_at: row.get(8)?,
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(drafts)
}

fn memory_summary(connection: &Connection, id: &str) -> Result<MemorySummary, String> {'''

content = content.replace(marker2, new_helper)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Chapter draft methods added')
