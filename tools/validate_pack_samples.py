"""
Validate the sample packs in tools/pack_samples/ against the pack protocol.

Checks:
  - sample_pack.svpack: parses, manifest/records/audio SHA-256 all match.
  - corrupt_checksum.svpack: audio SHA-256 mismatch detected.
  - unsupported_version.svpack: formatVersion=999 rejected.
  - missing_audio.svpack: record references audio not present in pack.

Usage: python tools/validate_pack_samples.py
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from make_pack_samples import sha256, MAGIC  # noqa: E402

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), "pack_samples")
SUPPORTED_VERSION = 1


def parse_pack(path):
    with open(path, "rb") as f:
        magic = f.read(8)
        if magic != MAGIC:
            raise ValueError("bad magic")
        manifest_len = struct.unpack("<I", f.read(4))[0]
        manifest_sha = f.read(32).hex()
        manifest_json = f.read(manifest_len)
        if sha256(manifest_json) != manifest_sha:
            raise ValueError("manifest checksum mismatch")
        manifest = json.loads(manifest_json.decode("utf-8"))
        files = {}
        while True:
            len_bytes = f.read(4)
            if len(len_bytes) < 4:
                break
            name_len = struct.unpack("<I", len_bytes)[0]
            name = f.read(name_len).decode("utf-8")
            data_len = struct.unpack("<Q", f.read(8))[0]
            data_sha = f.read(32).hex()
            data = f.read(data_len)
            if sha256(data) != data_sha:
                raise ValueError(f"file checksum mismatch: {name}")
            files[name] = data
    return manifest, files


def check_sample_pack():
    manifest, files = parse_pack(os.path.join(SAMPLES_DIR, "sample_pack.svpack"))
    assert manifest["formatVersion"] == SUPPORTED_VERSION, "version"
    assert manifest["recordCount"] == 2, "recordCount"
    records = json.loads(files["records.json"].decode("utf-8"))
    assert len(records) == 2, "records length"
    for audio in manifest["audio"]:
        assert audio["path"] in files, f"missing audio entry {audio['path']}"
        assert len(files[audio["path"]]) == audio["size"], "audio size"
    # Verify record-level audio sha matches manifest audio sha.
    for record in records:
        for ra in record["audio"]:
            manifest_audio = next((a for a in manifest["audio"] if a["assetId"] == ra["assetId"]), None)
            assert manifest_audio is not None, f"asset {ra['assetId']} not in manifest"
            assert ra["sha256"] == manifest_audio["sha256"], "record/manifest sha mismatch"
    print("PASS sample_pack.svpack")


def check_corrupt_checksum():
    """Manifest declares a tampered SHA-256 for the audio; importer must catch
    the manifest-vs-actual mismatch (parse itself only checks entry integrity)."""
    manifest, files = parse_pack(os.path.join(SAMPLES_DIR, "corrupt_checksum.svpack"))
    for audio in manifest["audio"]:
        actual = sha256(files[audio["path"]])
        assert actual != audio["sha256"], "tampered manifest sha should differ from actual"
    print("PASS corrupt_checksum.svpack (manifest audio sha tampered, importer must reject)")


def check_unsupported_version():
    manifest, _ = parse_pack(os.path.join(SAMPLES_DIR, "unsupported_version.svpack"))
    assert manifest["formatVersion"] == 999, "expected version 999"
    # The importer would reject here; parsing succeeds but version gate triggers.
    print("PASS unsupported_version.svpack (formatVersion=999, would be rejected by importer)")


def check_missing_audio():
    manifest, files = parse_pack(os.path.join(SAMPLES_DIR, "missing_audio.svpack"))
    for audio in manifest["audio"]:
        assert audio["path"] not in files, f"audio {audio['path']} unexpectedly present"
    print("PASS missing_audio.svpack (referenced audio absent from pack)")


def main():
    check_sample_pack()
    check_corrupt_checksum()
    check_unsupported_version()
    check_missing_audio()
    print("\nAll sample pack validations passed.")


if __name__ == "__main__":
    main()
