"""
Convert an audio file to 16-bit PCM WAV (mono or stereo preserved) for playback
and transcription. Uses ffmpeg if available, otherwise soundfile.

Usage: python convert_audio.py <input_path> <output_path>

Output: JSON on stdout with keys: output_path, sample_rate, channels, duration_secs, error.
"""
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def convert_with_ffmpeg(input_path: str, output_path: str) -> dict:
    import subprocess

    result = subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            output_path,
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 转码失败: {result.stderr.strip()}")
    return _probe_output(output_path)


def convert_with_soundfile(input_path: str, output_path: str) -> dict:
    import soundfile as sf

    data, sample_rate = sf.read(input_path, always_2d=True)
    sf.write(output_path, data, sample_rate, subtype="PCM_16")
    return _probe_output(output_path)


def _probe_output(output_path: str) -> dict:
    """Read back the produced WAV to report its actual parameters."""
    try:
        import soundfile as sf
        info = sf.info(output_path)
        return {
            "output_path": output_path,
            "sample_rate": int(info.samplerate) if info.samplerate else None,
            "channels": int(info.channels) if info.channels else None,
            "duration_secs": float(info.duration) if info.duration else None,
        }
    except Exception:
        # soundfile 不可用时至少确认文件已生成。
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return {"output_path": output_path, "sample_rate": None, "channels": None, "duration_secs": None}
        raise RuntimeError("转码输出无效")


def convert_with_av(input_path: str, output_path: str) -> dict:
    import av
    import wave
    samples = 0
    with av.open(input_path) as source, wave.open(output_path, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
        for frame in source.decode(audio=0):
            for converted in resampler.resample(frame):
                output.writeframes(converted.to_ndarray().tobytes())
                samples += converted.samples
        for converted in resampler.resample(None):
            output.writeframes(converted.to_ndarray().tobytes())
            samples += converted.samples
    if not samples:
        raise RuntimeError('音频解码结果为空')
    return {'output_path': output_path, 'sample_rate': 16000, 'channels': 1, 'duration_secs': samples / 16000}


def convert(input_path: str, output_path: str) -> dict:
    if os.path.realpath(input_path) == os.path.realpath(output_path):
        raise ValueError('派生音频不能覆盖原文件')
    errors = []
    for fn in (convert_with_av, convert_with_ffmpeg, convert_with_soundfile):
        try:
            return fn(input_path, output_path)
        except FileNotFoundError:
            errors.append(f"{fn.__name__}: 工具未安装")
            continue
        except ImportError:
            errors.append(f"{fn.__name__}: 依赖未安装")
            continue
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fn.__name__}: {exc}")
            continue
    raise RuntimeError("; ".join(errors) or "没有可用的转码后端（ffmpeg / soundfile）")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python convert_audio.py <input> <output>"}, ensure_ascii=True))
        sys.exit(1)
    input_path, output_path = sys.argv[1], sys.argv[2]
    if not os.path.exists(input_path):
        print(json.dumps({"error": f"文件不存在: {input_path}"}, ensure_ascii=True))
        sys.exit(1)
    try:
        outcome = convert(input_path, output_path)
        outcome.setdefault("error", None)
        print(json.dumps(outcome, ensure_ascii=True))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=True))
        sys.exit(1)
