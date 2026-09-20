
path = r'F:/AI/sound_to_essay/src-tauri/src/library.rs'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Chapter structs
old_block = '''#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {'''

new_block = '''#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDetail {
    #[serde(flatten)]
    pub chapter: Chapter,
    pub memories: Vec<MemorySummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {'''

content = content.replace(old_block, new_block)

# 2. Find the line before set_named_links and insert chapter methods
insert_marker = '''    pub fn set_memory_tags(&self, memory_id: &str, names: Vec<String>) -> Result<(), String> { self.set_named_links(memory_id, names, true) }
    pub fn set_memory_people(&self, memory_id: &str, names: Vec<String>) -> Result<(), String> { self.set_named_links(memory_id, names, false) }

    fn set_named_links'''

chapter_methods = '''    pub fn set_memory_tags(&self, memory_id: &str, names: Vec<String>) -> Result<(), String> { self.set_named_links(memory_id, names, true) }
    pub fn set_memory_people(&self, memory_id: &str, names: Vec<String>) -> Result<(), String> { self.set_named_links(memory_id, names, false) }

    // --- Chapter management ---

    pub fn create_chapter(&self, project_id: &str, title: &str) -> Result<Chapter, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        ensure_project_exists(&transaction, project_id)?;
        let max_order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order),0) FROM chapters WHERE project_id=?1 AND deleted_at IS NULL", [project_id],
            |row| row.get(0),
        ).unwrap_or(0);
        let id = uuid::Uuid::new_v4().to_string();
        let now_str = now();
        transaction.execute(
            "INSERT INTO chapters(id,project_id,title,sort_order,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",
            params![id, project_id, title.trim(), max_order + 1, now_str],
        ).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(Chapter { id, project_id: project_id.to_string(), title: title.trim().to_string(), sort_order: max_order + 1, created_at: now_str.clone(), updated_at: now_str, deleted_at: None })
    }

    pub fn list_chapters(&self, project_id: &str) -> Result<Vec<Chapter>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "SELECT id,project_id,title,sort_order,created_at,updated_at,deleted_at FROM chapters WHERE project_id=?1 AND deleted_at IS NULL ORDER BY sort_order, created_at"
        ).map_err(|e| e.to_string())?;
        let chapters = statement.query_map([project_id], |row| Ok(Chapter {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?, sort_order: row.get(3)?,
            created_at: row.get(4)?, updated_at: row.get(5)?, deleted_at: row.get(6)?,
        })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        Ok(chapters)
    }

    pub fn get_chapter(&self, chapter_id: &str) -> Result<Option<ChapterDetail>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let chapter = match connection.query_row(
            "SELECT id,project_id,title,sort_order,created_at,updated_at,deleted_at FROM chapters WHERE id=?1 AND deleted_at IS NULL", [chapter_id],
            |row| Ok(Chapter { id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?, sort_order: row.get(3)?, created_at: row.get(4)?, updated_at: row.get(5)?, deleted_at: row.get(6)? }),
        ).optional().map_err(|e| e.to_string())? {
            Some(c) => c,
            None => return Ok(None),
        };
        let mut statement = connection.prepare(
            "SELECT memory_id FROM chapter_memories WHERE chapter_id=?1 ORDER BY sort_order, added_at"
        ).map_err(|e| e.to_string())?;
        let memory_ids: Vec<String> = statement.query_map([chapter_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        let memories = memory_ids.iter().filter_map(|id| memory_summary(&connection, id).ok()).collect();
        Ok(Some(ChapterDetail { chapter, memories }))
    }

    pub fn update_chapter(&self, chapter_id: &str, title: Option<&str>, sort_order: Option<i64>) -> Result<Chapter, String> {
        self.initialize()?;
        let connection = self.open()?;
        if let Some(t) = title {
            connection.execute("UPDATE chapters SET title=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL", params![chapter_id, t.trim(), now()]).map_err(|e| e.to_string())?;
        }
        if let Some(so) = sort_order {
            connection.execute("UPDATE chapters SET sort_order=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL", params![chapter_id, so, now()]).map_err(|e| e.to_string())?;
        }
        connection.query_row(
            "SELECT id,project_id,title,sort_order,created_at,updated_at,deleted_at FROM chapters WHERE id=?1", [chapter_id],
            |row| Ok(Chapter { id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?, sort_order: row.get(3)?, created_at: row.get(4)?, updated_at: row.get(5)?, deleted_at: row.get(6)? }),
        ).map_err(|e| e.to_string())
    }

    pub fn delete_chapter(&self, chapter_id: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        connection.execute("UPDATE chapters SET deleted_at=?2 WHERE id=?1", params![chapter_id, now()]).map_err(|e| e.to_string())?;
        connection.execute("DELETE FROM chapter_memories WHERE chapter_id=?1", [chapter_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_memory_to_chapter(&self, chapter_id: &str, memory_id: &str) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let max_order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order),0) FROM chapter_memories WHERE chapter_id=?1", [chapter_id],
            |row| row.get(0),
        ).unwrap_or(0);
        transaction.execute(
            "INSERT OR IGNORE INTO chapter_memories(chapter_id,memory_id,sort_order,added_at) VALUES(?1,?2,?3,?4)",
            params![chapter_id, memory_id, max_order + 1, now()],
        ).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_memory_from_chapter(&self, chapter_id: &str, memory_id: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        connection.execute("DELETE FROM chapter_memories WHERE chapter_id=?1 AND memory_id=?2", params![chapter_id, memory_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_memory_chapters(&self, memory_id: &str) -> Result<Vec<Chapter>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "SELECT c.id,c.project_id,c.title,c.sort_order,c.created_at,c.updated_at,c.deleted_at FROM chapters c JOIN chapter_memories cm ON cm.chapter_id=c.id WHERE cm.memory_id=?1 AND c.deleted_at IS NULL ORDER BY c.sort_order"
        ).map_err(|e| e.to_string())?;
        let chapters = statement.query_map([memory_id], |row| Ok(Chapter {
            id: row.get(0)?, project_id: row.get(1)?, title: row.get(2)?, sort_order: row.get(3)?,
            created_at: row.get(4)?, updated_at: row.get(5)?, deleted_at: row.get(6)?,
        })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        Ok(chapters)
    }

    pub fn list_memories_by_filter(&self, project_id: &str, filter_type: &str, filter_value: &str) -> Result<Vec<MemorySummary>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let ids = match filter_type {
            "person" => {
                let mut stmt = connection.prepare(
                    "SELECT DISTINCT m.id FROM memories m JOIN memory_people mp ON mp.memory_id=m.id JOIN people p ON p.id=mp.person_id WHERE m.project_id=?1 AND m.deleted_at IS NULL AND p.name=?2 ORDER BY COALESCE(m.event_date_sort, 9223372036854775807), m.created_at DESC"
                ).map_err(|e| e.to_string())?;
                stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            "tag" => {
                let mut stmt = connection.prepare(
                    "SELECT DISTINCT m.id FROM memories m JOIN memory_tags mt ON mt.memory_id=m.id JOIN tags t ON t.id=mt.tag_id WHERE m.project_id=?1 AND m.deleted_at IS NULL AND t.name=?2 ORDER BY COALESCE(m.event_date_sort, 9223372036854775807), m.created_at DESC"
                ).map_err(|e| e.to_string())?;
                stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            "location" => {
                let mut stmt = connection.prepare(
                    "SELECT id FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location=?2 ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC"
                ).map_err(|e| e.to_string())?;
                stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            _ => return Err(format!("Unknown filter type: {}", filter_type)),
        };
        ids.iter().map(|id| memory_summary(&connection, id)).collect()
    }

    pub fn list_all_people(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT p.name FROM people p JOIN memory_people mp ON mp.person_id=p.id JOIN memories m ON m.id=mp.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    pub fn list_all_tags(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize!?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id JOIN memories m ON m.id=mt.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT location FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    fn set_named_links'''

content = content.replace(insert_marker, chapter_methods)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
