param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
& $Python -c "import sys, faster_whisper, av; print('Python:', sys.version); print('faster-whisper:', faster_whisper.__version__); print('PyAV:', av.__version__)"
if ($LASTEXITCODE -ne 0) { throw 'Python runtime check failed. Install dependencies from resources/python_stt/requirements.txt.' }
Write-Output 'Runtime imports passed. A downloaded model is still required for transcription.'
