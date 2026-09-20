use crate::project::Project;
use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const SCHEMA_VERSION: i64 = 4;

#[derive(Clone)]
pub struct Library {
    path: PathBuf,
    /// 迁移/建表是否已在本实例上执行过。用 Arc<Mutex<_>> 以便 Clone 共享同一状态。
    initialized: Arc<Mutex<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProject {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryInput {
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub audio_recorded_at: Option<String>,
    #[serde(default)]
    pub event_date_text: Option<String>,
    #[serde(default)]
    pub event_date_precision: Option<String>,
    #[serde(default)]
    pub event_date_sort: Option<i64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    /// B3：素材包来源记录 ID（跨设备稳定 ID，去重/更新依据）。
    #[serde(default)]
    pub source_id: Option<String>,
    /// B3：素材包来源修订标识。
    #[serde(default)]
    pub source_revision: Option<i64>,
    #[serde(default)]
    pub audio_path: Option<String>,
    #[serde(default)]
    pub duration_secs: Option<f64>,
    #[serde(default)]
    pub sample_rate: Option<i64>,
    #[serde(default)]
    pub raw_text: Option<String>,
    /// B1：导入音频的原始文件名（如 `语音备忘录 001.m4a`），用于溯源展示。
    #[serde(default)]
    pub original_filename: Option<String>,
    /// B1：导入音频的实际容器/编码格式（如 `m4a`/`wav`），导入时探测。
    #[serde(default)]
    pub source_format: Option<String>,
    /// B1：导入音频的文件校验值（hex SHA-256），用于完整性校验与去重。
    #[serde(default)]
    pub file_checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub audio_recorded_at: Option<String>,
    #[serde(default)]
    pub event_date_text: Option<String>,
    #[serde(default)]
    pub event_date_precision: Option<String>,
    #[serde(default)]
    pub event_date_sort: Option<i64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySummary {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub audio_recorded_at: Option<String>,
    pub event_date_text: Option<String>,
    pub event_date_precision: String,
    pub event_date_sort: Option<i64>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub audio_count: i64,
    pub version_count: i64,
    pub tags: Vec<String>,
    pub people: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    pub id: String,
    pub memory_id: String,
    pub file_path: String,
    pub duration_secs: Option<f64>,
    pub sample_rate: Option<i64>,
    pub recorded_at: Option<String>,
    pub created_at: String,
    /// B1：导入音频的原始文件名（溯源展示）。
    pub original_filename: Option<String>,
    /// B1：导入音频的实际容器/编码格式。
    pub source_format: Option<String>,
    /// B1：导入音频的文件校验值（hex SHA-256）。
    pub file_checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextVersion {
    pub id: String,
    pub memory_id: String,
    pub parent_version_id: Option<String>,
    pub content: String,
    pub version_type: String,
    pub processing_type: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tier: Option<String>,
    pub is_current: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDetail {
    #[serde(flatten)]
    pub memory: MemorySummary,
    pub audio_assets: Vec<AudioAsset>,
    pub text_versions: Vec<TextVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
/// A2：一份草稿生成时**实际使用**的一个来源（记忆 + 该记忆当时被采用的文本版本）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDraftSource {
    pub memory_id: String,
    /// 生成时的记忆标题快照：记忆后来被改名或移出章节，旧草稿仍能说明用了什么素材。
    pub memory_title: String,
    pub text_version_id: Option<String>,
    /// 生成时该版本的版本类型快照（raw_transcription / user_edit / ...）。
    pub version_type: Option<String>,
    /// 该版本现在是否已不存在（历史数据可能早于来源保护被删除）。
    pub version_missing: bool,
}

/// A2：创建草稿时声明来源。标题与版本类型由后端按 ID 回查并快照，避免调用方填错。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSourceInput {
    pub memory_id: String,
    #[serde(default)]
    pub text_version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDraft {
    pub id: String,
    pub chapter_id: String,
    pub content: String,
    pub draft_type: String,
    pub processing_type: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tier: Option<String>,
    /// A2：生成时的写作要求（风格提示词），用于复盘旧草稿。
    pub requirement: Option<String>,
    pub is_current: bool,
    pub created_at: String,
    /// A2：来源取自生成时的记录，不是当前章节关联列表。
    pub sources: Vec<ChapterDraftSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWithDrafts {
    #[serde(flatten)]
    pub chapter: Chapter,
    pub memories: Vec<MemorySummary>,
    pub drafts: Vec<ChapterDraft>,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub imported_projects: usize,
    pub imported_memories: usize,
    pub skipped_projects: usize,
    pub backups: Vec<String>,
}

/// A1: 录音落盘后立即登记的记忆与音频资产。转写随后作为独立任务推进。
pub const TRANSCRIPTION_PENDING: &str = "pending";
pub const TRANSCRIPTION_PROCESSING: &str = "processing";
pub const TRANSCRIPTION_SUCCESS: &str = "success";
pub const TRANSCRIPTION_FAILED: &str = "failed";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRecordingInput {
    pub project_id: String,
    pub audio_path: String,
    pub duration_secs: f64,
    #[serde(default)]
    pub sample_rate: Option<i64>,
    #[serde(default)]
    pub recorded_at: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// B1：导入音频的原始文件名（溯源展示）。
    #[serde(default)]
    pub original_filename: Option<String>,
    /// B1：导入音频的实际容器/编码格式。
    #[serde(default)]
    pub source_format: Option<String>,
    /// B1：导入音频的文件校验值（hex SHA-256，去重用）。
    #[serde(default)]
    pub file_checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionTask {
    pub id: String,
    pub memory_id: String,
    pub audio_path: String,
    pub status: String,
    pub error: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    pub attempts: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredRecording {
    pub memory: MemorySummary,
    pub task: TranscriptionTask,
}

impl Library {
    pub fn new(path: PathBuf) -> Self {
        Self { path, initialized: Arc::new(Mutex::new(false)) }
    }

    /// A3：数据库文件在磁盘上的位置。备份/恢复流程需要直接访问该文件。
    pub fn db_path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn open(&self) -> Result<Connection, String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create library directory: {e}"))?;
        }
        let connection = Connection::open(&self.path).map_err(|e| format!("Cannot open library database: {e}"))?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")
            .map_err(|e| format!("Cannot configure library database: {e}"))?;
        Ok(connection)
    }

    /// 建表与迁移。**只在本实例上真正执行一次**：
    /// 既省掉每条命令都重跑一遍 DDL 的开销，也避免多个命令并发时互相争抢
    /// SQLite 写锁（DDL 是写操作，并发会撞 SQLITE_BUSY 导致命令随机失败）。
    pub fn initialize(&self) -> Result<(), String> {
        let mut done = self
            .initialized
            .lock()
            .map_err(|_| "Library init lock poisoned".to_string())?;
        if *done {
            return Ok(());
        }
        self.initialize_inner()?;
        *done = true;
        Ok(())
    }

    fn initialize_inner(&self) -> Result<(), String> {
        let connection = self.open()?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE TABLE IF NOT EXISTS memories (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
              audio_recorded_at TEXT, event_date_text TEXT, event_date_precision TEXT NOT NULL DEFAULT 'unknown',
              event_date_sort INTEGER, location TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'inbox',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
              source_id TEXT, source_revision INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
            CREATE INDEX IF NOT EXISTS idx_memories_event_date ON memories(event_date_sort);
            -- 注意：memories.source_id / audio_assets.file_checksum 的索引不在这里建。
            -- 老库的这两张表已存在且没有这些列，CREATE INDEX 会因「no such column」失败；
            -- 它们必须等到下方 ALTER TABLE 补列之后再建（见 initialize 末尾）。
            CREATE TABLE IF NOT EXISTS audio_assets (
              id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id), file_path TEXT NOT NULL,
              duration_secs REAL, sample_rate INTEGER, recorded_at TEXT, created_at TEXT NOT NULL,
              original_filename TEXT, source_format TEXT, file_checksum TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audio_assets_memory ON audio_assets(memory_id);
            CREATE TABLE IF NOT EXISTS text_versions (
              id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id), parent_version_id TEXT,
              content TEXT NOT NULL, version_type TEXT NOT NULL, processing_type TEXT, provider TEXT, model TEXT,
              tier TEXT, is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_text_versions_memory ON text_versions(memory_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL REFERENCES memories(id), tag_id TEXT NOT NULL REFERENCES tags(id), PRIMARY KEY(memory_id, tag_id));
            CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS memory_people (memory_id TEXT NOT NULL REFERENCES memories(id), person_id TEXT NOT NULL REFERENCES people(id), PRIMARY KEY(memory_id, person_id));
            CREATE TABLE IF NOT EXISTS legacy_documents (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), document_type TEXT NOT NULL,
              title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS legacy_imports (source_path TEXT PRIMARY KEY, project_id TEXT NOT NULL, imported_at TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
              memory_id UNINDEXED, title, content, location, notes, tags, people, tokenize='unicode61'
            );
            CREATE TABLE IF NOT EXISTS chapters (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
              title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, sort_order);
            CREATE TABLE IF NOT EXISTS chapter_memories (
              chapter_id TEXT NOT NULL REFERENCES chapters(id), memory_id TEXT NOT NULL REFERENCES memories(id),
              sort_order INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL,
              PRIMARY KEY(chapter_id, memory_id)
            );
            CREATE INDEX IF NOT EXISTS idx_chapter_memories_chapter ON chapter_memories(chapter_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_chapter_memories_memory ON chapter_memories(memory_id);
            CREATE TABLE IF NOT EXISTS chapter_drafts (
              id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id),
              content TEXT NOT NULL, draft_type TEXT NOT NULL DEFAULT 'draft',
              processing_type TEXT, provider TEXT, model TEXT, tier TEXT,
              is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chapter_drafts_chapter ON chapter_drafts(chapter_id, created_at DESC);
            -- A1: transcription is decoupled from recording. The audio asset and
            -- the memory are registered first (status 'pending'), then
            -- transcription moves the task through pending/processing/success/
            -- failed. A failed task keeps the memory and the original audio.
            CREATE TABLE IF NOT EXISTS transcription_tasks (
              id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id),
              audio_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
              error TEXT, model TEXT, language TEXT,
              attempts INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transcription_tasks_status ON transcription_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_transcription_tasks_memory ON transcription_tasks(memory_id);
            -- A2：记录每次草稿生成实际使用过的记忆与文本版本。来源必须取自这里，
            -- 不能用「当前章节关联的记忆列表」代替——那种做法在素材被改动或解除关联后
            -- 就无法还原当时到底用了什么。
            CREATE TABLE IF NOT EXISTS chapter_draft_sources (
              id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES chapter_drafts(id),
              memory_id TEXT NOT NULL, memory_title TEXT NOT NULL DEFAULT '',
              text_version_id TEXT, version_type TEXT, recorded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_draft_sources_draft ON chapter_draft_sources(draft_id);
            CREATE INDEX IF NOT EXISTS idx_draft_sources_version ON chapter_draft_sources(text_version_id);
            ",
        ).map_err(|e| format!("Cannot initialize library schema: {e}"))?;
        connection.execute(
            "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [SCHEMA_VERSION.to_string()],
        ).map_err(|e| format!("Cannot store library schema version: {e}"))?;

        // 幂等迁移：为已存在的库补充 `tier` 列（两档整理策略 feature）。
        // ALTER TABLE 在列已存在时会报错，这里吞掉 "duplicate column" 类错误。
        for table in ["text_versions", "chapter_drafts"] {
            let alter = format!("ALTER TABLE {} ADD COLUMN tier TEXT", table);
            if let Err(e) = connection.execute(&alter, []) {
                let msg = e.to_string();
                if !msg.contains("duplicate column") && !msg.contains("already exists") {
                    return Err(format!("Cannot migrate library schema ({}): {}", table, msg));
                }
            }
        }

        // A2：章节草稿记录生成时的"写作要求"，使旧草稿可以完整复盘当时的生成条件。
        if let Err(e) = connection.execute("ALTER TABLE chapter_drafts ADD COLUMN requirement TEXT", []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column") && !msg.contains("already exists") {
                return Err(format!("Cannot migrate library schema (chapter_drafts.requirement): {}", msg));
            }
        }

        // B1：音频资产补充原始文件名、实际格式与文件校验值（导入音频溯源/去重用）。
        for column in ["original_filename", "source_format", "file_checksum"] {
            let alter = format!("ALTER TABLE audio_assets ADD COLUMN {} TEXT", column);
            if let Err(e) = connection.execute(&alter, []) {
                let msg = e.to_string();
                if !msg.contains("duplicate column") && !msg.contains("already exists") {
                    return Err(format!("Cannot migrate library schema (audio_assets.{}): {}", column, msg));
                }
            }
        }

        // B3：记忆补充素材包来源 ID 与修订标识（跨设备去重/更新依据）。
        for (column, decl) in [("source_id", "TEXT"), ("source_revision", "INTEGER")] {
            let alter = format!("ALTER TABLE memories ADD COLUMN {} {}", column, decl);
            if let Err(e) = connection.execute(&alter, []) {
                let msg = e.to_string();
                if !msg.contains("duplicate column") && !msg.contains("already exists") {
                    return Err(format!("Cannot migrate library schema (memories.{}): {}", column, msg));
                }
            }
        }

        // B1/B3 新增列的索引。必须放在上面的 ALTER TABLE 补列之后：
        // 老库的 memories / audio_assets 表已存在且没有这些列，若在开头的建表
        // batch 里建索引，会直接报 "no such column" 导致整个资料库打不开。
        for (index_sql, label) in [
            ("CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_id)", "idx_memories_source"),
            ("CREATE INDEX IF NOT EXISTS idx_audio_assets_checksum ON audio_assets(file_checksum)", "idx_audio_assets_checksum"),
        ] {
            if let Err(e) = connection.execute(index_sql, []) {
                return Err(format!("Cannot migrate library schema ({}): {}", label, e));
            }
        }

        Ok(())
    }

    pub fn create_project(&self, name: &str) -> Result<LibraryProject, String> {
        self.initialize()?;
        let project = LibraryProject { id: uuid::Uuid::new_v4().to_string(), name: name.trim().to_string(), created_at: now(), updated_at: now() };
        if project.name.is_empty() { return Err("Project name cannot be empty".to_string()); }
        self.open()?.execute(
            "INSERT INTO projects(id,name,created_at,updated_at) VALUES(?1,?2,?3,?4)",
            params![project.id, project.name, project.created_at, project.updated_at],
        ).map_err(|e| format!("Cannot create library project: {e}"))?;
        Ok(project)
    }

    pub fn list_projects(&self) -> Result<Vec<LibraryProject>, String> {
        self.initialize()?;
        let connection = self.open()?;
        // 末位 tie-break 用 id：updated_at 相同的项目若顺序不定，
        // 前端取 result[0] 作默认选中时会在多个项目之间漂移。id 唯一，保证顺序确定。
        let mut statement = connection.prepare("SELECT id,name,created_at,updated_at FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC, id ASC")
            .map_err(|e| e.to_string())?;
        let projects = statement.query_map([], |row| Ok(LibraryProject { id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)?, updated_at: row.get(3)? }))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(projects)
    }

    /// 彻底删除一个资料库项目及其全部下属数据（记忆、章节、音频、文本版本、标签/人物关联、FTS 索引、遗留文档）。
    /// 采用事务 + 先删子表再删父表，避免触发外键约束错误。
    pub fn delete_library_project(&self, project_id: &str) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;

        // 1. 章节关联与章节草稿
        transaction.execute(
            "DELETE FROM chapter_memories WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM chapter_drafts WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;

        // 2. 记忆的多对多关联与版本/音频/FTS
        transaction.execute(
            "DELETE FROM memory_tags WHERE memory_id IN (SELECT id FROM memories WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM memory_people WHERE memory_id IN (SELECT id FROM memories WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM text_versions WHERE memory_id IN (SELECT id FROM memories WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM audio_assets WHERE memory_id IN (SELECT id FROM memories WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "DELETE FROM memory_fts WHERE memory_id IN (SELECT id FROM memories WHERE project_id=?1)",
            params![project_id],
        ).map_err(|e| e.to_string())?;

        // 3. 记忆、章节、遗留文档
        transaction.execute("DELETE FROM memories WHERE project_id=?1", params![project_id]).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM chapters WHERE project_id=?1", params![project_id]).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM legacy_documents WHERE project_id=?1", params![project_id]).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM legacy_imports WHERE project_id=?1", params![project_id]).map_err(|e| e.to_string())?;

        // 4. 项目本身
        let affected = transaction.execute("DELETE FROM projects WHERE id=?1", params![project_id]).map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err("项目不存在或已删除".to_string());
        }
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn create_memory(&self, input: CreateMemoryInput) -> Result<MemorySummary, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        ensure_project_exists(&transaction, &input.project_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now();
        let title = if input.title.trim().is_empty() { "Untitled memory".to_string() } else { input.title.trim().to_string() };
        transaction.execute(
            "INSERT INTO memories(id,project_id,title,audio_recorded_at,event_date_text,event_date_precision,event_date_sort,location,notes,status,created_at,updated_at,source_id,source_revision)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13)",
            params![id, input.project_id, title, input.audio_recorded_at, input.event_date_text,
                input.event_date_precision.unwrap_or_else(|| "unknown".to_string()), input.event_date_sort,
                input.location, input.notes, input.status.unwrap_or_else(|| "inbox".to_string()), created_at,
                input.source_id, input.source_revision],
        ).map_err(|e| format!("Cannot create memory: {e}"))?;
        if let Some(path) = input.audio_path.filter(|path| !path.trim().is_empty()) {
            insert_audio_full(
                &transaction, &id, &path, input.duration_secs, input.sample_rate, None,
                input.original_filename.as_deref(), input.source_format.as_deref(), input.file_checksum.as_deref(),
            )?;
        }
        if let Some(raw_text) = input.raw_text {
            insert_text_version(&transaction, &id, None, &raw_text, "raw_transcription", Some("transcription"), None, None, None, true)?;
        }
        refresh_search(&transaction, &id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(self.get_memory(&id)?.ok_or_else(|| "Created memory was not found".to_string())?.memory)
    }

    pub fn list_memories(&self, project_id: Option<&str>, include_deleted: bool) -> Result<Vec<MemorySummary>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let sql = if project_id.is_some() {
            if include_deleted { "SELECT id FROM memories WHERE project_id=?1 ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC" }
            else { "SELECT id FROM memories WHERE project_id=?1 AND deleted_at IS NULL ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC" }
        } else if include_deleted { "SELECT id FROM memories ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC" }
        else { "SELECT id FROM memories WHERE deleted_at IS NULL ORDER BY COALESCE(event_date_sort, 9223372036854775807), created_at DESC" };
        let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
        let ids = if let Some(project_id) = project_id {
            statement.query_map([project_id], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        } else {
            statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        ids.iter().map(|id| memory_summary(&connection, id)).collect()
    }

    pub fn get_memory(&self, id: &str) -> Result<Option<MemoryDetail>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let memory = match memory_summary(&connection, id) { Ok(value) => value, Err(error) if error == "Memory not found" => return Ok(None), Err(error) => return Err(error) };
        let audio_assets = list_audio(&connection, id)?;
        let text_versions = list_versions(&connection, id)?;
        Ok(Some(MemoryDetail { memory, audio_assets, text_versions }))
    }

    pub fn update_memory_metadata(&self, input: UpdateMemoryInput) -> Result<MemorySummary, String> {
        self.initialize()?;
        let connection = self.open()?;
        let changed = connection.execute(
            "UPDATE memories SET title=?2,audio_recorded_at=?3,event_date_text=?4,event_date_precision=?5,event_date_sort=?6,location=?7,notes=?8,status=?9,updated_at=?10 WHERE id=?1 AND deleted_at IS NULL",
            params![input.id, input.title, input.audio_recorded_at, input.event_date_text,
                input.event_date_precision.unwrap_or_else(|| "unknown".to_string()), input.event_date_sort,
                input.location, input.notes, input.status, now()],
        ).map_err(|e| e.to_string())?;
        if changed == 0 { return Err("Memory not found or deleted".to_string()); }
        refresh_search(&connection, &input.id)?;
        memory_summary(&connection, &input.id)
    }

    pub fn delete_memory(&self, id: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        if connection.execute("UPDATE memories SET deleted_at=?2,updated_at=?2 WHERE id=?1 AND deleted_at IS NULL", params![id, now()]).map_err(|e| e.to_string())? == 0 {
            return Err("Memory not found or already deleted".to_string());
        }
        connection.execute("DELETE FROM memory_fts WHERE memory_id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_memory(&self, id: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        if connection.execute("UPDATE memories SET deleted_at=NULL,updated_at=?2 WHERE id=?1 AND deleted_at IS NOT NULL", params![id, now()]).map_err(|e| e.to_string())? == 0 {
            return Err("Deleted memory not found".to_string());
        }
        refresh_search(&connection, id)
    }

    pub fn search_memories(&self, query: &str, project_id: Option<&str>) -> Result<Vec<MemorySummary>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let like = format!("%{}%", query.trim());
        if like == "%%" { return self.list_memories(project_id, false); }
        let sql = if project_id.is_some() {
            "SELECT DISTINCT m.id FROM memories m LEFT JOIN memory_fts f ON f.memory_id=m.id
             WHERE m.deleted_at IS NULL AND m.project_id=?1 AND (m.title LIKE ?2 OR m.location LIKE ?2 OR m.notes LIKE ?2 OR f.content LIKE ?2 OR f.tags LIKE ?2 OR f.people LIKE ?2) ORDER BY m.updated_at DESC"
        } else {
            "SELECT DISTINCT m.id FROM memories m LEFT JOIN memory_fts f ON f.memory_id=m.id
             WHERE m.deleted_at IS NULL AND (m.title LIKE ?1 OR m.location LIKE ?1 OR m.notes LIKE ?1 OR f.content LIKE ?1 OR f.tags LIKE ?1 OR f.people LIKE ?1) ORDER BY m.updated_at DESC"
        };
        let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
        let ids = if let Some(project_id) = project_id {
            statement.query_map(params![project_id, like], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        } else {
            statement.query_map([like], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        ids.iter().map(|id| memory_summary(&connection, id)).collect()
    }

    pub fn list_text_versions(&self, memory_id: &str) -> Result<Vec<TextVersion>, String> {
        self.initialize()?;
        let connection = self.open()?;
        list_versions(&connection, memory_id)
    }

    /// A3：把当前数据库一致性备份到 `dest`（SQLite 在线备份 API），
    /// 而不是直接复制可能处于写入中间态的数据库文件。
    pub fn backup_to(&self, dest: &Path) -> Result<(), String> {
        self.initialize()?;
        let source = self.open()?;
        let mut target = Connection::open(dest).map_err(|e| format!("无法创建备份数据库: {e}"))?;
        let backup = rusqlite::backup::Backup::new(&source, &mut target)
            .map_err(|e| format!("备份数据库失败: {e}"))?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(50), None)
            .map_err(|e| format!("备份数据库失败: {e}"))?;
        Ok(())
    }

    /// A3：校验备份包里的数据库文件是否可正常打开、结构是否完整。
    /// 恢复前必须先校验，避免用一个损坏的备份覆盖现有资料。
    pub fn validate_backup_db(path: &Path) -> Result<(), String> {
        if !path.is_file() {
            return Err("备份中缺少数据库文件".to_string());
        }
        let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("无法打开备份数据库: {e}"))?;
        let user_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("备份数据库结构异常: {e}"))?;
        let integrity: String = connection.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if integrity != "ok" { return Err(format!("备份数据库完整性检查失败: {integrity}")); }
        for table in ["projects", "memories", "audio_assets", "text_versions", "transcription_tasks"] {
            connection.prepare(&format!("SELECT * FROM {table} LIMIT 0")).map_err(|e| e.to_string())?;
        }
        if user_tables == 0 {
            return Err("备份数据库没有任何数据表，可能已损坏".to_string());
        }
        Ok(())
    }

    pub fn referenced_audio_paths(&self) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut statement = connection.prepare("SELECT DISTINCT file_path FROM audio_assets").map_err(|e| e.to_string())?;
        let paths = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(paths)
    }

    /// B3：按素材包来源 ID 查找记忆，返回 (memory_id, source_revision)。
    pub fn find_memory_by_source_id(&self, source_id: &str) -> Result<Option<(String, i64)>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let result = connection.query_row(
            "SELECT id, COALESCE(source_revision,0) FROM memories WHERE source_id=?1 AND deleted_at IS NULL LIMIT 1",
            [source_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        Ok(result)
    }

    /// B3：登记记忆的素材包来源 ID 与修订标识（导入后补记，供后续去重/更新）。
    pub fn set_memory_source(&self, memory_id: &str, source_id: &str, revision: i64) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        connection.execute(
            "UPDATE memories SET source_id=?2, source_revision=?3, updated_at=?4 WHERE id=?1",
            params![memory_id, source_id, revision, now()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// B3：用素材包内容更新本地记忆（保留本地 ID，提升 source_revision）。
    pub fn update_memory_from_pack(
        &self,
        memory_id: &str,
        revision: i64,
        title: &str,
        body: &str,
        event_date_text: Option<&str>,
        event_date_precision: Option<&str>,
        location: Option<&str>,
        notes: Option<&str>,
    ) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute(
            "UPDATE memories SET title=?2, event_date_text=?3, event_date_precision=?4, location=?5, notes=?6, source_revision=?7, updated_at=?8
             WHERE id=?1",
            params![memory_id, title, event_date_text, event_date_precision.unwrap_or("unknown"), location, notes, revision, now()],
        ).map_err(|e| e.to_string())?;
        // 正文写入一个新的 raw_transcription 版本并置为当前（不覆盖历史）。
        insert_text_version(&transaction, memory_id, None, body, "raw_transcription", Some("pack_import"), None, None, None, true)?;
        refresh_search(&transaction, memory_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// B1：按文件校验值查找已登记的音频资产（导入去重用）。
    pub fn find_audio_by_checksum(&self, checksum: &str) -> Result<Option<AudioAsset>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "SELECT id,memory_id,file_path,duration_secs,sample_rate,recorded_at,created_at,original_filename,source_format,file_checksum
             FROM audio_assets WHERE file_checksum=?1 LIMIT 1"
        ).map_err(|e| e.to_string())?;
        let asset = statement.query_row([checksum], |row| Ok(AudioAsset {
            id: row.get(0)?, memory_id: row.get(1)?, file_path: row.get(2)?, duration_secs: row.get(3)?,
            sample_rate: row.get(4)?, recorded_at: row.get(5)?, created_at: row.get(6)?,
            original_filename: row.get(7)?, source_format: row.get(8)?, file_checksum: row.get(9)?,
        })).optional().map_err(|e| e.to_string())?;
        Ok(asset)
    }

    // --- A1: transcription tasks -------------------------------------------------

    /// Registers the finished recording as a memory with an audio asset and a
    /// `pending` transcription task, in one transaction. This runs BEFORE any
    /// transcription attempt, so a transcription failure can never leave the
    /// audio unreferenced (and therefore eligible for cleanup).
    pub fn register_recording(&self, input: RegisterRecordingInput) -> Result<RegisteredRecording, String> {
        self.initialize()?;
        if input.audio_path.trim().is_empty() {
            return Err("Recording path cannot be empty".to_string());
        }
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        ensure_project_exists(&transaction, &input.project_id)?;

        let memory_id = uuid::Uuid::new_v4().to_string();
        let task_id = uuid::Uuid::new_v4().to_string();
        let created_at = now();
        let title = match input.title.as_deref().map(str::trim) {
            Some(value) if !value.is_empty() => value.to_string(),
            _ => format!("录音 {}", Local::now().format("%Y-%m-%d %H:%M")),
        };

        transaction.execute(
            "INSERT INTO memories(id,project_id,title,audio_recorded_at,event_date_precision,status,created_at,updated_at)
             VALUES(?1,?2,?3,?4,'unknown','inbox',?5,?5)",
            params![memory_id, input.project_id, title, input.recorded_at, created_at],
        ).map_err(|e| format!("Cannot register recording memory: {e}"))?;

        insert_audio_full(
            &transaction, &memory_id, input.audio_path.trim(), Some(input.duration_secs),
            input.sample_rate, input.recorded_at.as_deref(),
            input.original_filename.as_deref(), input.source_format.as_deref(), input.file_checksum.as_deref(),
        )?;

        transaction.execute(
            "INSERT INTO transcription_tasks(id,memory_id,audio_path,status,attempts,created_at,updated_at)
             VALUES(?1,?2,?3,?4,0,?5,?5)",
            params![task_id, memory_id, input.audio_path.trim(), TRANSCRIPTION_PENDING, created_at],
        ).map_err(|e| format!("Cannot register transcription task: {e}"))?;

        refresh_search(&transaction, &memory_id)?;
        transaction.commit().map_err(|e| e.to_string())?;

        let memory = memory_summary(&self.open()?, &memory_id)?;
        let task = self.get_transcription_task(&memory_id)?
            .ok_or_else(|| "Registered transcription task was not found".to_string())?;
        Ok(RegisteredRecording { memory, task })
    }

    pub fn get_transcription_task(&self, memory_id: &str) -> Result<Option<TranscriptionTask>, String> {
        self.initialize()?;
        let connection = self.open()?;
        transcription_task_row(&connection, memory_id)
    }

    /// Tasks for a project, or every task when `project_id` is `None`. Used by
    /// the desktop UI to expose retry entries, so it must survive a restart.
    pub fn list_transcription_tasks(&self, project_id: Option<&str>, only_unfinished: bool) -> Result<Vec<TranscriptionTask>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut sql = String::from(
            "SELECT t.id,t.memory_id,t.audio_path,t.status,t.error,t.model,t.language,t.attempts,t.created_at,t.updated_at
             FROM transcription_tasks t JOIN memories m ON m.id=t.memory_id WHERE 1=1",
        );
        if project_id.is_some() { sql.push_str(" AND m.project_id=?1"); }
        if only_unfinished { sql.push_str(" AND t.status IN ('pending','processing','failed')"); }
        sql.push_str(" ORDER BY t.created_at DESC");
        let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = match project_id {
            Some(project_id) => statement.query_map([project_id], read_transcription_task).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
            None => statement.query_map([], read_transcription_task).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
        };
        Ok(rows)
    }

    /// Marks a task as `processing`. Only a task that is not already complete
    /// may start, so a duplicate click cannot run two transcriptions at once.
    pub fn mark_transcription_processing(&self, task_id: &str, model: &str, language: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        let changed = connection.execute(
            "UPDATE transcription_tasks SET status=?2,error=NULL,model=?3,language=?4,attempts=attempts+1,updated_at=?5
             WHERE id=?1 AND status IN ('pending','failed')",
            params![task_id, TRANSCRIPTION_PROCESSING, model, language, now()],
        ).map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("转写任务不存在或已完成，无需重复转写".to_string());
        }
        Ok(())
    }

    /// Records a successful transcription. The recognised text is stored as a
    /// new `raw_transcription` version; the original audio and memory are
    /// untouched.
    pub fn mark_transcription_success(&self, task_id: &str, text: &str) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let memory_id: String = transaction
            .query_row("SELECT memory_id FROM transcription_tasks WHERE id=?1", [task_id], |row| row.get(0))
            .map_err(|e| format!("Transcription task not found: {e}"))?;
        if !text.trim().is_empty() {
            insert_text_version(&transaction, &memory_id, None, text, "raw_transcription", Some("transcription"), None, None, None, true)?;
            refresh_search(&transaction, &memory_id)?;
        }
        transaction.execute(
            "UPDATE transcription_tasks SET status=?2,error=NULL,updated_at=?3 WHERE id=?1",
            params![task_id, TRANSCRIPTION_SUCCESS, now()],
        ).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Records a failed transcription. The memory and the original audio stay in
    /// place so the user can retry later.
    pub fn mark_transcription_failed(&self, task_id: &str, error: &str) -> Result<(), String> {
        self.initialize()?;
        let connection = self.open()?;
        connection.execute(
            "UPDATE transcription_tasks SET status=?2,error=?3,updated_at=?4 WHERE id=?1",
            params![task_id, TRANSCRIPTION_FAILED, error, now()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// After an abnormal exit a task can be stuck in `processing`. Reset those to
    /// `pending` so the UI never shows a permanent "处理中" and the user can retry.
    pub fn reset_interrupted_transcriptions(&self) -> Result<usize, String> {
        self.initialize()?;
        let connection = self.open()?;
        let changed = connection.execute(
            "UPDATE transcription_tasks SET status=?1,error=?2,updated_at=?3 WHERE status=?4",
            params![TRANSCRIPTION_PENDING, "应用上次退出前转写未完成，可重新转写", now(), TRANSCRIPTION_PROCESSING],
        ).map_err(|e| e.to_string())?;
        Ok(changed)
    }

    /// Audio paths that must survive cleanup: every transcription task, including
    /// failed and pending ones whose audio has not been transcribed yet.
    pub fn transcription_protected_paths(&self) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut statement = connection.prepare("SELECT DISTINCT audio_path FROM transcription_tasks").map_err(|e| e.to_string())?;
        let paths = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(paths)
    }

    pub fn create_text_version(&self, memory_id: &str, content: String, version_type: String, processing_type: Option<String>, parent_version_id: Option<String>, provider: Option<String>, model: Option<String>, tier: Option<String>) -> Result<TextVersion, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        ensure_memory_exists(&transaction, memory_id)?;
        let id = insert_text_version(&transaction, memory_id, parent_version_id.as_deref(), &content, &version_type, processing_type.as_deref(), provider.as_deref(), model.as_deref(), tier.as_deref(), true)?;
        refresh_search(&transaction, memory_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        self.list_text_versions(memory_id)?.into_iter().find(|version| version.id == id).ok_or_else(|| "Created text version was not found".to_string())
    }

    pub fn restore_text_version(&self, version_id: &str) -> Result<TextVersion, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        // A2：先确认目标版本存在，再动"当前版本"指针。原实现先清零再检查，
        // 目标版本不存在时会留下"没有任何当前版本"的损坏状态。
        let memory_id: String = transaction.query_row(
            "SELECT memory_id FROM text_versions WHERE id=?1", [version_id],
            |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Text version not found".to_string())?;
        // A2：恢复只切换 is_current 指针，**不复制内容、不新增版本**，
        // 因此反复恢复同一个历史版本不会让版本数量增长。
        transaction.execute(
            "UPDATE text_versions SET is_current=0 WHERE memory_id=?1",
            [&memory_id],
        ).map_err(|e| e.to_string())?;
        transaction.execute(
            "UPDATE text_versions SET is_current=1 WHERE id=?1",
            [version_id],
        ).map_err(|e| e.to_string())?;
        // A2：版本切换与搜索索引更新在同一事务内提交，不会出现
        // "版本已切换但搜索索引仍是旧内容"的中间态。
        refresh_search(&transaction, &memory_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        self.list_text_versions(&memory_id)?.into_iter()
            .find(|version| version.id == version_id)
            .ok_or_else(|| "Text version was not found".to_string())
    }

    pub fn delete_text_version(&self, version_id: &str) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let (memory_id, version_type): (String, String) = transaction.query_row(
            "SELECT memory_id, version_type FROM text_versions WHERE id=?1", [version_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Text version not found".to_string())?;

        // A2 保护一：原始转写不得被"删除历史版本"删掉。原始素材一旦丢失就无法重建。
        if version_type == "raw_transcription" {
            return Err("无法删除：这是该记忆的原始转写，属于原始素材，必须保留。".to_string());
        }

        // A2 保护二：被历史草稿引用过的版本不能硬删除，否则旧草稿的来源会断裂。
        // 草稿来源记录的是"生成当时用了哪一版"，删掉版本就再也无法追溯。
        let referencing_drafts: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM chapter_draft_sources WHERE text_version_id=?1", [version_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if referencing_drafts > 0 {
            return Err(format!(
                "无法删除：该版本被 {} 份历史草稿引用为来源，删除会导致来源断裂。",
                referencing_drafts
            ));
        }

        // Ensure we don't delete the only remaining version
        let count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM text_versions WHERE memory_id=?1", [&memory_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if count <= 1 {
            return Err("无法删除：每条记忆至少需要保留一个文本版本。".to_string());
        }
        // If deleting the current version, promote the most recent remaining one
        let is_current: i64 = transaction.query_row(
            "SELECT is_current FROM text_versions WHERE id=?1", [version_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM text_versions WHERE id=?1", [version_id]).map_err(|e| e.to_string())?;
        if is_current != 0 {
            transaction.execute(
                "UPDATE text_versions SET is_current=1 WHERE id=(SELECT id FROM text_versions WHERE memory_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1)",
                [&memory_id],
            ).map_err(|e| e.to_string())?;
        }
        refresh_search(&transaction, &memory_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_memory_tags(&self, memory_id: &str, names: Vec<String>) -> Result<(), String> { self.set_named_links(memory_id, names, true) }
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
        // A3：软删除章节时**保留** chapter_memories 关联，不清空。
        // 章节与记忆的关联本身是用户整理成果的一部分；软删后这些关联仍可用于
        // 溯源与恢复，只有硬删除才需要（届时一并）清理。
        connection.execute("UPDATE chapters SET deleted_at=?2 WHERE id=?1", params![chapter_id, now()]).map_err(|e| e.to_string())?;
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
    }

    pub fn list_all_people(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT p.name FROM people p JOIN memory_people mp ON mp.person_id=p.id JOIN memories m ON m.id=mp.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    pub fn list_all_tags(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
        let mut stmt = connection.prepare(
            "SELECT DISTINCT t.name FROM tags t JOIN memory_tags mt ON mt.tag_id=t.id JOIN memories m ON m.id=mt.memory_id WHERE m.project_id=?1 AND m.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([project_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }

    pub fn list_all_locations(&self, project_id: &str) -> Result<Vec<String>, String> {
        self.initialize()?;
        let connection = self.open()?;
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

    /// A2：创建草稿时必须声明来源（实际使用的记忆 + 文本版本）。来源与草稿在同一事务写入。
    #[allow(clippy::too_many_arguments)]
    pub fn create_chapter_draft(
        &self,
        chapter_id: &str,
        content: String,
        draft_type: String,
        processing_type: Option<String>,
        provider: Option<String>,
        model: Option<String>,
        tier: Option<String>,
        requirement: Option<String>,
        sources: Vec<DraftSourceInput>,
    ) -> Result<ChapterDraft, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute("UPDATE chapter_drafts SET is_current=0 WHERE chapter_id=?1", [chapter_id]).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now_str = now();
        transaction.execute(
            "INSERT INTO chapter_drafts(id,chapter_id,content,draft_type,processing_type,provider,model,tier,requirement,is_current,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10)",
            params![id, chapter_id, content, draft_type, processing_type, provider, model, tier, requirement, now_str],
        ).map_err(|e| e.to_string())?;
        for source in &sources {
            insert_draft_source(&transaction, &id, &source.memory_id, source.text_version_id.as_deref(), &now_str)?;
        }
        transaction.commit().map_err(|e| e.to_string())?;
        list_chapter_drafts(&self.open()?, chapter_id)?
            .into_iter()
            .find(|draft| draft.id == id)
            .ok_or_else(|| "Created chapter draft was not found".to_string())
    }

    pub fn delete_chapter_draft(&self, draft_id: &str) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let (chapter_id, was_current): (String, i64) = transaction.query_row(
            "SELECT chapter_id, is_current FROM chapter_drafts WHERE id=?1", [draft_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Chapter draft not found".to_string())?;

        // 草稿来源随草稿一起删除（未使用 ON DELETE CASCADE，需显式清理）。
        transaction.execute("DELETE FROM chapter_draft_sources WHERE draft_id=?1", [draft_id]).map_err(|e| e.to_string())?;
        transaction.execute("DELETE FROM chapter_drafts WHERE id=?1", [draft_id]).map_err(|e| e.to_string())?;

        // A2：删掉的是"当前草稿"时，必须明确接管：切换到剩余最新的一版；
        // 没有剩余草稿则进入"无草稿状态"。绝不能留下章节没有当前草稿却又
        // 指着一个已删除 ID 的中间态。
        if was_current != 0 {
            let promoted = transaction.execute(
                "UPDATE chapter_drafts SET is_current=1
                 WHERE id=(SELECT id FROM chapter_drafts WHERE chapter_id=?1 ORDER BY created_at DESC LIMIT 1)",
                [&chapter_id],
            ).map_err(|e| e.to_string())?;
            if promoted == 0 {
                log::info!("章节 {} 已无剩余草稿，进入无草稿状态", chapter_id);
            }
        }
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// A2：恢复历史草稿**只切换 is_current 指针**，不复制内容、不新建草稿。
    /// 因此反复恢复同一份草稿不会让草稿数量增长，生成时的来源记录也原样保留。
    pub fn restore_chapter_draft(&self, draft_id: &str) -> Result<ChapterDraft, String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        let chapter_id: String = transaction.query_row(
            "SELECT chapter_id FROM chapter_drafts WHERE id=?1", [draft_id],
            |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Chapter draft not found".to_string())?;
        transaction.execute("UPDATE chapter_drafts SET is_current=0 WHERE chapter_id=?1", [&chapter_id]).map_err(|e| e.to_string())?;
        transaction.execute("UPDATE chapter_drafts SET is_current=1 WHERE id=?1", [draft_id]).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        // 已存在的内容返回同一份草稿（含其生成时记录），不产生新记录。
        list_chapter_drafts(&self.open()?, &chapter_id)?
            .into_iter()
            .find(|draft| draft.id == draft_id)
            .ok_or_else(|| "Chapter draft was not found".to_string())
    }

    fn set_named_links(&self, memory_id: &str, names: Vec<String>, tags: bool) -> Result<(), String> {
        self.initialize()?;
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        ensure_memory_exists(&transaction, memory_id)?;
        let (table, link_table, id_column) = if tags { ("tags", "memory_tags", "tag_id") } else { ("people", "memory_people", "person_id") };
        transaction.execute(&format!("DELETE FROM {link_table} WHERE memory_id=?1"), [memory_id]).map_err(|e| e.to_string())?;
        for name in names.into_iter().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
            let id: String = transaction.query_row(&format!("SELECT id FROM {table} WHERE name=?1"), [name.as_str()], |row| row.get(0))
                .optional().map_err(|e| e.to_string())?.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            transaction.execute(&format!("INSERT OR IGNORE INTO {table}(id,name,created_at) VALUES(?1,?2,?3)"), params![id, name, now()]).map_err(|e| e.to_string())?;
            transaction.execute(&format!("INSERT OR IGNORE INTO {link_table}(memory_id,{id_column}) VALUES(?1,?2)"), params![memory_id, id]).map_err(|e| e.to_string())?;
        }
        refresh_search(&transaction, memory_id)?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub fn migrate_legacy_projects(&self, legacy_dir: &Path) -> Result<MigrationReport, String> {
        self.initialize()?;
        if !legacy_dir.exists() { return Ok(MigrationReport { imported_projects: 0, imported_memories: 0, skipped_projects: 0, backups: Vec::new() }); }
        let mut report = MigrationReport { imported_projects: 0, imported_memories: 0, skipped_projects: 0, backups: Vec::new() };
        for entry in fs::read_dir(legacy_dir).map_err(|e| format!("Cannot read legacy projects: {e}"))? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("vse") { continue; }
            let source = path.to_string_lossy().to_string();
            let connection = self.open()?;
            let already_imported = connection.query_row("SELECT 1 FROM legacy_imports WHERE source_path=?1", [source.as_str()], |_| Ok(()))
                .optional().map_err(|e| e.to_string())?.is_some();
            if already_imported { report.skipped_projects += 1; continue; }
            let backup = legacy_backup_path(&path);
            if !backup.exists() { fs::copy(&path, &backup).map_err(|e| format!("Cannot back up legacy project {}: {e}", path.display()))?; }
            let content = fs::read_to_string(&path).map_err(|e| format!("Cannot read legacy project {}: {e}", path.display()))?;
            let legacy: Project = match serde_json::from_str(&content) {
                Ok(project) => project,
                Err(error) => {
                    log::warn!("跳过无法解析的旧版项目 {}: {}", path.display(), error);
                    report.skipped_projects += 1;
                    continue;
                }
            };
            let imported = self.import_legacy_project(&source, &legacy)?;
            report.imported_projects += 1;
            report.imported_memories += imported;
            report.backups.push(backup.to_string_lossy().to_string());
        }
        Ok(report)
    }

    fn import_legacy_project(&self, source: &str, legacy: &Project) -> Result<usize, String> {
        let mut connection = self.open()?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute("INSERT OR IGNORE INTO projects(id,name,created_at,updated_at) VALUES(?1,?2,?3,?4)", params![legacy.id, legacy.name, legacy.created_at, legacy.updated_at]).map_err(|e| e.to_string())?;
        let mut count = 0;
        for clip in &legacy.clips {
            let memory_id = uuid::Uuid::new_v4().to_string();
            transaction.execute(
                "INSERT INTO memories(id,project_id,title,audio_recorded_at,event_date_precision,status,created_at,updated_at) VALUES(?1,?2,?3,?4,'unknown','inbox',?4,?4)",
                params![memory_id, legacy.id, format!("Memory {}", count + 1), clip.timestamp],
            ).map_err(|e| e.to_string())?;
            if let Some(path) = &clip.audio_path { insert_audio(&transaction, &memory_id, path, Some(clip.duration_secs), None, Some(&clip.timestamp))?; }
            let raw_id = insert_text_version(&transaction, &memory_id, None, &clip.raw_text, "raw_transcription", Some("legacy_import"), None, None, None, clip.edited_text.is_none())?;
            if let Some(edited) = &clip.edited_text { insert_text_version(&transaction, &memory_id, Some(&raw_id), edited, "user_edit", Some("legacy_import"), None, None, None, true)?; }
            refresh_search(&transaction, &memory_id)?;
            count += 1;
        }
        for (kind, title, content) in [("polished", "Legacy polished text", &legacy.polished_text), ("essay", "Legacy essay", &legacy.essay_text)] {
            if !content.trim().is_empty() {
                transaction.execute("INSERT INTO legacy_documents(id,project_id,document_type,title,content,created_at) VALUES(?1,?2,?3,?4,?5,?6)", params![uuid::Uuid::new_v4().to_string(), legacy.id, kind, title, content, legacy.updated_at]).map_err(|e| e.to_string())?;
            }
        }
        transaction.execute("INSERT INTO legacy_imports(source_path,project_id,imported_at) VALUES(?1,?2,?3)", params![source, legacy.id, now()]).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }
}

fn now() -> String { Local::now().to_rfc3339() }
fn legacy_backup_path(path: &Path) -> PathBuf { PathBuf::from(format!("{}.backup", path.to_string_lossy())) }
fn ensure_project_exists(transaction: &Transaction<'_>, id: &str) -> Result<(), String> { if transaction.query_row("SELECT 1 FROM projects WHERE id=?1 AND deleted_at IS NULL", [id], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some() { Ok(()) } else { Err("Library project not found".to_string()) } }
fn ensure_memory_exists(transaction: &Transaction<'_>, id: &str) -> Result<(), String> { if transaction.query_row("SELECT 1 FROM memories WHERE id=?1 AND deleted_at IS NULL", [id], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some() { Ok(()) } else { Err("Memory not found".to_string()) } }

fn insert_audio(transaction: &Transaction<'_>, memory_id: &str, file_path: &str, duration_secs: Option<f64>, sample_rate: Option<i64>, recorded_at: Option<&str>) -> Result<(), String> {
    insert_audio_full(transaction, memory_id, file_path, duration_secs, sample_rate, recorded_at, None, None, None)
}

/// B1：完整版音频登记，额外记录原始文件名、实际格式与文件校验值（导入音频用）。
pub(crate) fn insert_audio_full(
    transaction: &Transaction<'_>,
    memory_id: &str,
    file_path: &str,
    duration_secs: Option<f64>,
    sample_rate: Option<i64>,
    recorded_at: Option<&str>,
    original_filename: Option<&str>,
    source_format: Option<&str>,
    file_checksum: Option<&str>,
) -> Result<(), String> {
    transaction.execute(
        "INSERT INTO audio_assets(id,memory_id,file_path,duration_secs,sample_rate,recorded_at,created_at,original_filename,source_format,file_checksum)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            uuid::Uuid::new_v4().to_string(), memory_id, file_path, duration_secs, sample_rate,
            recorded_at, now(), original_filename, source_format, file_checksum
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn insert_text_version(transaction: &Transaction<'_>, memory_id: &str, parent: Option<&str>, content: &str, version_type: &str, processing_type: Option<&str>, provider: Option<&str>, model: Option<&str>, tier: Option<&str>, make_current: bool) -> Result<String, String> {
    if make_current { transaction.execute("UPDATE text_versions SET is_current=0 WHERE memory_id=?1", [memory_id]).map_err(|e| e.to_string())?; }
    let id = uuid::Uuid::new_v4().to_string();
    transaction.execute("INSERT INTO text_versions(id,memory_id,parent_version_id,content,version_type,processing_type,provider,model,tier,is_current,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)", params![id, memory_id, parent, content, version_type, processing_type, provider, model, tier, if make_current { 1 } else { 0 }, now()]).map_err(|e| e.to_string())?;
    Ok(id)
}

pub(crate) fn refresh_search(connection: &Connection, memory_id: &str) -> Result<(), String> {
    connection.execute("DELETE FROM memory_fts WHERE memory_id=?1", [memory_id]).map_err(|e| e.to_string())?;
    let record = connection.query_row("SELECT title,COALESCE(location,''),COALESCE(notes,'') FROM memories WHERE id=?1 AND deleted_at IS NULL", [memory_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))).optional().map_err(|e| e.to_string())?;
    let Some((title, location, notes)) = record else { return Ok(()); };
    let content: String = connection.query_row("SELECT COALESCE(content,'') FROM text_versions WHERE memory_id=?1 AND is_current=1 ORDER BY created_at DESC LIMIT 1", [memory_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or_default();
    let tags = linked_names(connection, "tags", "memory_tags", "tag_id", memory_id)?;
    let people = linked_names(connection, "people", "memory_people", "person_id", memory_id)?;
    connection.execute("INSERT INTO memory_fts(memory_id,title,content,location,notes,tags,people) VALUES(?1,?2,?3,?4,?5,?6,?7)", params![memory_id, title, content, location, notes, tags.join(" "), people.join(" ")]).map_err(|e| e.to_string())?;
    Ok(())
}

fn list_chapter_drafts(connection: &Connection, chapter_id: &str) -> Result<Vec<ChapterDraft>, String> {
    let mut stmt = connection.prepare(
        "SELECT id,chapter_id,content,draft_type,processing_type,provider,model,tier,requirement,is_current,created_at
         FROM chapter_drafts WHERE chapter_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let drafts = stmt.query_map([chapter_id], |row| Ok(ChapterDraft {
        id: row.get(0)?, chapter_id: row.get(1)?, content: row.get(2)?, draft_type: row.get(3)?,
        processing_type: row.get(4)?, provider: row.get(5)?, model: row.get(6)?, tier: row.get(7)?,
        requirement: row.get(8)?,
        is_current: row.get::<_, i64>(9)? != 0, created_at: row.get(10)?,
        sources: Vec::new(),
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    // 来源逐份草稿读取；章节草稿数量很小，N+1 查询可以接受，换来的是
    // "来源永远是生成时的记录"这一确定性。
    let mut with_sources = Vec::with_capacity(drafts.len());
    for mut draft in drafts {
        draft.sources = list_draft_sources(connection, &draft.id)?;
        with_sources.push(draft);
    }
    Ok(with_sources)
}

/// A2：写入一条草稿来源。记忆标题与版本类型按 ID 回查后**快照**保存，
/// 这样记忆日后改名、或版本类型变化，旧草稿仍能准确说明"当时用了什么"。
fn insert_draft_source(
    transaction: &Transaction<'_>,
    draft_id: &str,
    memory_id: &str,
    text_version_id: Option<&str>,
    recorded_at: &str,
) -> Result<(), String> {
    let memory_title: String = transaction.query_row(
        "SELECT title FROM memories WHERE id=?1", [memory_id], |row| row.get(0),
    ).optional().map_err(|e| e.to_string())?.unwrap_or_default();
    let version_type: Option<String> = match text_version_id {
        Some(version_id) => transaction.query_row(
            "SELECT version_type FROM text_versions WHERE id=?1", [version_id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?,
        None => None,
    };
    transaction.execute(
        "INSERT INTO chapter_draft_sources(id,draft_id,memory_id,memory_title,text_version_id,version_type,recorded_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![uuid::Uuid::new_v4().to_string(), draft_id, memory_id, memory_title, text_version_id, version_type, recorded_at],
    ).map_err(|e| format!("Cannot record chapter draft source: {e}"))?;
    Ok(())
}

/// A2：读取某份草稿在生成时记录的来源。
fn list_draft_sources(connection: &Connection, draft_id: &str) -> Result<Vec<ChapterDraftSource>, String> {
    let mut stmt = connection.prepare(
        "SELECT s.memory_id, s.memory_title, s.text_version_id, s.version_type,
                CASE WHEN s.text_version_id IS NULL THEN 0
                     WHEN EXISTS(SELECT 1 FROM text_versions v WHERE v.id = s.text_version_id) THEN 0
                     ELSE 1 END
         FROM chapter_draft_sources s WHERE s.draft_id=?1 ORDER BY s.recorded_at"
    ).map_err(|e| e.to_string())?;
    let sources = stmt.query_map([draft_id], |row| Ok(ChapterDraftSource {
        memory_id: row.get(0)?, memory_title: row.get(1)?, text_version_id: row.get(2)?,
        version_type: row.get(3)?, version_missing: row.get::<_, i64>(4)? != 0,
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(sources)
}

fn memory_summary(connection: &Connection, id: &str) -> Result<MemorySummary, String> {
    let base = connection.query_row("SELECT id,project_id,title,audio_recorded_at,event_date_text,event_date_precision,event_date_sort,location,notes,status,created_at,updated_at,deleted_at FROM memories WHERE id=?1", [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?,row.get(9)?,row.get(10)?,row.get(11)?,row.get(12)?))).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Memory not found".to_string())?;
    let audio_count = connection.query_row("SELECT COUNT(*) FROM audio_assets WHERE memory_id=?1", [id], |row| row.get(0)).map_err(|e| e.to_string())?;
    let version_count = connection.query_row("SELECT COUNT(*) FROM text_versions WHERE memory_id=?1", [id], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(MemorySummary { id: base.0, project_id: base.1, title: base.2, audio_recorded_at: base.3, event_date_text: base.4, event_date_precision: base.5, event_date_sort: base.6, location: base.7, notes: base.8, status: base.9, created_at: base.10, updated_at: base.11, deleted_at: base.12, audio_count, version_count, tags: linked_names(connection, "tags", "memory_tags", "tag_id", id)?, people: linked_names(connection, "people", "memory_people", "person_id", id)? })
}
fn linked_names(connection: &Connection, table: &str, link: &str, id_column: &str, memory_id: &str) -> Result<Vec<String>, String> {
    let sql = format!("SELECT t.name FROM {table} t JOIN {link} l ON l.{id_column}=t.id WHERE l.memory_id=?1 ORDER BY t.name COLLATE NOCASE");
    let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let names = statement.query_map([memory_id], |row| row.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(names)
}
fn list_audio(connection: &Connection, memory_id: &str) -> Result<Vec<AudioAsset>, String> {
    let mut statement = connection.prepare("SELECT id,memory_id,file_path,duration_secs,sample_rate,recorded_at,created_at,original_filename,source_format,file_checksum FROM audio_assets WHERE memory_id=?1 ORDER BY created_at").map_err(|e| e.to_string())?;
    let assets = statement.query_map([memory_id], |row| Ok(AudioAsset {
        id: row.get(0)?, memory_id: row.get(1)?, file_path: row.get(2)?, duration_secs: row.get(3)?,
        sample_rate: row.get(4)?, recorded_at: row.get(5)?, created_at: row.get(6)?,
        original_filename: row.get(7)?, source_format: row.get(8)?, file_checksum: row.get(9)?,
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(assets)
}
fn read_transcription_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranscriptionTask> {
    Ok(TranscriptionTask {
        id: row.get(0)?, memory_id: row.get(1)?, audio_path: row.get(2)?, status: row.get(3)?,
        error: row.get(4)?, model: row.get(5)?, language: row.get(6)?, attempts: row.get(7)?,
        created_at: row.get(8)?, updated_at: row.get(9)?,
    })
}

fn transcription_task_row(connection: &Connection, memory_id: &str) -> Result<Option<TranscriptionTask>, String> {
    connection.query_row(
        "SELECT id,memory_id,audio_path,status,error,model,language,attempts,created_at,updated_at
         FROM transcription_tasks WHERE memory_id=?1 ORDER BY CASE WHEN status='success' THEN 1 ELSE 0 END, created_at DESC LIMIT 1",
        [memory_id], read_transcription_task,
    ).optional().map_err(|e| e.to_string())
}

fn list_versions(connection: &Connection, memory_id: &str) -> Result<Vec<TextVersion>, String> {
    let mut statement = connection.prepare("SELECT id,memory_id,parent_version_id,content,version_type,processing_type,provider,model,tier,is_current,created_at FROM text_versions WHERE memory_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let versions = statement.query_map([memory_id], |row| Ok(TextVersion { id: row.get(0)?, memory_id: row.get(1)?, parent_version_id: row.get(2)?, content: row.get(3)?, version_type: row.get(4)?, processing_type: row.get(5)?, provider: row.get(6)?, model: row.get(7)?, tier: row.get(8)?, is_current: row.get::<_, i64>(9)? != 0, created_at: row.get(10)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(versions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::VoiceClip;

    fn test_library() -> (Library, PathBuf) { let path = std::env::temp_dir().join(format!("sound-to-essay-library-{}.sqlite3", uuid::Uuid::new_v4())); (Library::new(path.clone()), path) }
    #[test]
    fn memory_versions_search_and_soft_delete_work() {
        let (library, path) = test_library();
        let project = library.create_project("Memoir").unwrap();
        let memory = library.create_memory(CreateMemoryInput { project_id: project.id, title: "Childhood in Beijing".into(), audio_recorded_at: None, event_date_text: Some("around 1990".into()), event_date_precision: Some("approximate".into()), event_date_sort: Some(19900101), location: Some("Beijing".into()), notes: None, status: None, source_id: None, source_revision: None, audio_path: Some("C:/sounds/a.wav".into()), duration_secs: Some(3.0), sample_rate: Some(16000), raw_text: Some("I remember the old courtyard.".into()), original_filename: None, source_format: None, file_checksum: None }).unwrap();
        library.set_memory_tags(&memory.id, vec!["family".into()]).unwrap();
        assert_eq!(library.search_memories("courtyard", None).unwrap().len(), 1);
        let version = library.create_text_version(&memory.id, "Corrected memory".into(), "user_edit".into(), Some("manual".into()), None, None, None, None).unwrap();
        assert!(version.is_current);
        let restored = library.restore_text_version(&version.id).unwrap();
        assert!(restored.is_current);
        library.delete_memory(&memory.id).unwrap();
        assert!(library.list_memories(None, false).unwrap().is_empty());
        library.restore_memory(&memory.id).unwrap();
        assert_eq!(library.list_memories(None, false).unwrap().len(), 1);
        let _ = fs::remove_file(path);
    }
    #[test]
    fn legacy_import_is_backed_up_and_idempotent() {
        let (library, db_path) = test_library();
        let legacy_dir = std::env::temp_dir().join(format!("sound-to-essay-legacy-{}", uuid::Uuid::new_v4())); fs::create_dir_all(&legacy_dir).unwrap();
        let legacy = Project { id: "legacy-project".into(), name: "Old project".into(), created_at: now(), updated_at: now(), clips: vec![VoiceClip { id: "clip".into(), timestamp: now(), audio_path: Some("C:/missing.wav".into()), raw_text: "legacy transcript".into(), edited_text: Some("edited transcript".into()), duration_secs: 1.0, confidence: 1.0, transcription_status: None, transcription_error: None }], polished_text: "legacy polish".into(), essay_text: "legacy essay".into() };
        let file = legacy_dir.join("old.vse"); fs::write(&file, serde_json::to_string(&legacy).unwrap()).unwrap();
        let first = library.migrate_legacy_projects(&legacy_dir).unwrap(); assert_eq!(first.imported_memories, 1); assert!(legacy_backup_path(&file).exists());
        let second = library.migrate_legacy_projects(&legacy_dir).unwrap(); assert_eq!(second.imported_projects, 0); assert_eq!(second.skipped_projects, 1);
        assert_eq!(library.list_memories(Some("legacy-project"), false).unwrap().len(), 1);
        let _ = fs::remove_file(db_path); let _ = fs::remove_file(legacy_backup_path(&file)); let _ = fs::remove_dir_all(legacy_dir);
    }

    /// 复现并验证 P0：老库（memories / audio_assets 没有后加的新列）必须能成功升级。
    /// 修复前 initialize 在建表 batch 里执行 `CREATE INDEX ... ON memories(source_id)`，
    /// 而老表没有该列 → "no such column" → 整个资料库打不开。
    #[test]
    fn legacy_db_without_new_columns_upgrades_successfully() {
        let path = std::env::temp_dir().join(format!("sound-to-essay-legacy-schema-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                 CREATE TABLE memories (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, audio_recorded_at TEXT, event_date_text TEXT, event_date_precision TEXT NOT NULL DEFAULT 'unknown', event_date_sort INTEGER, location TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'inbox', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
                 CREATE TABLE audio_assets (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id), file_path TEXT NOT NULL, duration_secs REAL, sample_rate INTEGER, recorded_at TEXT, created_at TEXT NOT NULL);",
            ).unwrap();
        }
        let library = Library::new(path.clone());
        library.initialize().expect("老库升级应当成功");
        library.initialize().expect("重复 initialize 应当幂等");

        let conn = Connection::open(&path).unwrap();
        for (table, column) in [
            ("memories", "source_id"), ("memories", "source_revision"),
            ("audio_assets", "original_filename"), ("audio_assets", "source_format"), ("audio_assets", "file_checksum"),
        ] {
            let n: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'", table, column), [], |r| r.get(0),
            ).unwrap();
            assert_eq!(n, 1, "列 {}.{} 应已补齐", table, column);
        }
        for index in ["idx_memories_source", "idx_audio_assets_checksum"] {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1", [index], |r| r.get(0),
            ).unwrap();
            assert_eq!(n, 1, "索引 {} 应已建立", index);
        }
        let _ = fs::remove_file(path);
    }

    /// 用项目里真实的老库副本再验证一次升级路径（库不存在时跳过）。
    /// 合成库只覆盖已知差异；真实库可能带有历史迁移留下的其它状态。
    #[test]
    fn real_library_upgrades_without_error() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("data").join("oral_history.sqlite3");
        if !source.is_file() { return; }
        let copy = std::env::temp_dir().join(format!("sound-to-essay-realcopy-{}.sqlite3", uuid::Uuid::new_v4()));
        fs::copy(&source, &copy).unwrap();
        let library = Library::new(copy.clone());
        library.initialize().expect("真实库副本应能成功升级");
        let conn = Connection::open(&copy).unwrap();
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('memories') WHERE name='source_id'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 1, "真实库的 memories.source_id 应已补齐");
        let _ = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0));
        let _ = fs::remove_file(copy);
    }
}
