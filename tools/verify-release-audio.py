"""Verify copied release scripts outside the source working directory, with synthetic audio."""
import argparse
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import wave
import av

parser = argparse.ArgumentParser()
parser.add_argument('release_dir', type=Path)
parser.add_argument('--model-dir', type=Path)
args = parser.parse_args()
scripts = args.release_dir.resolve() / 'resources' / 'python_stt'
with tempfile.TemporaryDirectory(prefix='shengwen-release-audio-') as temp:
    root = Path(temp)
    wav = root / 'synthetic.wav'
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b''.join(struct.pack('<h', int(1000 * math.sin(i * 440 * 2 * math.pi / 16000))) for i in range(32000)))
    m4a = root / 'synthetic.m4a'
    with av.open(str(wav)) as source, av.open(str(m4a), 'w') as output:
        stream = output.add_stream('aac', rate=16000)
        stream.layout = 'mono'
        for frame in source.decode(audio=0):
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode(None):
            output.mux(packet)
    def run(script, *arguments):
        result = subprocess.run([sys.executable, str(scripts / script), *map(str, arguments)], cwd=root, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        data = json.loads(result.stdout)
        assert not data.get('error'), data
        return data
    for audio in (wav, m4a):
        probe = run('audio_probe.py', audio)
        assert probe['duration_secs'] > 1.5, probe
        print('PASS probe', audio.suffix)
    converted = root / 'derived.wav'
    run('convert_audio.py', m4a, converted)
    assert converted.is_file() and m4a.is_file()
    assert run('audio_probe.py', converted)['duration_secs'] > 1.5
    print('PASS M4A conversion with original retained; cwd outside repository')
    if args.model_dir:
        environment = {**os.environ, 'WHISPER_MODEL_DIR': str(args.model_dir.resolve()), 'HF_HUB_OFFLINE': '1'}
        outcome = subprocess.run([sys.executable, str(scripts / 'transcribe.py'), str(m4a), 'tiny', 'zh'],
                                 cwd=root, env=environment, capture_output=True, text=True, timeout=120)
        if outcome.returncode:
            raise RuntimeError(outcome.stderr)
        transcript = json.loads(outcome.stdout)
        assert not transcript.get('error'), transcript
        print('PASS offline transcription runtime on synthetic M4A (not a speech-accuracy test)')
