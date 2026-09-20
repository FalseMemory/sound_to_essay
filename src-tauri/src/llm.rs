use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// Maximum time to wait for a single LLM response before giving up.
const REQUEST_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMConfig {
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub max_tokens: i32,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: i32,
    temperature: f32,
}

/// Call OpenAI-compatible chat completion API
pub async fn chat_completion(
    config: &LLMConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let base_url = config.base_url.trim_end_matches('/');
    let url = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else {
        format!("{}/chat/completions", base_url)
    };

    let body = ChatRequest {
        model: config.model_name.clone(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            },
        ],
        max_tokens: config.max_tokens,
        temperature: 0.7,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let mut req = client.post(&url).json(&body);

    if !config.api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key));
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("请求超时（超过 {} 秒），已停止生成", REQUEST_TIMEOUT_SECS)
        } else {
            format!("请求失败: {}", e)
        }
    })?;
    let status = resp.status();

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 ({}): {}", status, text));
    }

    let data: Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;

    if let Some(err) = data.get("error") {
        return Err(format!("API 错误: {:?}", err));
    }

    extract_chat_content(&data).ok_or_else(|| format!("API 返回内容为空: {}", data))
}

fn extract_chat_content(data: &Value) -> Option<String> {
    let choice = data.get("choices")?.as_array()?.first()?;
    let candidates = [
        choice.pointer("/message/content"),
        choice.pointer("/message/reasoning_content"),
        choice.pointer("/delta/content"),
        choice.get("text"),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(text) = candidate.as_str().map(str::trim).filter(|s| !s.is_empty()) {
            return Some(text.to_string());
        }
    }

    None
}

/// Test connection by sending a simple message
pub async fn test_connection(config: &LLMConfig) -> Result<String, String> {
    chat_completion(config, "You are a helpful assistant.", "Say 'OK' only.").await
}

/// Shared constraints for all oral-history processing to prevent hallucination.
const BASE_CONSTRAINTS: &str = r#"核心约束（必须遵守）：
1. 不虚构任何事实。
2. 不擅自补充日期、地点、人物关系和对话。
3. 无法确定的信息保留不确定性，使用"大约""可能""我记得"等表达。
4. 发现素材中存在矛盾时，提出问题而不是自行选择某一说法。
5. 输出可以被用户逐段修改和确认。
6. 只输出处理后的文本，不要添加任何说明、总结或元评论。"#;

/// 文本整理的两档策略：
/// - `faithful`（校订·保真）：仅修正错别字/语病，**保留**口述者的语气词、方言、口头禅与
///   自然停顿，最大程度还原口述原貌；不虚构、不文学化。
/// - `creative`（文学化改写·创作）：允许润色、删减冗余、文学化重组以增强可读性；
///   输出被明确标记为"创作性结果"，而非原始事实记录。
pub fn tier_is_creative(tier: &str) -> bool {
    tier == "creative"
}

pub async fn process_text(
    config: &LLMConfig,
    processing_type: &str,
    input_text: &str,
    tier: &str,
) -> Result<String, String> {
    if config.base_url.is_empty() || config.model_name.is_empty() {
        return Err("LLM 未配置：请先在设置中填写 API 地址和模型名称。".to_string());
    }

    let creative = tier_is_creative(tier);

    let (system_prompt, user_prompt) = match processing_type {
        "correct" => {
            // 校对永远是保真档：只改错字，绝不改动口述风格。
            let sys = format!("你是一个口述史文字校对助手。任务：修正明显的错别字、同音字和口语化误用，保持原句结构、原意与口述者的语气词、方言、口头禅不变，最小改动原则。\n\n{}", BASE_CONSTRAINTS);
            let usr = format!("请校对以下文本，只修正错字和明显语病，不要改写、不要删减口语特征、不要文学化：\n```\n{}\n```", input_text);
            (sys, usr)
        }
        "summarize" => {
            let sys = format!("你是一个口述史摘要助手。任务：将以下口述内容压缩成简洁的摘要，保留核心事件、关键细节和重要观点，删除重复和次要信息。\n\n{}", BASE_CONSTRAINTS);
            let usr = format!("请为以下口述内容撰写摘要：\n```\n{}\n```", input_text);
            (sys, usr)
        }
        "extract" => {
            let sys = format!("你是一个口述史信息提取助手。任务：从以下文本中提炼出\"时间\" \"地点\" \"人物\" \"事件\"四个要素，以清单形式列出。无法确定的信息标注为\"未提及\"或\"不确定\"。\n\n{}", BASE_CONSTRAINTS);
            let usr = format!("请从以下口述内容中提取事实要素：\n```\n{}\n```", input_text);
            (sys, usr)
        }
        "polish" => {
            if creative {
                // 创作档：按传统润色，删冗余、顺语序。
                let sys = format!("你是一个口述史编辑助手。任务：\n1. 按语义分成自然段落；\n2. 修正明显的错别字和同音字；\n3. 删除冗余语气词（嗯、啊、那个、就是、然后）以及不必要的重复；\n4. 轻微理顺不通顺的语序，保持原意不变，最小改动原则。\n\n{}", BASE_CONSTRAINTS);
                let usr = format!("请整理以下口述文本：\n```\n{}\n```", input_text);
                (sys, usr)
            } else {
                // 保真档：保留口述特征，只改错字。
                let sys = format!("你是一个口述史编辑助手，遵循「校订·保真」原则。任务：\n1. 按语义分成自然段落；\n2. 仅修正明显的错别字和同音字；\n3. **保留**口述者特有的语气词（嗯、啊、那个、然后等）、方言词汇、口头禅与自然停顿节奏，**不要删除**这些口语特征；\n4. 仅在明显不通顺时极轻微理顺语序，保持原意与口述风格不变。\n\n{}", BASE_CONSTRAINTS);
                let usr = format!("请整理以下口述文本，保留口述者的真实语气与口癖，只修正错别字：\n```\n{}\n```", input_text);
                (sys, usr)
            }
        }
        "rewrite" => {
            // 文学化改写天生属于创作档，始终标注为创作性结果。
            let sys = format!("你是一位文学编辑。任务：在保持核心事实不变的前提下，将口述文本进行文学化改写，增强画面感和可读性。\n\n⚠️ 重要提示：这是\"创作性改写\"结果，输出会在资料库中明确标记为文学创作，而非原始事实记录。\n\n{}", BASE_CONSTRAINTS);
            let usr = format!("请对以下口述内容进行文学化改写，增强叙事性和画面感，但不要编造核心事实：\n```\n{}\n```", input_text);
            (sys, usr)
        }
        _ => {
            return Err(format!("未知的处理类型: {}", processing_type));
        }
    };

    chat_completion(config, &system_prompt, &user_prompt).await
}