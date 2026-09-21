"""
Probe an audio file: container/codec, duration, sample rate, channel count.

Usage: python audio_probe.py <audio_path>

Output: JSON on stdout with keys:
  - format: container/codec string (e.g. "wav", "m4a"/"aac", "mp3", "ogg")
  - duration_secs: float or null
  - sample_rate: int or null
  - channels: int or null
  - error: string or null
"""
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def _sniff(path: str) -> str:
    """Best-effort container detection from file extension + header bytes.

    覆盖常见录音来源：手机语音备忘录(m4a)、浏览器录音(webm/ogg)、微信语音(amr/silk)、
    Windows 录音(wma)、录音笔(wav/mp3/flac) 等。判不出来的交给扩展名，
    再不行返回 "unknown" —— 不编造一个看起来合理的格式。
    """
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    header_map = {
        b"OggS": "ogg",
        b"fLaC": "flac",
        b"ID3": "mp3",
        b"\x1aE\xdf\xa3": "webm",  # EBML：webm / mkv
        b"#!AMR": "amr",
        b"0&\xb2u": "wma",  # ASF 头
        b"caff": "caf",
        b"FORM": "aiff",
        b".snd": "au",
        b"MAC ": "ape",
    }
    with open(path, "rb") as handle:
        head = handle.read(16)

    # RIFF 是通用容器，必须看子类型才知道是不是音频
    if head.startswith(b"RIFF"):
        if head[8:12] == b"WAVE":
            return "wav"
        # 少数录音笔写成 RIFF 但没有标准 WAVE 标记，退回扩展名判断
        return ext if ext in ("wav", "wave") else (ext or "unknown")

    for magic, name in header_map.items():
        if head.startswith(magic):
            return name

    # M4A/AAC: no fixed magic; rely on extension or the ftyp box at offset 4.
    if len(head) >= 8 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand.startswith(b"M4B"):
            return "m4b"
        if brand.startswith(b"3gp"):
            return "3gp"
        return "m4a"
    if ext in ("m4a", "aac", "mp4", "m4b", "3gp", "3gpp"):
        return "3gp" if ext in ("3gp", "3gpp") else "m4a"

    # 裸 MPEG 帧同步（没有 ID3 标签的 mp3）
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return "mp3"

    return ext or "unknown"


def probe_with_ffprobe(path: str) -> dict:
    import subprocess

    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration:stream=codec_type,codec_name,sample_rate,channels",
            "-of", "json",
            path,
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败: {result.stderr.strip()}")
    data = json.loads(result.stdout or "{}")
    duration = None
    try:
        duration = float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    sample_rate = None
    channels = None
    codec = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio":
            codec = stream.get("codec_name")
            try:
                sample_rate = int(stream.get("sample_rate"))
            except (TypeError, ValueError):
                sample_rate = None
            try:
                channels = int(stream.get("channels"))
            except (TypeError, ValueError):
                channels = None
            break
    return {
        "format": codec or _sniff(path),
        "duration_secs": duration,
        "sample_rate": sample_rate,
        "channels": channels,
    }


def probe_with_soundfile(path: str) -> dict:
    import soundfile as sf

    info = sf.info(path)
    fmt = {
        "WAV": "wav", "FLAC": "flac", "OGG": "ogg", "AIFF": "aiff",
    }.get(getattr(info, "format", "") or "", _sniff(path))
    return {
        "format": fmt,
        "duration_secs": float(info.duration) if info.duration else None,
        "sample_rate": int(info.samplerate) if info.samplerate else None,
        "channels": int(info.channels) if info.channels else None,
    }


def probe_with_mutagen(path: str) -> dict:
    import mutagen

    audio = mutagen.File(path)
    if audio is None:
        raise RuntimeError("mutagen 无法识别该文件")
    duration = getattr(audio.info, "length", None)
    sample_rate = getattr(audio.info, "sample_rate", None)
    channels = getattr(audio.info, "channels", None)
    return {
        "format": _sniff(path),
        "duration_secs": float(duration) if duration else None,
        "sample_rate": int(sample_rate) if sample_rate else None,
        "channels": int(channels) if channels else None,
    }


def probe_with_av(path: str) -> dict:
    import av
    with av.open(path) as source:
        if not source.streams.audio:
            raise RuntimeError('文件没有音频流')
        stream = source.streams.audio[0]
        samples = 0
        rate = None
        channels = None
        for frame in source.decode(stream):
            samples += frame.samples
            rate = frame.sample_rate
            channels = len(frame.layout.channels)
        if not samples or not rate:
            raise RuntimeError('文件没有可解码音频')
        # 用归一化的格式名（_sniff），而不是 PyAV 的容器名。
        # PyAV 对 mp4 会给出 "mov,mp4,m4a,3gp,3g2,mj2" 这种容器串，
        # 写进 source_format 会污染数据、也会在界面上显示成一大段。
        sniffed = _sniff(path)
        return {'format': sniffed if sniffed != 'unknown' else source.format.name,
                'duration_secs': samples / rate,
                'sample_rate': rate, 'channels': channels}


def probe(path: str) -> dict:
    errors = []
    for fn in (probe_with_av, probe_with_ffprobe, probe_with_soundfile, probe_with_mutagen):
        try:
            result = fn(path)
            result.setdefault("format", _sniff(path))
            return result
        except FileNotFoundError:
            # ffprobe 等可执行文件不存在时尝试下一个后端。
            errors.append(f"{fn.__name__}: 工具未安装")
            continue
        except ImportError:
            errors.append(f"{fn.__name__}: 依赖未安装")
            continue
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fn.__name__}: {exc}")
            continue
    # 全部失败：至少返回基于文件头的格式探测，时长/采样率留空。
    return {
        "format": _sniff(path),
        "duration_secs": None,
        "sample_rate": None,
        "channels": None,
        "error": "; ".join(errors) or "无法探测时长/采样率",
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python audio_probe.py <audio_path>"}, ensure_ascii=True))
        sys.exit(1)
    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"文件不存在: {audio_path}"}, ensure_ascii=True))
        sys.exit(1)
    outcome = probe(audio_path)
    outcome.setdefault("error", None)
    print(json.dumps(outcome, ensure_ascii=True))
