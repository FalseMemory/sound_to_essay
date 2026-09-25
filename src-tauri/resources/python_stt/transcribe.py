"""
Transcribe audio file using faster-whisper.
Usage: python transcribe.py <audio_path> [model_size] [language] [custom_hotwords]

`custom_hotwords` 是用户自定义的热词（人名、地名、专业术语），空格分隔；
会与语言内置热词合并后传给模型，用于减少专有名词的识别错误。

Output: JSON with transcription results on stdout.
"""
import json
import math
import sys
import os
from pathlib import Path

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
# Use HuggingFace mirror for users in China
os.environ["HF_ENDPOINT"] = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def transcribe(
    audio_path: str,
    model_size: str = "base",
    language: str = "zh",
    custom_hotwords: str | None = None,
):
    from faster_whisper import WhisperModel

    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
    model_source = resolve_model_source(model_size)
    try:
        model = WhisperModel(model_source, device=device, compute_type=compute_type)
    except Exception as exc:
        endpoint = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")
        raise RuntimeError(
            f"Whisper 模型 '{model_size}' 不可用。未找到完整的本地模型，且无法从 {endpoint} 下载。"
            "请检查网络，或设置 WHISPER_MODEL_DIR 指向已下载的 faster-whisper 模型目录。"
            f" 原始错误: {exc}"
        ) from exc

    whisper_language = "zh" if language == "yue" else language
    initial_prompt = None
    hotwords = None
    if language == "zh":
        initial_prompt = "以下内容是普通话简体中文语音转写。请使用简体中文，不要使用繁体字。"
        hotwords = "普通话 简体中文"
    elif language == "yue":
        initial_prompt = "以下内容是粤语语音转写。请使用简体中文书面表达，不要使用繁体字。"
        hotwords = "粤语 广东话 简体中文"

    # 用户自定义热词合并：内置词打底，用户词补充，减少人名/地名/术语的识别错误。
    user_hotwords = (custom_hotwords or "").strip()
    if user_hotwords:
        hotwords = f"{hotwords} {user_hotwords}" if hotwords else user_hotwords

    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language=whisper_language,
        task="transcribe",
        initial_prompt=initial_prompt,
        hotwords=hotwords,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
        no_speech_threshold=0.6,
        hallucination_silence_threshold=2.0,
    )

    text_parts = []
    confidences = []

    for seg in segments:
        text_parts.append(seg.text.strip())
        confidences.append(seg.avg_logprob)

    full_text = " ".join(text_parts)
    if language in ("zh", "yue"):
        full_text = to_simplified(full_text)
    avg_logprob = sum(confidences) / len(confidences) if confidences else 0
    # faster-whisper exposes avg_logprob, which is negative and is not a
    # percentage. Store a bounded probability-like value for the UI.
    avg_confidence = math.exp(avg_logprob) if confidences else 0
    avg_confidence = max(0.0, min(1.0, avg_confidence))

    result = {
        "text": full_text,
        "confidence": round(avg_confidence, 4),
        "segments": len(text_parts),
        "language": language,
    }

    print(json.dumps(result, ensure_ascii=True))


def is_complete_model_dir(path: Path) -> bool:
    """Return whether *path* is a usable faster-whisper CTranslate2 model."""
    return (
        path.is_dir()
        and (path / "config.json").is_file()
        and (path / "model.bin").is_file()
        and (path / "tokenizer.json").is_file()
        and ((path / "vocabulary.txt").is_file() or (path / "vocabulary.json").is_file())
    )


def resolve_model_source(model_size: str) -> str:
    """Prefer an explicit or already-cached local CTranslate2 model."""
    requested = Path(model_size).expanduser()
    if is_complete_model_dir(requested):
        return str(requested)

    configured_root = os.environ.get("WHISPER_MODEL_DIR")
    if configured_root:
        configured = Path(configured_root).expanduser()
        # The application stores models as <models root>/<model name>.  Check
        # that first: the root exists but is not itself a usable model.
        for candidate in (configured / model_size, configured):
            if is_complete_model_dir(candidate):
                return str(candidate)

    cache_root = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface"))
    snapshots = cache_root / "hub" / f"models--Systran--faster-whisper-{model_size}" / "snapshots"
    if snapshots.is_dir():
        local_snapshots = [
            path for path in snapshots.iterdir() if is_complete_model_dir(path)
        ]
        if local_snapshots:
            return str(sorted(local_snapshots)[-1])

    raise FileNotFoundError(
        f"未找到已安装的 Whisper 模型 '{model_size}'。请先在应用设置中下载模型，"
        "应用不会在录音转写时自动下载模型。"
    )


def to_simplified(text: str) -> str:
    try:
        from opencc import OpenCC
        return OpenCC("t2s").convert(text)
    except Exception:
        table = str.maketrans({
            "臺": "台", "灣": "湾", "國": "国", "語": "语", "識": "识", "錄": "录", "轉": "转",
            "體": "体", "簡": "简", "聽": "听", "聲": "声", "說": "说", "話": "话", "這": "这",
            "個": "个", "麼": "么", "為": "为", "來": "来", "們": "们", "會": "会", "應": "应",
            "後": "后", "裏": "里", "裡": "里", "時": "时", "間": "间", "點": "点", "開": "开",
            "關": "关", "現": "现", "實": "实", "驗": "验", "學": "学", "習": "习", "寫": "写",
            "讀": "读", "與": "与", "過": "过", "還": "还", "對": "对", "錯": "错", "無": "无",
            "發": "发", "萬": "万", "長": "长", "專": "专", "業": "业", "頁": "页", "項": "项",
            "產": "产", "廣": "广", "東": "东", "員": "员", "機": "机", "動": "动", "測": "测",
            "試": "试", "網": "网", "電": "电", "腦": "脑", "軟": "软", "件": "件", "數": "数",
        })
        return text.translate(table)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python transcribe.py <audio_path> [model_size] [language] [custom_hotwords]"}, ensure_ascii=True))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    language = sys.argv[3] if len(sys.argv) > 3 else "zh"
    custom_hotwords = sys.argv[4] if len(sys.argv) > 4 else None

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}, ensure_ascii=True))
        sys.exit(1)

    try:
        transcribe(audio_path, model_size, language, custom_hotwords)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
