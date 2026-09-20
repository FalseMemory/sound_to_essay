use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceClip {
    pub id: String,
    pub timestamp: String,
    #[serde(default)]
    pub audio_path: Option<String>,
    pub raw_text: String,
    #[serde(default)]
    pub edited_text: Option<String>,
    pub duration_secs: f64,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    /// A1：片段的转写状态（pending/processing/success/failed）。
    /// 旧版 `.vse` 文件没有该字段，缺省为 None，视为已完成（保持原行为）。
    #[serde(default)]
    pub transcription_status: Option<String>,
    /// A1：转写失败原因，便于用户判断是缺模型、缺 Python 还是音频问题。
    #[serde(default)]
    pub transcription_error: Option<String>,
}

fn default_confidence() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    // 兼容旧版工作区项目文件（曾使用 snake_case 字段名，且可能缺字段）
    #[serde(default, alias = "created_at")]
    pub created_at: String,
    #[serde(default, alias = "updated_at")]
    pub updated_at: String,
    #[serde(default)]
    pub clips: Vec<VoiceClip>,
    #[serde(default, alias = "polished_text")]
    pub polished_text: String,
    #[serde(default, alias = "essay_text")]
    pub essay_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListItem {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub clip_count: usize,
}

pub fn projects_dir(app_data: &PathBuf) -> PathBuf {
    app_data.join("projects")
}

fn last_project_path(app_data: &PathBuf) -> PathBuf {
    app_data.join("last_project_id.txt")
}

pub fn list_projects(app_data: &PathBuf) -> Result<Vec<ProjectListItem>, String> {
    let dir = projects_dir(app_data);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().map_or(true, |e| e != "vse") {
            continue;
        }
        let content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        if let Ok(project) = serde_json::from_str::<Project>(&content) {
            items.push(ProjectListItem {
                id: project.id,
                name: project.name,
                updated_at: project.updated_at,
                clip_count: project.clips.len(),
            });
        }
    }

    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn load_project(app_data: &PathBuf, project_id: &str) -> Result<Project, String> {
    let path = projects_dir(app_data).join(format!("{}.vse", project_id));
    let content = fs::read_to_string(&path).map_err(|e| format!("读取项目失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析项目失败: {}", e))
}

pub fn save_project(app_data: &PathBuf, project: &Project) -> Result<(), String> {
    let dir = projects_dir(app_data);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.vse", project.id));
    let content = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("保存项目失败: {}", e))?;
    save_last_project_id(app_data, &project.id)
}

pub fn create_project(app_data: &PathBuf, name: &str) -> Result<Project, String> {
    let now = Local::now().to_rfc3339();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
        clips: Vec::new(),
        polished_text: String::new(),
        essay_text: String::new(),
    };
    save_project(app_data, &project)?;
    Ok(project)
}

pub fn delete_project(app_data: &PathBuf, project_id: &str) -> Result<(), String> {
    let path = projects_dir(app_data).join(format!("{}.vse", project_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if load_last_project_id(app_data)?.as_deref() == Some(project_id) {
        let last_path = last_project_path(app_data);
        if last_path.exists() {
            fs::remove_file(last_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn load_last_project_id(app_data: &PathBuf) -> Result<Option<String>, String> {
    let path = last_project_path(app_data);
    if !path.exists() {
        return Ok(None);
    }
    let project_id = fs::read_to_string(path).map_err(|e| format!("读取上次项目失败: {}", e))?;
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        Ok(None)
    } else {
        Ok(Some(project_id))
    }
}

pub fn save_last_project_id(app_data: &PathBuf, project_id: &str) -> Result<(), String> {
    fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
    fs::write(last_project_path(app_data), project_id).map_err(|e| format!("保存上次项目失败: {}", e))
}
