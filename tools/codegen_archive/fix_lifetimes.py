
path = r'F:/AI/sound_to_essay/src-tauri/src/library.rs'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: self.initialize!? -> self.initialize()?
content = content.replace('self.initialize!?;', 'self.initialize()?;')

# Fix 2: list_memories_by_filter stmt lifetime
old = '''    pub fn list_memories_by_filter(&self, project_id: &str, filter_type: &str, filter_value: &str) -> Result<Vec<MemorySummary>, String> {
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
    }'''

new = '''    pub fn list_memories_by_filter(&self, project_id: &str, filter_type: &str, filter_value: &str) -> Result<Vec<MemorySummary>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let ids: Vec<String> = match filter_type {
            "person" => {
                let mut stmt = connection.prepare(
                    "SELECT DISTINCT m.id FROM memories m JOIN memory_people mp ON mp.memory_id=m.id JOIN people p ON p.id=mp.person_id WHERE m.project_id=?1 AND m.deleted_at IS NULL AND p.name=?2 ORDER BY COALESCE(m.event_date_sort, 9223372036854775807), m.created_at DESC"
                ).map_err(|e| e.to_string())?;
                let rows = stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            "tag" => {
                let mut stmt = connection.prepare(
                    "SELECT DISTINCT m.id FROM memories m JOIN memory_tags mt ON mt.memory_id=m.id JOIN tags t ON t.id=mt.tag_id WHERE m.project_id=?1 AND m.deleted_at IS NULL AND t.name=?2 ORDER BY COALESCE(m.event_date_sort, 9223372036854775807), m.created_at DESC"
                ).map_err(|e| e.to_string())?;
                let rows = stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            "location" => {
                let mut stmt = connection.prepare(
                    "SELECT id FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location=?2 ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC"
                ).map_err(|e| e.to_string())?;
                let rows = stmt.query_map(params![project_id, filter_value], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
            }
            _ => return Err(format!("Unknown filter type: {}", filter_type)),
        };
        ids.iter().map(|id| memory_summary(&connection, id)).collect()
    }'''

content = content.replace(old, new)

# Fix 3: list_all_people
old = '''    pub fn list_all_people(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT p.name FROM people p JOIN memory_people mp ON mp.person_id=p.id JOIN memories m ON m.id=mp.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

new = '''    pub fn list_all_people(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT p.name FROM people p JOIN memory_people mp ON mp.person_id=p.id JOIN memories m ON m.id=mp.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

content = content.replace(old, new)

# Fix 4: list_all_tags
old = '''    pub fn list_all_tags(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id JOIN memories m ON m.id=mt.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

new = '''    pub fn list_all_tags(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id JOIN memories m ON m.id=mt.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

content = content.replace(old, new)

# Fix 5: list_all_locations
old = '''    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT location FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

new = '''    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT location FROM memories WHERE project_id=?1 AND deleted_at IS NULL AND location IS NOT NULL AND location != '' ORDER BY location COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }'''

content = content.replace(old, new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed')
