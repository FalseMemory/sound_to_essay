#Requires -Version 5.1
<#
.SYNOPSIS
    声文 Voice to Essay —— 一键安装依赖并启动开发环境（Windows）
.DESCRIPTION
    该脚本会自动完成以下事情：
      1. 检查前置依赖：Node.js / Rust(cargo) / Python
      2. 确保 python_stt/.venv 虚拟环境存在并安装 faster-whisper
      3. 确保前端 node_modules 已安装
      4. 运行 npm run tauri dev 启动桌面应用
    适用于 Windows PowerShell（推荐）或 PowerShell 7+。
.EXAMPLE
    # 在文件资源管理器地址栏输入 powershell 后回车，再执行：
    .\start.ps1
    # 若被执行策略拦截，用下面这种方式绕过：
    powershell -ExecutionPolicy Bypass -File .\start.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

function Assert-Command {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "未找到命令 '$Name'。`n$hint"
    }
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  声文 Voice to Essay —— 启动脚本 (Windows)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. 前置依赖检查
Write-Host "`n[1/4] 检查前置依赖..." -ForegroundColor Yellow
Assert-Command node    "请安装 Node.js LTS (https://nodejs.org)，安装时勾选 'Add to PATH'。"
Assert-Command cargo   "请安装 Rust (https://rustup.rs)；Windows 需配套 MSVC 生成工具与 WebView2 运行时，详见安装教程。"
Assert-Command python  "请安装 Python 3.10+ (https://www.python.org)，安装时务必勾选 'Add to PATH'。"

# C 语言构建工具链（Tauri 链接桌面程序必需）
# 缺失时 `npm run tauri dev` 只会把前端跑起来、不弹桌面窗口，
# 浏览器里还会报 "Cannot read properties of undefined (reading 'invoke')"。
$vsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msvcPath = $null
if (Test-Path $vsWhere) {
    $msvcPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
}
if (-not $msvcPath) {
    Write-Host "    未检测到 MSVC C++ 生成工具。" -ForegroundColor Red
    Write-Host "    Tauri 需要它来链接出桌面程序；缺失时只能启动浏览器页面，不会弹出应用窗口。" -ForegroundColor Red
    Write-Host "    请以管理员身份执行下面的命令安装（约 2-4 GB）：" -ForegroundColor Yellow
    Write-Host '      winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' -ForegroundColor Gray
    Write-Host "    安装完成后请重开终端再运行本脚本。" -ForegroundColor Yellow
    throw "缺少 MSVC C++ 生成工具，无法编译桌面应用。"
}
Write-Host "    已检测到 MSVC: $msvcPath" -ForegroundColor Green
# Python 启动器兜底
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { $pythonCmd = "py -3" } else { $pythonCmd = "python" }
} else { $pythonCmd = "python" }

# 2. Python 虚拟环境 + faster-whisper
Write-Host "`n[2/4] 准备 Python 虚拟环境 (python_stt/.venv)..." -ForegroundColor Yellow
$venvPython = Join-Path $root "python_stt/.venv/Scripts/python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "    未检测到虚拟环境，正在创建..."
    & $pythonCmd -m venv python_stt/.venv
    if (-not (Test-Path $venvPython)) { throw "创建 Python 虚拟环境失败，请检查 Python 安装。" }
}
Write-Host "    升级 pip（可选，失败不影响）并安装 faster-whisper..."
& $venvPython -m pip install --upgrade pip *> $null
if ($LASTEXITCODE -ne 0) { Write-Warning "pip 升级失败，将跳过（不影响后续安装）。" }
& $venvPython -m pip install -r python_stt/requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip 安装依赖失败（requirements.txt）。" }
Write-Host "    Python 环境就绪。" -ForegroundColor Green

# 3. 前端依赖
Write-Host "`n[3/4] 检查前端依赖 (node_modules)..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "    未检测到 node_modules，正在安装..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
} else {
    Write-Host "    node_modules 已存在，跳过。"
}

# 4. 启动
Write-Host "`n[4/4] 启动开发环境 (npm run tauri dev)..." -ForegroundColor Green
Write-Host "    首次编译 Rust 可能耗时数分钟，请耐心等待窗口弹出。`n" -ForegroundColor DarkGray
npm run tauri dev
if ($LASTEXITCODE -ne 0) { throw "应用启动失败，请查看上方报错。" }
