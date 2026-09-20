//! A3：完整备份与恢复（零外部依赖，自实现极简归档格式 `.svbak`）。
//!
//! 计划要求"包含数据库、音频及恢复清单的完整备份与恢复流程"，并未规定必须用
//! ZIP。本机缺少 C 链接器、无法引入带 build script 的压缩库，因此采用自实现的
//! 轻量二进制归档：不压缩（音频多为已压缩的 WAV/PCM，压缩收益有限），但带
//! 逐文件 SHA-256 校验值与 manifest，保证完整性与可校验恢复。
//!
//! 包结构（单文件、按顺序排列）：
//! - `manifest.json`：协议版本、应用版本、备份时间、数据库与音频清单及校验值。
//! - `library.sqlite3`：通过 SQLite 在线备份 API 得到的**一致性快照**。
//! - `audio/<文件名>`：被引用的原始音频。
//!
//! 文件头布局（小端）：
//! ```text
//! magic "SVBAK01\0" (8B) | manifest_len u32 | manifest_sha256 32B
//! manifest_json manifest_len B
//! [file_entry]*
//! file_entry: name_len u32 | name UTF-8 | data_len u64 | data_sha256 32B | data
//! ```

use crate::library::Library;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const BACKUP_FORMAT_VERSION: i64 = 1;
const MAGIC: &[u8; 8] = b"SVBAK01\0";
const DB_ENTRY: &str = "library.sqlite3";
const AUDIO_DIR: &str = "audio";

#[cfg(test)]
mod regression_tests {
    use super::*;
    #[test]
    fn backup_roundtrip_relocates_audio_and_rejects_truncated_tail() {
        let root = std::env::temp_dir().join(format!("sv-backup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let original = Library::new(root.join("source.sqlite3"));
        let project = original.create_project("test").unwrap();
        let audio = root.join("voice.wav");
        fs::write(&audio, b"synthetic-audio").unwrap();
        let conn = original.open().unwrap();
        conn.execute("INSERT INTO memories(id,project_id,title,status,created_at,updated_at) VALUES('m',?1,'test','inbox','now','now')", [&project.id]).unwrap();
        conn.execute("INSERT INTO audio_assets(id,memory_id,file_path,created_at) VALUES('a','m',?1,'now')", [audio.to_string_lossy()]).unwrap();
        drop(conn);
        let archive = root.join("test.svbak");
        create_backup(&original, &root, &archive).unwrap();
        validate_backup(&archive, &root).unwrap();
        let restored = Library::new(root.join("restored.sqlite3"));
        restored.initialize().unwrap();
        restore_backup(&restored, &root.join("new-sounds"), &archive, &root.join("rollback.sqlite3")).unwrap();
        let paths = restored.referenced_audio_paths().unwrap();
        assert_eq!(paths.len(), 1);
        assert_ne!(paths[0], audio.to_string_lossy());
        assert_eq!(fs::read(&paths[0]).unwrap(), b"synthetic-audio");
        let mut bytes = fs::read(&archive).unwrap();
        bytes.push(1);
        fs::write(&archive, bytes).unwrap();
        assert!(validate_backup(&archive, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn archive_paths_cannot_escape() {
        for path in ["../a", "audio/../a", "C:/a", "audio\\a", "/a", "audio//a"] { assert!(!safe_entry(path)); }
        assert!(safe_entry("audio/a.wav"));
        assert_eq!(sha256(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format_version: i64,
    pub app_version: String,
    pub created_at: String,
    pub database: ManifestFile,
    pub audio: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    /// 包内相对路径（如 `library.sqlite3` 或 `audio/xxx.wav`）。
    pub path: String,
    pub size: u64,
    /// hex(SHA-256)，用于完整性校验。
    pub sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub archive_path: String,
    pub audio_count: usize,
    pub database_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub format_version: i64,
    pub created_at: String,
    pub app_version: String,
    pub audio_count: usize,
    pub database_bytes: u64,
    /// 备份里记录、但当前磁盘上已不存在的音频数（恢复后这些音频会回来）。
    pub audio_missing_locally: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub audio_restored: usize,
    pub database_replaced: bool,
}

/// 自实现 SHA-256（标准库无内建）。仅用于备份完整性校验与导入文件校验，不涉安全敏感场景。
pub(crate) fn sha256(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = String::with_capacity(64);
    for word in h {
        out.push_str(&format!("{:08x}", word));
    }
    out
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取文件 {:?}: {}", path, e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    Ok(sha256(&data))
}

/// 收集资料库引用的音频路径（去重、只保留存在的常规文件）。
fn collect_audio_paths(library: &Library) -> Result<Vec<PathBuf>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut paths = Vec::new();
    let connection = rusqlite::Connection::open_with_flags(library.db_path(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let mut statement = connection.prepare("SELECT DISTINCT file_path FROM audio_assets").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    for raw in rows {
        let raw = raw.map_err(|e| e.to_string())?;
        let path = PathBuf::from(&raw);
        if !path.is_file() {
            return Err(format!("引用的音频不存在，无法创建完整备份: {}", path.display()));
        }
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn write_u32<W: Write>(w: &mut W, v: u32) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(|e| e.to_string())
}
fn write_sha<W: Write>(w: &mut W, data: &[u8]) -> Result<(), String> {
    let hex = sha256(data);
    let bytes: Vec<u8> = (0..64).step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
    w.write_all(&bytes).map_err(|e| e.to_string())
}

pub(crate) fn safe_entry(name: &str) -> bool {
    !name.is_empty() && !name.contains(['\\', ':', '\0'])
        && name.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}
fn write_u64<W: Write>(w: &mut W, v: u64) -> Result<(), String> {
    w.write_all(&v.to_le_bytes()).map_err(|e| e.to_string())
}
fn read_u32<R: Read>(r: &mut R) -> Result<u32, String> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b).map_err(|e| format!("备份文件损坏（读取长度失败）: {e}"))?;
    Ok(u32::from_le_bytes(b))
}
fn read_u64<R: Read>(r: &mut R) -> Result<u64, String> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b).map_err(|e| format!("备份文件损坏（读取长度失败）: {e}"))?;
    Ok(u64::from_le_bytes(b))
}
fn read_sha<R: Read>(r: &mut R) -> Result<String, String> {
    let mut b = [0u8; 32];
    r.read_exact(&mut b).map_err(|e| format!("备份文件损坏（读取校验值失败）: {e}"))?;
    Ok(b.iter().map(|byte| format!("{:02x}", byte)).collect())
}

/// 创建完整备份。`archive_path` 是目标文件路径（建议 `.svbak` 后缀）。
pub fn create_backup(
    library: &Library,
    _audio_dir: &Path,
    archive_path: &Path,
) -> Result<BackupOutcome, String> {
    let work = std::env::temp_dir().join(format!("sound-to-essay-backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work).map_err(|e| format!("无法创建备份临时目录: {e}"))?;

    let result = (|| -> Result<BackupOutcome, String> {
        // 1) 一致性快照数据库（SQLite 在线备份 API，而非复制活动文件）。
        let db_snapshot = work.join(DB_ENTRY);
        library.backup_to(&db_snapshot)?;
        let db_size = fs::metadata(&db_snapshot).map_err(|e| e.to_string())?.len();

        // 2) 收集被引用的音频。
        let audio_paths = collect_audio_paths(&Library::new(db_snapshot.clone()))?;
        let mut audio_entries: Vec<ManifestFile> = Vec::new();
        for path in &audio_paths {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .ok_or_else(|| format!("音频路径无效: {:?}", path))?;
            let entry_path = format!("{}/{}-{}", AUDIO_DIR, uuid::Uuid::new_v4(), name);
            let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
            let sha = file_sha256(path)?;
            audio_entries.push(ManifestFile { source_path: Some(path.to_string_lossy().into_owned()), path: entry_path, size, sha256: sha });
        }

        let audio_count = audio_entries.len();
        if db_size + audio_entries.iter().map(|a| a.size).sum::<u64>() > 1000 * 1024 * 1024 {
            return Err("当前完整备份上限约为 1 GiB，资料超过限制；原始资料未修改，请先复制资料目录作为额外备份。".into());
        }
        // 先把 (磁盘路径, 包内路径) 的对应关系固定下来，再把 audio_entries move 进 manifest。
        let audio_pairs: Vec<(PathBuf, String)> = audio_paths
            .iter()
            .zip(audio_entries.iter())
            .map(|(path, entry)| (path.clone(), entry.path.clone()))
            .collect();

        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            created_at: chrono::Local::now().to_rfc3339(),
            database: ManifestFile {
                source_path: None,
                path: DB_ENTRY.to_string(),
                size: db_size,
                sha256: file_sha256(&db_snapshot)?,
            },
            audio: audio_entries,
        };
        let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

        // 3) 写归档：magic + manifest + 数据库 + 音频。
        let mut out = File::create(archive_path)
            .map_err(|e| format!("无法创建备份文件 {:?}: {}", archive_path, e))?;
        out.write_all(MAGIC).map_err(|e| e.to_string())?;
        write_u32(&mut out, manifest_json.len() as u32)?;
        write_sha(&mut out, &manifest_json)?;
        out.write_all(&manifest_json).map_err(|e| e.to_string())?;

        // 数据库
        let db_bytes = fs::read(&db_snapshot).map_err(|e| e.to_string())?;
        write_file_entry(&mut out, DB_ENTRY, &db_bytes)?;

        // 音频
        for (path, entry_path) in &audio_pairs {
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            write_file_entry(&mut out, entry_path, &bytes)?;
        }
        out.sync_all().map_err(|e| e.to_string())?;

        Ok(BackupOutcome {
            archive_path: archive_path.to_string_lossy().to_string(),
            audio_count,
            database_bytes: db_size,
        })
    })();

    fs::remove_dir_all(&work).ok();
    result
}

fn write_file_entry<W: Write>(w: &mut W, name: &str, data: &[u8]) -> Result<(), String> {
    let name_bytes = name.as_bytes();
    write_u32(w, name_bytes.len() as u32)?;
    w.write_all(name_bytes).map_err(|e| e.to_string())?;
    write_u64(w, data.len() as u64)?;
    write_sha(w, data)?;
    w.write_all(data).map_err(|e| e.to_string())?;
    Ok(())
}

struct ParsedArchive {
    manifest: BackupManifest,
    /// (包内路径, 数据) 列表，按归档顺序。
    files: Vec<(String, Vec<u8>)>,
}

fn read_archive(path: &Path) -> Result<ParsedArchive, String> {
    use std::io::{Seek, SeekFrom};
    let mut file = File::open(path).map_err(|e| format!("无法打开备份文件: {e}"))?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if length > 1024 * 1024 * 1024 { return Err("单个备份包上限为 1 GiB，请分批备份".into()); }
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)
        .map_err(|e| format!("备份文件损坏（文件头不完整）: {e}"))?;
    if &magic != MAGIC {
        return Err("不是有效的声文备份文件（文件头不匹配）".to_string());
    }
    let manifest_len = read_u32(&mut file)? as usize;
    if manifest_len > 16 * 1024 * 1024 { return Err("备份清单过大".into()); }
    let manifest_sha = read_sha(&mut file)?;
    let mut manifest_json = vec![0u8; manifest_len];
    file.read_exact(&mut manifest_json)
        .map_err(|e| format!("备份文件损坏（清单不完整）: {e}"))?;
    if sha256(&manifest_json) != manifest_sha {
        return Err("备份清单校验值不匹配，文件可能已损坏".to_string());
    }
    let manifest: BackupManifest =
        serde_json::from_slice(&manifest_json).map_err(|e| format!("备份清单解析失败: {e}"))?;

    let mut files = Vec::new();
    loop {
        if file.seek(SeekFrom::Current(0)).map_err(|e| e.to_string())? == length { break; }
        let name_len = read_u32(&mut file)? as usize;
        if name_len > 4096 { return Err("备份文件名过长".into()); }
        let mut name_bytes = vec![0u8; name_len];
        file.read_exact(&mut name_bytes)
            .map_err(|e| format!("备份文件损坏（文件名不完整）: {e}"))?;
        let name = String::from_utf8_lossy(&name_bytes).to_string();
        if !safe_entry(&name) || files.iter().any(|(n, _)| n == &name) { return Err("非法或重复备份路径".into()); }
        let data_len = read_u64(&mut file)? as usize;
        let data_sha = read_sha(&mut file)?;
        if data_len as u64 > length.saturating_sub(file.stream_position().map_err(|e| e.to_string())?) { return Err("备份条目长度越界".into()); }
        let mut data = vec![0u8; data_len];
        file.read_exact(&mut data)
            .map_err(|e| format!("备份文件损坏（文件数据不完整）: {e}"))?;
        if sha256(&data) != data_sha {
            return Err(format!("备份文件损坏：{} 校验值不匹配", name));
        }
        files.push((name, data));
    }

    if manifest.format_version != BACKUP_FORMAT_VERSION || manifest.database.path != DB_ENTRY { return Err("不支持的备份清单".into()); }
    let mut listed = std::collections::HashSet::new();
    for entry in std::iter::once(&manifest.database).chain(manifest.audio.iter()) {
        if !listed.insert(&entry.path) || !safe_entry(&entry.path) { return Err("清单路径非法或重复".into()); }
        if entry.path != DB_ENTRY && (!entry.path.starts_with("audio/") || entry.path.matches('/').count() != 1) { return Err("音频路径非法".into()); }
        let (_, bytes) = files.iter().find(|(n, _)| n == &entry.path).ok_or("备份条目缺失")?;
        if bytes.len() as u64 != entry.size || sha256(bytes) != entry.sha256 { return Err("备份内容与清单不符".into()); }
    }
    if files.len() != listed.len() { return Err("备份包含未声明条目".into()); }
    Ok(ParsedArchive { manifest, files })
}

/// 校验备份包并返回预览信息。任何校验失败都返回 Err，调用方不得继续恢复。
pub fn validate_backup(archive_path: &Path, audio_dir: &Path) -> Result<RestorePreview, String> {
    if !archive_path.is_file() {
        return Err(format!("备份文件不存在: {:?}", archive_path));
    }
    let archive = read_archive(archive_path)?;
    let manifest = &archive.manifest;

    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(format!(
            "不支持的备份格式版本 {}（当前支持 {}）",
            manifest.format_version, BACKUP_FORMAT_VERSION
        ));
    }

    // 数据库条目存在、大小与校验值匹配（read_archive 已校验每个文件的 SHA）。
    let db = archive
        .files
        .iter()
        .find(|(name, _)| name == &manifest.database.path)
        .ok_or_else(|| "备份包中缺少数据库文件".to_string())?;
    if db.1.len() as u64 != manifest.database.size {
        return Err("数据库大小与清单不符，备份可能已损坏".to_string());
    }

    // 每个音频条目存在、大小匹配。
    for audio in &manifest.audio {
        let entry = archive
            .files
            .iter()
            .find(|(name, _)| name == &audio.path)
            .ok_or_else(|| format!("备份包中缺少音频文件 {}", audio.path))?;
        if entry.1.len() as u64 != audio.size {
            return Err(format!("音频 {} 大小与清单不符", audio.path));
        }
    }

    // 数据库可打开且结构完整。
    let work = std::env::temp_dir().join(format!("sound-to-essay-restore-check-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let check_result = (|| -> Result<(), String> {
        let db_tmp = work.join(DB_ENTRY);
        fs::write(&db_tmp, &db.1).map_err(|e| e.to_string())?;
        Library::validate_backup_db(&db_tmp)
    })();
    fs::remove_dir_all(&work).ok();
    check_result?;

    let missing_locally = manifest
        .audio
        .iter()
        .filter(|audio| {
            let name = audio.path.strip_prefix(&format!("{}/", AUDIO_DIR)).unwrap_or(&audio.path);
            !audio_dir.join(name).exists()
        })
        .count();

    Ok(RestorePreview {
        format_version: manifest.format_version,
        created_at: manifest.created_at.clone(),
        app_version: manifest.app_version.clone(),
        audio_count: manifest.audio.len(),
        database_bytes: manifest.database.size,
        audio_missing_locally: missing_locally,
    })
}

/// 恢复备份：替换当前数据库与音频。调用前必须先 `validate_backup` 并让用户确认。
/// `current_db_backup_path`：恢复前把当前数据库复制到该路径，作为"后悔药"。
pub fn restore_backup(
    library: &Library,
    audio_dir: &Path,
    archive_path: &Path,
    current_db_backup_path: &Path,
) -> Result<RestoreOutcome, String> {
    let archive = read_archive(archive_path)?;
    let manifest = &archive.manifest;

    // 1) 取出数据库与音频（read_archive 已逐文件校验 SHA）。
    let db = archive
        .files
        .iter()
        .find(|(name, _)| name == &manifest.database.path)
        .ok_or_else(|| "备份包中缺少数据库文件".to_string())?;
    if db.1.len() as u64 != manifest.database.size {
        return Err("数据库大小与清单不符".to_string());
    }

    let mut audio_files: Vec<(&ManifestFile, &[u8])> = Vec::new();
    for audio in &manifest.audio {
        let entry = archive
            .files
            .iter()
            .find(|(name, _)| name == &audio.path)
            .ok_or_else(|| format!("备份包中缺少音频 {}", audio.path))?;
        if entry.1.len() as u64 != audio.size {
            return Err(format!("音频 {} 大小与清单不符", audio.path));
        }
        audio_files.push((audio, &entry.1));
    }

    // 先准备独立目录；不覆盖现有音频。只有所有文件和路径均就绪后才提交数据库。
    let staging = audio_dir.join(format!("restore-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let prepared = staging.join(DB_ENTRY);
    let result = (|| -> Result<(), String> {
        fs::write(&prepared, &db.1).map_err(|e| e.to_string())?;
        Library::validate_backup_db(&prepared)?;
        let mut source = rusqlite::Connection::open(&prepared).map_err(|e| e.to_string())?;
        let tx = source.transaction().map_err(|e| e.to_string())?;
        for (audio, data) in &audio_files {
            let name = audio.path.strip_prefix("audio/").ok_or("音频路径非法")?;
            let target = staging.join(name);
            let mut output = File::create(&target).map_err(|e| e.to_string())?;
            output.write_all(data).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
            let original = audio.source_path.as_deref().ok_or("此旧备份未记录音频来源路径，不能安全恢复；请使用新版重新备份")?;
            for sql in ["UPDATE audio_assets SET file_path=?1 WHERE file_path=?2", "UPDATE transcription_tasks SET audio_path=?1 WHERE audio_path=?2"] {
                tx.execute(sql, rusqlite::params![target.to_string_lossy(), original]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        library.backup_to(current_db_backup_path)?;
        let mut target = rusqlite::Connection::open(library.db_path()).map_err(|e| e.to_string())?;
        let backup = rusqlite::backup::Backup::new(&source, &mut target).map_err(|e| e.to_string())?;
        backup.run_to_completion(64, std::time::Duration::from_millis(10), None).map_err(|e| e.to_string())?;
        Ok(())
    })();
    // 失败时保留准备目录，避免极端提交错误后误删可能已被引用的文件。
    result?;
    fs::remove_file(&prepared).ok();

    Ok(RestoreOutcome {
        audio_restored: audio_files.len(),
        database_replaced: true,
    })
}
