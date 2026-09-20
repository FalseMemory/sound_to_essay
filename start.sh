#!/usr/bin/env bash
# 声文 Voice to Essay —— 一键安装依赖并启动开发环境（Git Bash / WSL / Linux / macOS）
#
# 该脚本会自动完成：
#   1. 检查前置依赖：Node.js / Rust(cargo) / Python
#   2. 确保 python_stt/.venv 虚拟环境存在并安装 faster-whisper
#   3. 确保前端 node_modules 已安装
#   4. 运行 npm run tauri dev 启动桌面应用
#
# 用法：
#   ./start.sh
# Windows 用户也可在 Git Bash 中直接运行本脚本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "=================================================="
echo "  声文 Voice to Essay —— 启动脚本"
echo "=================================================="

# 1. 前置依赖检查
echo -e "\n[1/4] 检查前置依赖..."
command -v node  >/dev/null 2>&1 || { echo "错误: 未找到 node，请安装 Node.js LTS (https://nodejs.org)"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "错误: 未找到 cargo，请安装 Rust (https://rustup.rs)"; exit 1; }

PY=(python)
if ! command -v python >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then PY=(python3); else echo "错误: 未找到 python，请安装 Python 3.10+"; exit 1; fi
fi

# 2. Python 虚拟环境 + faster-whisper
echo -e "\n[2/4] 准备 Python 虚拟环境 (python_stt/.venv)..."
if [ -x "python_stt/.venv/Scripts/python.exe" ]; then
  VENV_PY="python_stt/.venv/Scripts/python.exe"
elif [ -x "python_stt/.venv/bin/python" ]; then
  VENV_PY="python_stt/.venv/bin/python"
elif [ -x "python_stt/.venv/bin/python3" ]; then
  VENV_PY="python_stt/.venv/bin/python3"
else
  echo "    未检测到虚拟环境，正在创建..."
  "${PY[@]}" -m venv python_stt/.venv
  if [ -x "python_stt/.venv/Scripts/python.exe" ]; then
    VENV_PY="python_stt/.venv/Scripts/python.exe"
  else
    VENV_PY="python_stt/.venv/bin/python"
  fi
fi
echo "    使用解释器: $VENV_PY"
"$VENV_PY" -m pip install --upgrade pip || echo "提示: pip 升级失败（可忽略）"
"$VENV_PY" -m pip install -r python_stt/requirements.txt

# 3. 前端依赖
echo -e "\n[3/4] 检查前端依赖 (node_modules)..."
if [ ! -d node_modules ]; then
  echo "    未检测到 node_modules，正在安装..."
  npm install
else
  echo "    node_modules 已存在，跳过。"
fi

# 4. 启动
echo -e "\n[4/4] 启动开发环境 (npm run tauri dev)..."
echo -e "    首次编译 Rust 可能耗时数分钟，请耐心等待窗口弹出。\n"
npm run tauri dev
