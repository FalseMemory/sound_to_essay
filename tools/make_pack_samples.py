"""
Generate test sample packs for the Sound-to-Essay Pack Protocol (B2).

Outputs to tools/pack_samples/:
  - sample_pack.svpack          minimal valid pack (2 records + 2 audio)
  - corrupt_checksum.svpack     audio SHA-256 tampered (integrity failure path)
  - unsupported_version.svpack  formatVersion=999 (version rejection path)
  - missing_audio.svpack        record references a non-existent audio file

All audio is synthesized (sine tones), all text is synthetic. No real oral
history material is used.

Usage: python tools/make_pack_samples.py
"""
import json
import math
import os
import struct
import uuid
import wave

OUT_DIR = os.path.join(os.path.dirname(__file__), "pack_samples")
MAGIC = b"SVPACK1\0"
FORMAT_VERSION = 1


def sha256(data: bytes) -> str:
    """Minimal SHA-256 (stdlib has no built-in)."""
    K = [
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
    ]
    h = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
         0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]

    bit_len = (len(data) * 8) & 0xFFFFFFFFFFFFFFFF
    msg = bytearray(data)
    msg.append(0x80)
    while len(msg) % 64 != 56:
        msg.append(0)
    msg += struct.pack(">Q", bit_len)

    for chunk_start in range(0, len(msg), 64):
        chunk = msg[chunk_start:chunk_start + 64]
        w = [0] * 64
        for i in range(16):
            w[i] = struct.unpack(">I", chunk[i * 4:i * 4 + 4])[0]
        for i in range(16, 64):
            s0 = ((w[i - 15] >> 7) | (w[i - 15] << 25)) & 0xFFFFFFFF
            s0 ^= ((w[i - 15] >> 18) | (w[i - 15] << 14)) & 0xFFFFFFFF
            s0 ^= (w[i - 15] >> 3)
            s1 = ((w[i - 2] >> 17) | (w[i - 2] << 15)) & 0xFFFFFFFF
            s1 ^= ((w[i - 2] >> 19) | (w[i - 2] << 13)) & 0xFFFFFFFF
            s1 ^= (w[i - 2] >> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF

        a, b, c, d, e, f, g, hh = h
        for i in range(64):
            s1 = ((e >> 6) | (e << 26)) & 0xFFFFFFFF
            s1 ^= ((e >> 11) | (e << 21)) & 0xFFFFFFFF
            s1 ^= ((e >> 25) | (e << 7)) & 0xFFFFFFFF
            ch = (e & f) ^ (~e & g)
            temp1 = (hh + s1 + ch + K[i] + w[i]) & 0xFFFFFFFF
            s0 = ((a >> 2) | (a << 30)) & 0xFFFFFFFF
            s0 ^= ((a >> 13) | (a << 19)) & 0xFFFFFFFF
            s0 ^= ((a >> 22) | (a << 10)) & 0xFFFFFFFF
            maj = (a & b) ^ (a & c) ^ (b & c)
            temp2 = (s0 + maj) & 0xFFFFFFFF
            hh, g, f, e, d, c, b, a = g, f, e, (d + temp1) & 0xFFFFFFFF, c, b, a, (temp1 + temp2) & 0xFFFFFFFF

        h = [(x + y) & 0xFFFFFFFF for x, y in zip(h, [a, b, c, d, e, f, g, hh])]

    return "".join(f"{word:08x}" for word in h)


def synth_wav_bytes(freq=440.0, duration_secs=1.0, sample_rate=16000, channels=1):
    """Generate a small synthetic sine-tone WAV in memory."""
    import io
    num_frames = int(sample_rate * duration_secs)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_frames):
            sample = int(32767 * 0.3 * math.sin(2 * math.pi * freq * i / sample_rate))
            for _ in range(channels):
                frames += struct.pack("<h", sample)
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def write_file_entry(out, name: str, data: bytes):
    name_bytes = name.encode("utf-8")
    out.write(struct.pack("<I", len(name_bytes)))
    out.write(name_bytes)
    out.write(struct.pack("<Q", len(data)))
    out.write(bytes.fromhex(sha256(data)))
    out.write(data)


def build_pack(path: str, manifest: dict, records_json: bytes, audio_files: list):
    """audio_files: list of (entry_name, data_bytes)."""
    manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    with open(path, "wb") as out:
        out.write(MAGIC)
        out.write(struct.pack("<I", len(manifest_json)))
        out.write(bytes.fromhex(sha256(manifest_json)))
        out.write(manifest_json)
        write_file_entry(out, "records.json", records_json)
        for name, data in audio_files:
            write_file_entry(out, name, data)


def make_sample_pack():
    asset1 = str(uuid.uuid4())
    asset2 = str(uuid.uuid4())
    audio1 = synth_wav_bytes(freq=440.0, duration_secs=1.2)
    audio2 = synth_wav_bytes(freq=660.0, duration_secs=0.8)

    records = [
        {
            "recordId": str(uuid.uuid4()),
            "revision": 1,
            "title": "样例记录一",
            "body": "这是合成的测试正文，用于验证素材包协议。",
            "recordedAt": "2026-09-17T10:00:00+08:00",
            "eventDateText": "2026年9月",
            "eventDatePrecision": "month",
            "people": ["测试人"],
            "location": "测试地点",
            "tags": ["样例"],
            "notes": "",
            "audio": [{
                "assetId": asset1,
                "originalFilename": "sample_001.wav",
                "sourceFormat": "wav",
                "durationSecs": 1.2,
                "sampleRate": 16000,
                "sha256": sha256(audio1),
            }],
        },
        {
            "recordId": str(uuid.uuid4()),
            "revision": 2,
            "title": "样例记录二",
            "body": "第二条合成记录，修订标识为 2。",
            "recordedAt": "2026-09-17T11:00:00+08:00",
            "eventDateText": None,
            "eventDatePrecision": "unknown",
            "people": [],
            "location": None,
            "tags": [],
            "notes": None,
            "audio": [{
                "assetId": asset2,
                "originalFilename": "sample_002.wav",
                "sourceFormat": "wav",
                "durationSecs": 0.8,
                "sampleRate": 16000,
                "sha256": sha256(audio2),
            }],
        },
    ]
    records_json = json.dumps(records, ensure_ascii=False, indent=2).encode("utf-8")

    manifest = {
        "formatVersion": FORMAT_VERSION,
        "packId": str(uuid.uuid4()),
        "appVersion": "0.1.0",
        "exportedAt": "2026-09-17T14:30:00+08:00",
        "recordCount": len(records),
        "audioCount": 2,
        "records": {"path": "records.json", "size": len(records_json), "sha256": sha256(records_json)},
        "audio": [
            {"assetId": asset1, "path": f"audio/{asset1}.wav", "format": "wav", "size": len(audio1), "sha256": sha256(audio1)},
            {"assetId": asset2, "path": f"audio/{asset2}.wav", "format": "wav", "size": len(audio2), "sha256": sha256(audio2)},
        ],
    }
    build_pack(
        os.path.join(OUT_DIR, "sample_pack.svpack"),
        manifest, records_json,
        [(f"audio/{asset1}.wav", audio1), (f"audio/{asset2}.wav", audio2)],
    )


def make_corrupt_checksum_pack():
    """Valid structure but one audio's SHA-256 in manifest doesn't match bytes."""
    asset = str(uuid.uuid4())
    audio = synth_wav_bytes(freq=500.0, duration_secs=0.5)
    records = [{
        "recordId": str(uuid.uuid4()), "revision": 1,
        "title": "损坏校验样例", "body": "音频校验值被篡改。",
        "recordedAt": "2026-09-17T12:00:00+08:00",
        "eventDateText": None, "eventDatePrecision": "unknown",
        "people": [], "location": None, "tags": [], "notes": None,
        "audio": [{
            "assetId": asset, "originalFilename": "corrupt.wav",
            "sourceFormat": "wav", "durationSecs": 0.5, "sampleRate": 16000,
            "sha256": "0" * 64,  # tampered
        }],
    }]
    records_json = json.dumps(records, ensure_ascii=False).encode("utf-8")
    manifest = {
        "formatVersion": FORMAT_VERSION,
        "packId": str(uuid.uuid4()),
        "appVersion": "0.1.0",
        "exportedAt": "2026-09-17T14:31:00+08:00",
        "recordCount": 1, "audioCount": 1,
        "records": {"path": "records.json", "size": len(records_json), "sha256": sha256(records_json)},
        "audio": [{"assetId": asset, "path": f"audio/{asset}.wav", "format": "wav",
                   "size": len(audio), "sha256": "0" * 64}],  # tampered
    }
    build_pack(
        os.path.join(OUT_DIR, "corrupt_checksum.svpack"),
        manifest, records_json, [(f"audio/{asset}.wav", audio)],
    )


def make_unsupported_version_pack():
    manifest = {
        "formatVersion": 999,
        "packId": str(uuid.uuid4()),
        "appVersion": "0.1.0",
        "exportedAt": "2026-09-17T14:32:00+08:00",
        "recordCount": 0, "audioCount": 0,
        "records": {"path": "records.json", "size": 2, "sha256": sha256(b"[]")},
        "audio": [],
    }
    build_pack(
        os.path.join(OUT_DIR, "unsupported_version.svpack"),
        manifest, b"[]", [],
    )


def make_missing_audio_pack():
    """Record references an audio file that is not present in the pack."""
    ghost_asset = str(uuid.uuid4())
    records = [{
        "recordId": str(uuid.uuid4()), "revision": 1,
        "title": "缺失音频样例", "body": "引用的音频文件不在包内。",
        "recordedAt": "2026-09-17T13:00:00+08:00",
        "eventDateText": None, "eventDatePrecision": "unknown",
        "people": [], "location": None, "tags": [], "notes": None,
        "audio": [{
            "assetId": ghost_asset, "originalFilename": "ghost.wav",
            "sourceFormat": "wav", "durationSecs": 1.0, "sampleRate": 16000,
            "sha256": "0" * 64,
        }],
    }]
    records_json = json.dumps(records, ensure_ascii=False).encode("utf-8")
    manifest = {
        "formatVersion": FORMAT_VERSION,
        "packId": str(uuid.uuid4()),
        "appVersion": "0.1.0",
        "exportedAt": "2026-09-17T14:33:00+08:00",
        "recordCount": 1, "audioCount": 1,
        "records": {"path": "records.json", "size": len(records_json), "sha256": sha256(records_json)},
        "audio": [{"assetId": ghost_asset, "path": f"audio/{ghost_asset}.wav", "format": "wav",
                   "size": 100, "sha256": "0" * 64}],
    }
    # Deliberately do NOT include the audio file entry.
    build_pack(
        os.path.join(OUT_DIR, "missing_audio.svpack"),
        manifest, records_json, [],
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    make_sample_pack()
    make_corrupt_checksum_pack()
    make_unsupported_version_pack()
    make_missing_audio_pack()
    print(f"Sample packs written to {OUT_DIR}")
    for name in sorted(os.listdir(OUT_DIR)):
        full = os.path.join(OUT_DIR, name)
        print(f"  {name}  ({os.path.getsize(full)} bytes)")


if __name__ == "__main__":
    main()
