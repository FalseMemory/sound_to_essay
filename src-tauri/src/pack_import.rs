//! B3：桌面素材包导入。
//!
//! 按 `docs/素材包协议.md` v1 解析 `.svpack`（自实现容器，与 `.svbak` 同构）。
//! 导入语义（协议 §6）：
//! - 按 `recordId` 去重；`revision` 大者为更新；冲突保留双方并提示。
//! - 不传播删除；缺失音频不得伪装完整导入。
//! - SHA-256 仅用于完整性与去重，不构成身份认证。
//!
//! 首版仅支持 `.svpack`；未来识别 ZIP（`PK\x03\x04`）后归一化为同一结构。

use crate::backup::sha256;
use crate::library::Library;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::Path;

const PACK_MAGIC: &[u8; 8] = b"SVPACK1\0";
const ZIP_MAGIC: &[u8; 4] = b"PK\x03\x04";
const SUPPORTED_FORMAT_VERSION: i64 = 1;
const RECORDS_NAME: &str = "records.json";

// ---------- 协议结构（与 docs/素材包协议.md 对应） ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PackManifest {
    format_version: i64,
    pack_id: String,
    app_version: String,
    exported_at: String,
    record_count: i64,
    audio_count: i64,
    records: ManifestRef,
    audio: Vec<ManifestAudio>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestRef {
    #[allow(dead_code)]
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestAudio {
    asset_id: String,
    path: String,
    #[allow(dead_code)]
    format: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PackRecord {
    record_id: String,
    revision: i64,
    title: String,
    body: String,
    recorded_at: Option<String>,
    event_date_text: Option<String>,
    event_date_precision: Option<String>,
    people: Vec<String>,
    location: Option<String>,
    tags: Vec<String>,
    notes: Option<String>,
    audio: Vec<PackRecordAudio>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PackRecordAudio {
    asset_id: String,
    original_filename: Option<String>,
    source_format: Option<String>,
    duration_secs: Option<f64>,
    sample_rate: Option<i64>,
    sha256: String,
}

// ---------- 导入结果 ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreview {
    pub format_version: i64,
    pub pack_id: String,
    pub exported_at: String,
    pub app_version: String,
    pub record_count: usize,
    pub audio_count: usize,
    /// 本地已存在同 recordId 且 revision 相同的记录数（将跳过）。
    pub duplicates: usize,
    /// 本地已存在同 recordId 但 revision 不同的记录数（将更新或冲突）。
    pub conflicts: usize,
    /// 记录引用了但包内缺失的音频数。
    pub missing_audio: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackImportOutcome {
    pub imported: usize,
    pub updated: usize,
    pub skipped_duplicates: usize,
    pub conflicts_kept_both: usize,
    pub missing_audio: usize,
    pub audio_written: usize,
}

struct ParsedPack {
    manifest: PackManifest,
    records_json: Vec<u8>,
    /// (包内路径, 数据)
    files: Vec<(String, Vec<u8>)>,
}

fn read_u32<R: Read>(r: &mut R) -> Result<u32, String> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b).map_err(|e| format!("素材包损坏（读取长度失败）: {e}"))?;
    Ok(u32::from_le_bytes(b))
}
fn read_u64<R: Read>(r: &mut R) -> Result<u64, String> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b).map_err(|e| format!("素材包损坏（读取长度失败）: {e}"))?;
    Ok(u64::from_le_bytes(b))
}
fn read_sha<R: Read>(r: &mut R) -> Result<String, String> {
    let mut b = [0u8; 32];
    r.read_exact(&mut b).map_err(|e| format!("素材包损坏（读取校验值失败）: {e}"))?;
    Ok(b.iter().map(|byte| format!("{:02x}", byte)).collect())
}

fn parse_svpack(path: &Path) -> Result<ParsedPack, String> {
    use std::io::Seek;
    let mut file = fs::File::open(path).map_err(|e| format!("无法打开素材包: {e}"))?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if length > 512 * 1024 * 1024 { return Err("单个素材包上限为 512 MiB，请分批导出".into()); }
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)
        .map_err(|e| format!("素材包损坏（文件头不完整）: {e}"))?;
    if &magic != PACK_MAGIC {
        return Err("不是有效的声文素材包（文件头不匹配）".to_string());
    }
    let manifest_len = read_u32(&mut file)? as usize;
    if manifest_len > 16 * 1024 * 1024 { return Err("素材清单过大".into()); }
    let manifest_sha = read_sha(&mut file)?;
    let mut manifest_json = vec![0u8; manifest_len];
    file.read_exact(&mut manifest_json)
        .map_err(|e| format!("素材包损坏（清单不完整）: {e}"))?;
    if sha256(&manifest_json) != manifest_sha {
        return Err("素材包清单校验值不匹配，文件可能已损坏".to_string());
    }
    let manifest: PackManifest =
        serde_json::from_slice(&manifest_json).map_err(|e| format!("素材包清单解析失败: {e}"))?;

    let mut files = Vec::new();
    loop {
        if file.stream_position().map_err(|e| e.to_string())? == length { break; }
        let name_len = read_u32(&mut file)? as usize;
        if name_len > 4096 { return Err("素材包路径过长".into()); }
        let mut name_bytes = vec![0u8; name_len];
        file.read_exact(&mut name_bytes)
            .map_err(|e| format!("素材包损坏（文件名不完整）: {e}"))?;
        let name = String::from_utf8_lossy(&name_bytes).to_string();
        if !crate::backup::safe_entry(&name) || files.iter().any(|(n,_)| n == &name) { return Err("素材包路径非法或重复".into()); }
        let data_len = read_u64(&mut file)? as usize;
        let data_sha = read_sha(&mut file)?;
        if data_len as u64 > length.saturating_sub(file.stream_position().map_err(|e| e.to_string())?) { return Err("素材包长度越界".into()); }
        let mut data = vec![0u8; data_len];
        file.read_exact(&mut data)
            .map_err(|e| format!("素材包损坏（文件数据不完整）: {e}"))?;
        if sha256(&data) != data_sha {
            return Err(format!("素材包损坏：{} 校验值不匹配", name));
        }
        files.push((name, data));
    }

    let records_json = files
        .iter()
        .find(|(name, _)| name == RECORDS_NAME)
        .map(|(_, data)| data.clone())
        .ok_or_else(|| "素材包中缺少 records.json".to_string())?;

    Ok(ParsedPack { manifest, records_json, files })
}

fn parse_zip(_path: &Path) -> Result<ParsedPack, String> {
    Err("暂不支持 ZIP 容器（本机缺少链接器无法引入 ZIP 库）；请使用 .svpack 素材包。".to_string())
}

fn parse_pack(path: &Path) -> Result<ParsedPack, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("无法打开素材包: {e}"))?;
    let mut head = [0u8; 8];
    file.read_exact(&mut head)
        .map_err(|e| format!("素材包损坏（文件头不完整）: {e}"))?;
    drop(file);
    if &head[..4] == ZIP_MAGIC {
        parse_zip(path)
    } else if &head[..8] == PACK_MAGIC {
        parse_svpack(path)
    } else {
        Err("不是有效的声文素材包（无法识别的容器格式）".to_string())
    }
}

fn parse_records(data: &[u8]) -> Result<Vec<PackRecord>, String> {
    serde_json::from_slice(data).map_err(|e| format!("records.json 解析失败: {e}"))
}

/// 校验 manifest 声明的 records.json 与音频条目，返回 (records, missing_audio_count)。
fn validate_pack(parsed: &ParsedPack) -> Result<(Vec<PackRecord>, usize), String> {
    let manifest = &parsed.manifest;
    if manifest.format_version != SUPPORTED_FORMAT_VERSION {
        return Err(format!(
            "不支持的素材包格式版本 {}（当前支持 {}）",
            manifest.format_version, SUPPORTED_FORMAT_VERSION
        ));
    }
    if sha256(&parsed.records_json) != manifest.records.sha256 {
        return Err("records.json 校验值与清单不符".to_string());
    }
    if parsed.records_json.len() as u64 != manifest.records.size {
        return Err("records.json 大小与清单不符".to_string());
    }

    let mut missing_audio = 0usize;
    for audio in &manifest.audio {
        let entry = parsed.files.iter().find(|(name, _)| name == &audio.path);
        match entry {
            Some((_, data)) => {
                if data.len() as u64 != audio.size {
                    return Err(format!("音频 {} 大小与清单不符", audio.path));
                }
                if sha256(data) != audio.sha256 {
                    return Err(format!("音频 {} 校验值与清单不符", audio.path));
                }
            }
            None => missing_audio += 1,
        }
    }

    let records = parse_records(&parsed.records_json)?;
    if manifest.records.path != RECORDS_NAME || manifest.audio_count != manifest.audio.len() as i64 { return Err("素材清单计数或路径错误".into()); }
    let mut assets = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    for audio in &manifest.audio {
        if audio.asset_id.is_empty() || !assets.insert(&audio.asset_id) || !paths.insert(&audio.path)
            || !crate::backup::safe_entry(&audio.path) || !audio.path.starts_with("audio/") { return Err("音频标识或路径重复/非法".into()); }
    }
    let mut ids = std::collections::HashSet::new();
    for record in &records {
        if record.record_id.is_empty() || !ids.insert(&record.record_id) || record.revision < 1 { return Err("记录 ID 或修订号非法".into()); }
        let mut referenced = std::collections::HashSet::new();
        for audio in &record.audio {
            let meta = manifest.audio.iter().find(|a| a.asset_id == audio.asset_id).ok_or("记录引用的音频未在清单声明")?;
            if !referenced.insert(&audio.asset_id) || meta.sha256 != audio.sha256 { return Err("记录音频引用重复或校验不符".into()); }
        }
    }
    if records.len() as i64 != manifest.record_count {
        return Err(format!(
            "records.json 记录数 {} 与清单 {} 不符",
            records.len(), manifest.record_count
        ));
    }
    Ok((records, missing_audio))
}

/// 导入前预览：解析 + 校验 + 统计重复/冲突/缺失。
pub fn preview_pack(library: &Library, project_id: &str, pack_path: &Path) -> Result<PackPreview, String> {
    let parsed = parse_pack(pack_path)?;
    let (records, missing_audio) = validate_pack(&parsed)?;

    let mut duplicates = 0usize;
    let mut conflicts = 0usize;
    library.initialize()?;
    let connection = library.open()?;
    let has_receipts: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='pack_receipts')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    for record in &records {
        let digest = sha256(&serde_json::to_vec(record).map_err(|e| e.to_string())?);
        let duplicate: bool = has_receipts && connection.query_row("SELECT EXISTS(SELECT 1 FROM pack_receipts WHERE project_id=?1 AND source_id=?2 AND revision=?3 AND digest=?4)", rusqlite::params![project_id,record.record_id,record.revision,digest], |r| r.get(0)).map_err(|e| e.to_string())?;
        let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM memories WHERE project_id=?1 AND source_id=?2)", rusqlite::params![project_id,record.record_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if duplicate { duplicates += 1; } else if exists { conflicts += 1; }
    }

    Ok(PackPreview {
        format_version: parsed.manifest.format_version,
        pack_id: parsed.manifest.pack_id.clone(),
        exported_at: parsed.manifest.exported_at.clone(),
        app_version: parsed.manifest.app_version.clone(),
        record_count: records.len(),
        audio_count: parsed.manifest.audio.len(),
        duplicates,
        conflicts,
        missing_audio,
    })
}

/// 执行导入。返回导入结果统计。
pub fn import_pack(
    library: &Library,
    audio_dir: &Path,
    project_id: &str,
    pack_path: &Path,
) -> Result<PackImportOutcome, String> {
    let parsed = parse_pack(pack_path)?;
    let (records, missing_audio) = validate_pack(&parsed)?;

    if missing_audio != 0 { return Err("素材包缺少音频，未导入任何记录".into()); }
    library.initialize()?;
    fs::create_dir_all(audio_dir).map_err(|e| e.to_string())?;
    let mut connection = library.open()?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    tx.query_row("SELECT id FROM projects WHERE id=?1 AND deleted_at IS NULL", [project_id], |_| Ok(())).map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS pack_receipts (
        project_id TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
        digest TEXT NOT NULL, memory_id TEXT NOT NULL REFERENCES memories(id),
        PRIMARY KEY(project_id,source_id,revision,digest))").map_err(|e| e.to_string())?;
    let mut outcome = PackImportOutcome { imported: 0, updated: 0, skipped_duplicates: 0,
        conflicts_kept_both: 0, missing_audio: 0, audio_written: 0 };
    let timestamp = chrono::Utc::now().to_rfc3339();
    for record in records {
        let digest = sha256(&serde_json::to_vec(&record).map_err(|e| e.to_string())?);
        let duplicate: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pack_receipts WHERE project_id=?1 AND source_id=?2 AND revision=?3 AND digest=?4)",
            rusqlite::params![project_id, record.record_id, record.revision, digest], |r| r.get(0)).map_err(|e| e.to_string())?;
        if duplicate { outcome.skipped_duplicates += 1; continue; }
        let conflict: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM memories WHERE project_id=?1 AND source_id=?2)",
            rusqlite::params![project_id, record.record_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let title = if conflict { format!("{}（冲突副本）", record.title) } else { record.title.clone() };
        tx.execute("INSERT INTO memories(id,project_id,title,audio_recorded_at,event_date_text,event_date_precision,location,notes,status,created_at,updated_at,source_id,source_revision)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'inbox',?9,?9,?10,?11)",
            rusqlite::params![id, project_id, title, record.recorded_at, record.event_date_text, record.event_date_precision.as_deref().unwrap_or("unknown"),
                record.location, record.notes, timestamp, record.record_id, record.revision]).map_err(|e| e.to_string())?;
        if !record.body.is_empty() {
            crate::library::insert_text_version(&tx, &id, None, &record.body, "manual_edit", Some("mobile_import"), None, None, None, true)?;
        }
        for (table, links, key, names) in [
            ("tags", "memory_tags", "tag_id", &record.tags),
            ("people", "memory_people", "person_id", &record.people),
        ] {
            for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
                tx.execute(&format!("INSERT OR IGNORE INTO {table}(id,name,created_at) VALUES(?1,?2,?3)"),
                    rusqlite::params![uuid::Uuid::new_v4().to_string(), name, timestamp]).map_err(|e| e.to_string())?;
                tx.execute(&format!("INSERT OR IGNORE INTO {links}(memory_id,{key}) SELECT ?1,id FROM {table} WHERE name=?2"),
                    rusqlite::params![id,name]).map_err(|e| e.to_string())?;
            }
        }
        for audio in &record.audio {
            let meta = parsed.manifest.audio.iter().find(|a| a.asset_id == audio.asset_id).ok_or("音频清单缺失")?;
            let (_, data) = parsed.files.iter().find(|(p,_)| p == &meta.path).ok_or("音频缺失")?;
            // 文件名完全由本机生成，不使用包内路径、资产 ID 或原文件名。
            let extension = audio.source_format.as_deref().unwrap_or(&meta.format);
            let extension = match extension { "wav"|"m4a"|"mp4"|"aac"|"mp3"|"webm"|"ogg"|"flac" => extension, _ => "bin" };
            let dest = audio_dir.join(format!("import-{}.{}", uuid::Uuid::new_v4(), extension));
            use std::io::Write;
            let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| e.to_string())?;
            output.write_all(data).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
            crate::library::insert_audio_full(&tx, &id, &dest.to_string_lossy(), audio.duration_secs, audio.sample_rate,
                record.recorded_at.as_deref(), audio.original_filename.as_deref(), Some(extension), Some(&audio.sha256))?;
            tx.execute("INSERT INTO transcription_tasks(id,memory_id,audio_path,status,attempts,created_at,updated_at) VALUES(?1,?2,?3,'pending',0,?4,?4)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), id, dest.to_string_lossy(), timestamp]).map_err(|e| e.to_string())?;
            outcome.audio_written += 1;
        }
        crate::library::refresh_search(&tx, &id)?;
        tx.execute("INSERT INTO pack_receipts(project_id,source_id,revision,digest,memory_id) VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![project_id,record.record_id,record.revision,digest,id]).map_err(|e| e.to_string())?;
        outcome.imported += 1;
        if conflict { outcome.conflicts_kept_both += 1; }
    }
    // 失败时 SQLite 自动回滚；已写音频保留为未引用文件，绝不删除可能被并发操作引用的资料。
    tx.commit().map_err(|e| e.to_string())?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn import_is_atomic_project_scoped_and_repeatable() {
        let root = std::env::temp_dir().join(format!("sv-import-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let library = Library::new(root.join("test.sqlite3"));
        let project = library.create_project("one").unwrap();
        let path = mobile_sample();
        assert!(path.is_file(), "interop fixture must exist");
        let first = import_pack(&library, &root, &project.id, &path).unwrap();
        assert_eq!(first.imported, 3);
        assert_eq!(first.audio_written, 2);
        let again = import_pack(&library, &root, &project.id, &path).unwrap();
        assert_eq!(again.skipped_duplicates, 3);
        let preview = preview_pack(&library, &project.id, &path).unwrap();
        assert_eq!(preview.duplicates, 3);
        let mut changed = parse_pack(&path).unwrap();
        let mut records = parse_records(&changed.records_json).unwrap();
        records[0].body = "changed at same revision".into();
        let bytes = serde_json::to_vec(&records).unwrap();
        let mut manifest: serde_json::Value = serde_json::from_slice(&{
            let raw = fs::read(&path).unwrap();
            let size = u32::from_le_bytes(raw[8..12].try_into().unwrap()) as usize;
            raw[44..44+size].to_vec()
        }).unwrap();
        manifest["records"]["size"] = bytes.len().into();
        manifest["records"]["sha256"] = sha256(&bytes).into();
        changed.files.iter_mut().find(|(n,_)| n == RECORDS_NAME).unwrap().1 = bytes;
        let changed_path = root.join("changed.svpack");
        let mut output = fs::File::create(&changed_path).unwrap();
        use std::io::Write;
        fn hash_bytes(data: &[u8]) -> Vec<u8> { let h = sha256(data); (0..64).step_by(2).map(|i| u8::from_str_radix(&h[i..i+2],16).unwrap()).collect() }
        let manifest = serde_json::to_vec(&manifest).unwrap();
        output.write_all(PACK_MAGIC).unwrap();
        output.write_all(&(manifest.len() as u32).to_le_bytes()).unwrap();
        output.write_all(&hash_bytes(&manifest)).unwrap();
        output.write_all(&manifest).unwrap();
        for (name,data) in &changed.files {
            output.write_all(&(name.len() as u32).to_le_bytes()).unwrap();
            output.write_all(name.as_bytes()).unwrap();
            output.write_all(&(data.len() as u64).to_le_bytes()).unwrap();
            output.write_all(&hash_bytes(data)).unwrap();
            output.write_all(data).unwrap();
        }
        drop(output);
        assert_eq!(preview_pack(&library, &project.id, &changed_path).unwrap().conflicts, 1);
        assert_eq!(import_pack(&library, &root, &project.id, &changed_path).unwrap().conflicts_kept_both, 1);
        assert_eq!(import_pack(&library, &root, &project.id, &changed_path).unwrap().skipped_duplicates, 3);
        assert_eq!(library.list_memories(Some(&project.id), false).unwrap().len(), 4);
        let second = library.create_project("two").unwrap();
        assert_eq!(import_pack(&library, &root, &second.id, &path).unwrap().imported, 3);
        let connection = library.open().unwrap();
        let tasks: i64 = connection.query_row("SELECT COUNT(*) FROM transcription_tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(tasks, 4 + records[0].audio.len() as i64);
        // A constraint failure after file staging must roll back all records and receipts.
        connection.execute_batch("CREATE TRIGGER reject_import BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        let third = library.create_project("three").unwrap();
        assert!(import_pack(&library, &root, &third.id, &path).is_err());
        assert!(library.list_memories(Some(&third.id), false).unwrap().is_empty());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    /// 手机端样例包必须先由 `npx tsx tools/verify_mobile_pack.ts` 生成。
    fn mobile_sample() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tools")
            .join("pack_samples")
            .join("mobile_generated.svpack")
    }

    /// **跨实现互操作验证**：手机端在浏览器里打包，桌面端在 Rust 里解析，是两套独立实现。
    /// 只做类型检查、构建通过，都证明不了"手机上导出的包电脑能导入"——必须真的解一遍。
    #[test]
    fn mobile_generated_pack_can_be_parsed_and_validated() {
        let path = mobile_sample();
        if !path.is_file() {
            // 未生成样本时跳过（避免在没有 Node 工具链的环境中失败）
            return;
        }

        let parsed = parse_pack(&path).expect("手机端生成的素材包应当能被解析");
        let (records, missing_audio) = validate_pack(&parsed).expect("手机端素材包应当通过完整性校验");

        assert_eq!(records.len(), 3, "样本包含 3 条记录");
        assert_eq!(missing_audio, 0, "样本包音频齐全");
        assert_eq!(parsed.manifest.record_count, 3);
        assert_eq!(parsed.manifest.audio.len(), 2, "两条记录带音频");

        // 纯文字记录（第 3 条）不应带音频，且记录字段应完整还原
        let plain = records
            .iter()
            .find(|record| record.record_id == "mobile-rec-3")
            .expect("应当包含纯文字记录");
        assert!(plain.audio.is_empty(), "纯文字记录不应带音频");
        assert_eq!(plain.title, "纯文字记录");

        // 带音频的记录要能通过 manifest 反查回包里真实的音频条目
        let with_audio = records
            .iter()
            .find(|record| record.record_id == "mobile-rec-1")
            .expect("应当包含带音频的记录");
        assert_eq!(with_audio.audio.len(), 1);
        let asset_id = &with_audio.audio[0].asset_id;
        let entry = parsed
            .manifest
            .audio
            .iter()
            .find(|audio| &audio.asset_id == asset_id)
            .expect("音频条目应能在 manifest 中找到");
        assert!(
            parsed.files.iter().any(|(name, _)| name == &entry.path),
            "manifest 声明的音频路径应当真实存在于包内"
        );
    }
}
