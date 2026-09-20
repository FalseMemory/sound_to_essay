# 声文（Voice to Essay）

> Windows 本地优先的口述史资料库：长期保存声音、原始转写与可追溯的文字版本，逐步整理为回忆录。

Windows 桌面应用。它既保留旧的“录音后整理/创作”工作区，也提供资料库入口：每段口述可作为独立记忆保存、检索、校订和反复整理。

## 手机记录端（2026-09-19 验收更新）

iPhone 优先的本地网页记录端已补充 PWA 离线缓存、录音恢复保护及 `.svpack` 文件交换。手机负责记录，Windows 负责转写和整理；无账号、无资料上传和自动云同步。

- 构建：`node tools/build-mobile.mjs`，只把生成的 `dist-mobile` 部署到固定的可信 HTTPS 地址，入口 `mobile.html`；不要上传整个工程。
- 测试进展：TypeScript、Vite、Rust 13 项测试、浏览器合成录音与离线重开通过；iPhone 真机与 Windows 完整流程仍待验收。
- Windows 发布版仍需要外部 Python（faster-whisper、PyAV）和已下载模型，不是完全独立运行包。
- 详细修复、限制、发布说明与手动步骤见 [本轮验收记录](docs/验收与复核.md)。

---

## 目录

- [快速开始（推荐）](#快速开始推荐)
- [技术栈](#技术栈)
- [当前需求与产品约束](#当前需求与产品约束)
- [已完成阶段](#已完成阶段)
- [后续开发计划](#后续开发计划)
- [功能特性](#功能特性)
- [项目结构](#项目结构)
- [环境准备与安装](#环境准备与安装)
- [运行方式](#运行方式)
- [构建打包](#构建打包)
- [配置说明](#配置说明)
- [核心流程](#核心流程)
- [Rust 后端模块说明](#rust-后端模块说明)
- [Python STT 说明](#python-stt-说明)
- [前端组件说明](#前端组件说明)
- [IPC 命令列表](#ipc-命令列表)
- [数据格式](#数据格式)
- [已知问题与注意事项](#已知问题与注意事项)
- [开发指南](#开发指南)

---

## 快速开始（推荐）

不想看长文档，直接从这里开始：

```powershell
# Windows（PowerShell，在项目根目录）
.\start.ps1
# 若被执行策略拦截：
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

```bash
# Git Bash / WSL / Linux / macOS
./start.sh
```

这两个脚本会**自动**检查 `node` / `cargo` / `python`，创建并配置 `python_stt/.venv`（含 faster-whisper），确保 `node_modules`，再执行 `npm run tauri dev` 拉起应用。可反复运行（幂等）。

窗口弹出后，先到「设置」页下载一个 Whisper 模型即可开始口述。完整环境要求、手动安装步骤、常见问题与打包命令见 **[`docs/安装与启动.md`](docs/安装与启动.md)**。

---

## 当前需求与产品约束

本项目的目标不是通用语音聊天，而是个人长期口述史与回忆录资料库。

- **Windows 单机、本地优先**：不建立服务器、账号体系或云同步。
- **用户掌控数据**：录音默认保存到程序根目录的 `sounds/`，不会按时间自动删除；模型默认位于 `models/`；资料库数据库位于 `data/oral_history.sqlite3`。
- **原始素材不可覆盖**：原始 WAV 和原始转写在后续人工编辑、AI 整理、版本恢复时均保留不变。
- **AI 可选且可追溯**：支持本地 Ollama 或用户自行填写的 OpenAI-compatible API。未配置 API Key 时不应发起远程请求；后续 AI 输出必须记录输入版本、提供商和模型。
- **先检索、再创作**：未来章节生成只能基于用户选定并确认的记忆来源，不能让模型自行编造完整人生脉络。
- **兼容旧项目**：既有 `.vse` 工作区继续可用。首次迁移到资料库时，源文件保留，并在同目录创建 `.vse.backup`。

## 已完成阶段

### 阶段 0：基线修复与安全护栏

- 自动保存旧工作区；原始转写与人工编辑文本分离。
- faster-whisper 模型下载、目录选择、下载进度与本地模型校验。
- 录音保存到 `sounds/`；设置页未保存退出时可选择保存或放弃。
- 全局快捷键支持注册与更新；若系统已有程序占用快捷键，会给出警告。

### 阶段 1：SQLite 数据层与旧数据迁移

- 使用 `rusqlite` bundled SQLite 建立 `data/oral_history.sqlite3`。
- 已有 `projects`、`memories`、`audio_assets`、`text_versions`、`tags`、`people` 及关联表，并建立 FTS5 索引。
- 记忆支持标题、录音时间、事件模糊时间、地点、人物、标签、备注、状态与软删除。
- 文字版本保留来源版本、处理类型、LLM 提供商和模型；支持恢复为新的当前版本。
- 旧 `.vse` 可幂等导入，音频路径失效时文字资料仍可访问。

### 阶段 2：资料库界面与日常积累

- 顶部“资料库”入口，可创建资料库项目、记忆条目，或直接录音、转写并保存为记忆。
- 支持关键词搜索、按状态和时间筛选、人物/标签/地点检索、时间顺序浏览。
- 记忆详情显示原始音频播放、当前工作文本、版本历史和元数据。
- 旧工作区仍保留；“清理未引用录音”只会删除 `sounds/` 中未被任一旧项目或资料库记忆引用的 WAV。

### 阶段 2.5：章节、草稿与回忆录结构（已实现）

在资料库基础上，已落地回忆录的章节化组织与 AI 初稿能力：

- 创建 / 重排 / 删除章节；同一记忆可加入多个章节，不复制原始素材。
- 章节详情（`get_chapter_with_drafts`）聚合关联记忆、草稿与来源，确保“先检索、再创作”。
- 基于章节关联记忆生成 AI 草稿（`ai_generate_chapter_draft`），支持自定义写作风格；生成前校验素材来源，不编造人生脉络。
- 章节草稿保存为带类型的版本（手动 / AI），可查看历史与恢复。
- 人物、标签、地点独立索引与检索（`list_all_people` / `list_all_tags` / `list_all_locations`）。
- Whisper 模型管理：浏览、下载（含取消 / 续传）、删除本地模型。

## 后续开发计划

基础能力（章节、草稿、AI 初稿、人物 / 标签 / 地点浏览、Markdown 导出、Whisper 模型管理）已经可用；以下阶段聚焦更深的可追溯整理、关联验证与作品级编辑。

每个阶段均遵循：实现 → 自动检查/构建/测试/运行时冒烟测试 → 用户手测 → 确认后再进入下一阶段。

### 阶段 3：可重复整理与版本管理

目标：同一段经历可以多次整理，所有结果均可追溯和回退。

- 支持单条或多条记忆的“口语校订、事实整理、摘要、主题提炼、文学化草稿”等处理。
- 每次 AI 处理生成独立版本，记录来源记忆和输入版本 ID；支持版本差异比较与恢复。
- AI 提示词约束：不虚构事实、不补全不确定日期/关系/对话；素材矛盾时提出问题。
- 远程调用前显示提供商和模型；无 API Key 不发出远程请求；完善失败、超时、取消处理。

### 阶段 4：经历串联与回忆录结构

目标：从独立记忆中建立经人物、地点、主题和时间验证过的关联。

- 人生时间线、人物页、地点页、主题页和“可能相关记忆”候选。
- AI 仅在检索到候选素材后解释关联依据；用户确认后才建立正式关联。
- 创建章节、调整章节顺序、将同一记忆加入多个章节但不复制原始素材。
- 章节草稿必须显示来源记忆；素材矛盾必须可见，不能由模型静默裁决。

### 阶段 5：回忆录编辑器与导出

目标：将资料库组织为持续可编辑的完整作品。

- 章节树、提纲、章节摘要、正文版本和章节来源列表。
- 事实锁定与文学化创作两种模式；章节级重写、压缩、扩写、润色。
- 优先导出 Markdown；随后再增加 Word、PDF，并可选择是否附带来源信息和时间线注释。

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面框架 | Tauri | 2.11.2 |
| 前端 | React + TypeScript + Tailwind CSS v4 | React 19, TS 6, Tailwind 4.3 |
| 状态管理 | Zustand | 5.0 |
| 构建工具 | Vite | 8.x |
| 语言转写 | Python faster-whisper | 1.x |
| 音频采集 | cpal | 0.15 |
| WAV 写入 | hound | 3.5 |
| LLM 请求 | reqwest (Rust async) | 0.12 |
| 本地资料库 | rusqlite（bundled SQLite + FTS5） | 0.32 |
| 运行平台 | Windows 仅支持 | — |

---

## 功能特性

### 录音与转写
- 点击按钮或全局快捷键（默认 `Ctrl+Alt+R`）开始/停止录音
- 自动使用麦克风设备原生采样率和通道数录制
- 多声道自动混音为单声道；支持 F32/I16/U16 三种采样格式
- 录音保存为 WAV 文件，默认存入程序根目录的 `sounds/`，永久保留直到用户手动清理
- 转写使用 Python faster-whisper，支持三种语言：
  - `zh` — 普通话简体中文
  - `en` — 英语
  - `yue` — 粤语（内部映射为 `zh`，附带粤语 prompt）
- 繁体输出自动转简体（opencc 优先，手动映射表兜底）
- VAD 过滤 + 幻觉静音阈值，减少无意义重复
- 模型可选（tiny/base/small/medium），默认 `base`，默认 CPU int8 推理

### AI 整理与散文生成
- **AI 整理**：将口语化转写文本自动分段、去冗余、修错字、理顺语序
- **散文生成**：支持 8 种内置风格 + 自定义风格 prompt + 字数滑块
- 两种 LLM 配置可独立设置（整理用小模型，生成用大模型）
- 支持任何 OpenAI 兼容 API（Ollama / vLLM / SiliconFlow / OpenAI 等）
- 后端请求超时 180 秒；前端 200 秒兜底超时 + 进度计时显示
- 整理和生成可独立触发，互不依赖

### 项目管理
- 旧工作区项目以 `.vse` JSON 文件存储在 `%APPDATA%/com.voice-to-essay.app/projects/`，继续兼容
- 长期资料库使用 `data/oral_history.sqlite3`，存储项目、记忆、音频资产、文本版本、人物和标签
- 首次启动发现旧 `.vse` 时会备份为 `.vse.backup` 后导入资料库；原文件不会被覆盖
- 自动记忆上次打开的项目（`last_project_id.txt`）
- 支持新建、打开、保存、删除、导出 Markdown
- 点击「添加到创作区」可将生成的散文追加为新的创作段落
- 右下角实时显示保存状态和字数统计

### 界面
- 深色主题，单窗口三栏布局（左：创作区 | 中：整理区 | 右：设置）
- 设置页按功能分组：快捷键、模型路径、普通话模型、粤语模型、LLM（整理）、LLM（生成）
- 模型路径自动检测 `.venv` 和系统 Python，优先使用虚拟环境
- 录音时按钮变红，停止时有「正在停止...」中间状态，转写时显示已用秒数
- 启动时自动加载上次项目；无历史时显示空白工作区
- “资料库”视图支持日常录入、关键词检索、元数据编辑、音频播放和版本恢复

---

## 项目结构

```
F:\AI\sound_to_essay\
├── index.html                          # Vite 入口 HTML
├── package.json                        # 前端依赖与脚本
├── vite.config.ts                      # Vite 配置（端口 5173）
├── tsconfig.json / tsconfig.app.json   # TypeScript 配置
├── eslint.config.js                    # ESLint 配置
│
├── src/                                # 前端源码（React + TypeScript）
│   ├── main.tsx                        # React 入口
│   ├── App.tsx                         # 主应用（布局、路由、项目管理、录音/转写/整理/生成流程）
│   ├── index.css                       # 全局 CSS（暗色主题变量、.control 统一样式）
│   ├── components/
│   │   ├── LibraryView.tsx              # 资料库主视图（记忆、搜索、音频、版本、章节与草稿）
│   │   ├── RecordingPanel.tsx          # 录音面板（录音/转写状态机、已转写段落列表）
│   │   ├── CreationEditor.tsx          # 左侧创作区（段落展示、编辑、删除）
│   │   ├── PolishView.tsx              # 中间整理区（原文 vs 整理结果对比、手动编辑、进度计时）
│   │   ├── EssayView.tsx              # 散文展示（添加到创作区、复制、导出 Markdown）
│   │   ├── StyleSelector.tsx          # 8 种风格胶囊选择器、自定义 prompt、生成弹窗 + 进度
│   │   └── SettingsPage.tsx           # 设置页（分组卡片、语言切换胶囊按钮、LLM 连接测试）
│   ├── stores/
│   │   ├── projectStore.ts            # Zustand 项目状态（clips、polishedText、essayText、各 loading 状态）
│   │   └── settingsStore.ts           # Zustand 设置状态（加载/保存 config.json）
│   └── types/
│       └── index.ts                   # 全局类型定义
│
├── src-tauri/                          # Rust 后端
│   ├── Cargo.toml                     # Rust 依赖
│   ├── tauri.conf.json                # Tauri 配置（窗口、打包、插件权限）
│   ├── build.rs                       # Tauri 构建脚本
│   ├── src/
│   │   ├── main.rs                    # 入口（release 隐藏控制台窗口）
│   │   ├── lib.rs                     # Tauri setup + IPC 命令注册
│   │   ├── library.rs                 # SQLite 资料库、FTS、版本、旧项目迁移
│   │   ├── recorder.rs                # 音频采集（cpal）、多声道混音、WAV 写入
│   │   ├── stt.rs                     # Python 子进程桥接、查找虚拟环境
│   │   ├── llm.rs                     # OpenAI 兼容 API 客户端、多字段响应解析、超时
│   │   ├── project.rs                 # .vse 项目文件 CRUD、last_project_id.txt
│   │   └── hotkey.rs                  # 全局快捷键解析、注册与更新
│   └── capabilities/
│       └── default.json               # Tauri 权限声明
│
├── python_stt/                         # Python STT 脚本
│   ├── transcribe.py                  # faster-whisper 转写脚本（zh/en/yue、VAD、繁转简）
│   ├── requirements.txt               # faster-whisper>=1.1.0,<2.0.0
│   └── .venv/                         # Python 虚拟环境（已创建、已安装 faster-whisper、模型已下载）
│
├── public/
│   ├── favicon.svg
│   └── icons.svg
│
├── sounds/                             # 原始 WAV 录音（默认永久保留）
├── models/                             # faster-whisper 模型目录
└── data/
    └── oral_history.sqlite3            # 本地口述史资料库
```

---

## 环境准备与安装

### 必需环境

| 软件 | 版本要求 | 用途 |
|---|---|---|
| Node.js | 18+ | 前端构建 |
| Python | 3.10+ | STT 转写 |
| Rust | 1.77.2+（MSVC 工具链） | 后端编译 |
| Visual Studio Build Tools | 2022，带「C++ 桌面开发」工作负载 | 提供 MSVC 编译器 |
| Whisper 模型 | 在设置页由用户选择并下载到本地目录 | 转写用 |

### 1. 前端依赖

```bash
cd F:\AI\sound_to_essay
npm install
```

### 2. Python 环境

虚拟环境已创建并配置好，位于 `python_stt/.venv/`。Whisper 模型由设置页管理并下载到用户选择的本地目录，不依赖录音时的隐式下载：

```bash
cd F:\AI\sound_to_essay\python_stt
.venv\Scripts\activate
pip install -r requirements.txt
```

如果虚拟环境不存在，手动重建：

```bash
cd F:\AI\sound_to_essay\python_stt
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

模型不会在录音转写时自动下载。默认下载到程序主目录的 `models/<模型名>/`（例如 `models/tiny/`）；请先在设置页下载模型。也可以设置 `WHISPER_MODEL_DIR` 指向模型根目录或一个完整的 faster-whisper 模型目录。

### 3. Rust 环境

安装 Rust（MSVC 工具链）：

```bash
winget install Rustlang.Rustup
```

确认使用 MSVC 工具链：

```bash
rustup default stable-msvc
```

如需加速 crate 下载，配置 USTC 镜像（`~/.cargo/config.toml`）：

```toml
[source.crates-io]
replace-with = "ustc"

[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
```

---

## 运行方式

```bash
cd F:\AI\sound_to_essay
npm run tauri dev
```

> 一键方式：仓库根目录提供了 `start.ps1`（Windows PowerShell）与 `start.sh`（Git Bash / Linux / macOS），会自动检查依赖、安装 Python 虚拟环境与 faster-whisper、确保 node_modules，再执行上面的命令。详见 [`docs/安装与启动.md`](docs/安装与启动.md)。

`npm run tauri dev` 会：
1. 编译 Rust 后端（首次较慢，需耐心等待窗口弹出）
2. 启动 Vite 开发服务器
3. 打开桌面窗口

注意：`tauri dev` 本身**不会**安装 Python 依赖。请先运行上面的启动脚本，或按「环境准备与安装」手动配置 `python_stt/.venv`。

应用启动后自动加载上次打开的项目。若无历史项目，则显示空白工作区。

---

## 构建打包

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`，包含：
- `.exe` 安装包（NSIS）
- `.msi` 安装包
- 便携版可执行文件

---

## 配置说明

### LLM 配置

在应用内「设置」页面配置，支持两套独立 LLM：

| 字段 | 说明 | 示例（Ollama） | 示例（SiliconFlow） |
|---|---|---|---|
| Base URL | API 地址 | `http://localhost:11434` | `https://api.siliconflow.cn/v1` |
| API Key | 认证密钥 | 留空 | `sk-xxx` |
| 模型名 | 模型标识 | `qwen2.5:7b` | `deepseek-ai/DeepSeek-V4-Pro` |
| 最大 Token | 生成上限 | `4096` | `4096` |

URL 自动兼容三种格式：
- `http://localhost:11434` → 自动补全为 `.../chat/completions`
- `http://localhost:11434/v1` → 自动补全
- `http://localhost:11434/v1/chat/completions` → 直接使用

支持的响应字段（自动尝试）：`choices[0].message.content` → `reasoning_content` → `delta.content` → `text`

### STT 配置

| 字段 | 说明 | 可选值 |
|---|---|---|
| 语言 | 转写语言 | 普通话 / English / 粤语 |
| 模型大小 | whisper 模型 | tiny / base / small / medium |
| 推理设备 | 运行环境 | cpu（默认）/ cuda |
| 计算精度 | 推理精度 | int8（默认）/ float16 / float32 |

环境变量可通过系统设置覆盖：
- `WHISPER_DEVICE=cuda` — 使用 GPU
- `WHISPER_COMPUTE_TYPE=float16` — GPU 精度
- `HF_ENDPOINT=https://hf-mirror.com` — HuggingFace 镜像
- `WHISPER_MODEL_DIR=D:\models` — 使用已下载模型的根目录（例如 `D:\models\base`）；也可直接指向单个完整模型目录

### 快捷键

默认全局快捷键：`Ctrl+Alt+R`（开始/停止录音）
格式：修饰键+按键，如 `Ctrl+Alt+R`、`Ctrl+Shift+S`

### 原始录音清理

原始录音默认永久保留在 `sounds/`，应用不会按时间自动删除。旧工作区的“清理未引用录音”按钮只会删除未被任何 `.vse` 项目或资料库音频资产引用的 WAV 文件；清理前会要求确认。

---

## 核心流程

```
用户点击录音
    │
    ▼
start_recording → cpal 开始采集音频（设备原生采样率，多声道混音为单声道）
    │
    ▼
用户点击停止
    │
    ▼
stop_recording → 写入 WAV → 返回 audioPath + durationSecs
    │
    ▼
transcribe_audio(audio_path, model_size, language)
    │   → Python 子进程执行 transcribe.py
    │   → faster-whisper 转写（VAD + 幻觉抑制 + 繁转简）
    │   → 返回 text + confidence
    │
    ▼
段落列表显示转写结果（支持手动编辑/删除）
    │
    ├──► AI 整理（ai_polish）→ 原文 vs 整理结果对比 → 确认/重新整理
    │
    └──► 生成散文（generate_essay）→ 选择风格 + 字数 → 弹窗编辑 → 添加到创作区 / 导出
```

---

## Rust 后端模块说明

### `recorder.rs` — 音频采集

- 使用 `cpal` 库打开系统默认输入设备
- 录制参数完全跟随设备默认配置（不做 16kHz 强制转换）
- `PREFERRED_RATE`（16000）仅作为 `actual_sample_rate` 的初始值
- 采集回调中自动将多声道混音为单声道
- 支持 F32 / I16 / U16 三种采样格式
- 使用 `LEAKED_STREAM` 静态变量保持 Stream 存活（cpal Stream 不实现 Send）
- 停止后以设备原生采样率写入 WAV

### `stt.rs` — Python 转写桥接

- 启动 Python 子进程执行 `transcribe.py`
- 自动在 `python_stt/.venv/` 查找虚拟环境 Python
- 设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONUTF8=1` 确保编码正确
- 通过 stdout JSON 获取转写结果

### `llm.rs` — LLM 客户端

- `reqwest` 异步 HTTP 请求，超时 180 秒
- URL 自动补全 `/chat/completions`
- 支持 `Authorization: Bearer` 头
- 多字段响应解析：`message.content` → `reasoning_content` → `delta.content` → `text`
- 超时返回明确中文提示

### `project.rs` — 项目持久化

- 项目存储目录：`%APPDATA%/com.voice-to-essay.app/projects/`
- 文件格式：`{project_id}.vse`（JSON）
- `last_project_id.txt` 记录上次打开的项目
- `VoiceClip` 字段带 `#[serde(default)]`，兼容旧数据缺少 `audioPath` / `confidence`

### `lib.rs` — 命令注册

- 58 个 Tauri 命令，全部通过 `tauri::generate_handler!` 注册
- `AppState` 持有 `Mutex<Recorder>`、`audio_dir`、`app_data_dir`
- 所有 Rust IPC 结构体统一使用 `#[serde(rename_all = "camelCase")]`

---

## Python STT 说明

### `transcribe.py`

用法：`python transcribe.py <audio_path> [model_size] [language]`

支持语言：
- `zh` — 普通话简体中文，附带 `initial_prompt` + `hotwords` 提高识别率
- `en` — 英语
- `yue` — 粤语（传入 whisper 时映射为 `zh`，附带粤语专用 prompt）

关键参数：
- `beam_size=5`
- `condition_on_previous_text=False` — 防止幻觉累积
- `vad_filter=True` — 自动静音过滤
- `hallucination_silence_threshold=2.0` — 幻觉后静音阈值（秒）
- `no_speech_threshold=0.6`

输出格式（JSON）：
```json
{
  "text": "转写文本...",
  "confidence": -0.2345,
  "segments": 12,
  "language": "zh"
}
```

繁转简逻辑：优先使用 `opencc`（`t2s` 模式），若未安装则使用手动映射表（覆盖 70+ 常见繁体字）。

---

## 前端组件说明

### `App.tsx` — 主应用

- 管理全局状态：项目加载/保存、录音流程、整理/生成
- 三栏布局：左（CreationEditor）| 中（PolishView）| 右（SettingsPage / StyleSelector）
- 顶栏：项目名称 + 「保存」「打开」「新建」「导出」+ AI 初步整理 + 生成散文按钮
- `normalizeProject()` — 数据迁移：确保旧数据补全新字段
- 录音流程：`start_recording` → `is_recording`（每 300ms 轮询）→ `stop_recording` → `transcribe_audio`
- 「生成散文」按钮独立于整理流程，有录音段落即可触发
- `handlePolish` 带 200 秒前端超时保护

### `RecordingPanel.tsx` — 录音面板

- 状态机：idle → recording → stopping → transcribing → idle
- `stopping` 状态在停止按钮和新状态之间插入，避免 UI 闪烁
- 已转写段落列表显示序号、时间、字数、置信度
- 双击可编辑转写文本，回车保存
- 录音中显示红色脉冲圆点 + 振幅模拟
- 转写中显示已用秒数计时

### `PolishView.tsx` — 整理区

- 点击「开始整理」触发，整理中显示旋转图标 + 已用秒数
- 整理完成后显示原文 vs 整理结果左右对比
- 整理结果可通过 textarea 手动编辑
- 「确认结果」保存编辑后的文本；「重新整理」清空重来
- 带 200 秒前端超时

### `EssayView.tsx` — 散文展示

- 展示生成的散文（支持 Markdown 渲染）
- 「添加到创作区」— 将散文作为新段落追加到左侧创作区
- 「复制」— 复制到剪贴板
- 「导出 Markdown」— 调用 `export_file` 保存为 `.md`

### `StyleSelector.tsx` — 风格选择与生成

- 8 种内置风格胶囊按钮（纪实、文艺、哲理、诗意、日记、叙事、学术、简洁）
- 支持自定义风格描述（textarea 输入）
- 字数滑块（200-3000，步长 100）
- 弹窗编辑生成结果
- 生成中显示旋转图标 + 已用秒数 + 后端状态提示
- 带 200 秒前端超时

### `SettingsPage.tsx` — 设置页

- 分组卡片布局：快捷键 / 模型路径 / 语言设置 / LLM 配置（整理）/ LLM 配置（生成）
- 语言设置使用胶囊按钮切换（普通话 / English / 粤语）
- 模型路径自动检测 `.venv` 和系统 Python
- LLM 连接测试按钮（调用 `test_llm_connection`）
- 所有输入框使用统一的 `.control` CSS 类

### `index.css` — 全局样式

- CSS 变量定义暗色主题（`--bg-primary` ~ `--error`）
- `.control` 统一输入框样式（边框、圆角、聚焦高亮）
- `.animate-fade-in` 淡入动画
- 自定义滚动条样式
- 字体栈：`-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`

---

## IPC 命令列表

所有命令通过 `@tauri-apps/api/core` 的 `invoke()` 调用。Rust 端所有结构体使用 `camelCase` 序列化，前端参数也使用 `camelCase`。

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `start_recording` | — | `void` | 开始录音 |
| `stop_recording` | — | `{ audioPath, durationSecs }` | 停止录音，返回 WAV 路径和时长 |
| `is_recording` | — | `boolean` | 当前是否在录音 |
| `transcribe_audio` | `{ audioPath, modelSize, language, modelDir }` | `{ text, confidence }` | 使用已安装模型转写音频 |
| `get_default_whisper_model_dir` | — | `string` | 返回默认 Whisper 模型目录 |
| `list_whisper_models` | `{ modelDir? }` | `WhisperModelInfo[]` | 列出本地已下载模型及完整性 |
| `download_whisper_model` | `{ modelId, modelDir? }` | `void` | 下载指定模型（支持取消 / 续传） |
| `cancel_whisper_model_download` | `{ modelId }` | `void` | 取消正在进行的模型下载 |
| `delete_whisper_model` | `{ modelId, modelDir? }` | `void` | 删除本地模型 |

**AI 整理与生成**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `ai_polish` | `{ text, config }` | `string` | AI 整理文本 |
| `ai_process_memory` | `{ text, config }` | `string` | 记忆级 AI 处理（校订 / 摘要 / 提炼） |
| `generate_essay` | `{ text, stylePrompt, wordCount, config }` | `string` | AI 生成散文 |
| `test_llm_connection` | `{ config }` | `string` | 测试 LLM 连接 |
| `ai_generate_chapter_draft` | `{ chapterId, memoryIds, style, config }` | `ChapterDraft` | 依据章节关联记忆生成草稿 |

**旧项目工作区（.vse）**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `create_project` | `{ name }` | `Project` | 新建项目 |
| `save_project` | `{ project }` | `void` | 保存项目 |
| `load_project` | `{ projectId }` | `Project` | 加载项目 |
| `list_projects` | — | `ProjectListItem[]` | 列出所有项目 |
| `delete_project` | `{ projectId }` | `void` | 删除项目 |
| `load_last_project_id` | — | `string \| null` | 读取上次项目 ID |
| `save_last_project_id` | `{ projectId }` | `void` | 写入上次项目 ID |

**资料库项目与记忆**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `create_library_project` | `{ name }` | `LibraryProject` | 新建资料库项目 |
| `list_library_projects` | — | `LibraryProject[]` | 列出资料库项目 |
| `create_memory` | `{ input }` | `MemorySummary` | 新建记忆 |
| `list_memories` | `{ projectId?, includeDeleted? }` | `MemorySummary[]` | 列出 / 筛选记忆 |
| `get_memory` | `{ memoryId }` | `MemoryDetail \| null` | 记忆详情（含音频与版本） |
| `update_memory_metadata` | `{ input }` | `MemorySummary` | 保存标题、时间、地点、状态、备注 |
| `delete_memory` | `{ memoryId }` | `void` | 软删除记忆 |
| `restore_memory` | `{ memoryId }` | `void` | 恢复记忆 |
| `search_memories` | `{ query, projectId? }` | `MemorySummary[]` | 关键词 / 人物 / 地点 / 标签搜索 |
| `list_memories_by_filter` | `{ projectId, filterType, filterValue }` | `MemorySummary[]` | 按人物 / 标签 / 地点筛选 |
| `list_all_people` | `{ projectId }` | `string[]` | 全部人物 |
| `list_all_tags` | `{ projectId }` | `string[]` | 全部标签 |
| `list_all_locations` | `{ projectId }` | `string[]` | 全部地点 |

**文本版本**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `list_text_versions` | `{ memoryId }` | `TextVersion[]` | 版本列表 |
| `create_text_version` | `{ memoryId, content, versionType, processingType?, parentVersionId?, provider?, model? }` | `TextVersion` | 新建文本版本 |
| `restore_text_version` | `{ versionId }` | `TextVersion` | 恢复为当前版本 |
| `delete_text_version` | `{ versionId }` | `void` | 删除版本 |
| `set_memory_tags` | `{ memoryId, names }` | `void` | 维护标签关联 |
| `set_memory_people` | `{ memoryId, names }` | `void` | 维护人物关联 |

**章节与草稿**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `create_chapter` | `{ projectId, title }` | `Chapter` | 新建章节 |
| `list_chapters` | `{ projectId }` | `Chapter[]` | 列出章节 |
| `get_chapter` | `{ chapterId }` | `ChapterDetail \| null` | 章节详情（含关联记忆） |
| `update_chapter` | `{ chapterId, title?, sortOrder? }` | `Chapter` | 更新章节 |
| `delete_chapter` | `{ chapterId }` | `void` | 删除章节 |
| `get_chapter_with_drafts` | `{ chapterId }` | `ChapterWithDrafts \| null` | 章节 + 草稿 + 关联记忆 |
| `add_memory_to_chapter` | `{ chapterId, memoryId }` | `void` | 关联记忆到章节 |
| `remove_memory_from_chapter` | `{ chapterId, memoryId }` | `void` | 解除记忆关联 |
| `list_memory_chapters` | `{ memoryId }` | `Chapter[]` | 某记忆所属章节 |
| `create_chapter_draft` | `{ chapterId, content, draftType, processingType?, provider?, model? }` | `ChapterDraft` | 保存章节草稿 |
| `delete_chapter_draft` | `{ draftId }` | `void` | 删除草稿 |

**迁移、清理与文件**

| 命令 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `migrate_legacy_projects` | — | `MigrationReport` | 备份并迁移旧 `.vse` 项目 |
| `cleanup_unreferenced_audio` | — | `{ scanned, removed, retained }` | 清理 `sounds/` 中未被引用的 WAV |
| `cleanup_temp_audio` | `{ maxAgeHours }` | `number` | 清理过期临时音频 |
| `load_settings` | — | `string`（JSON） | 读取设置 |
| `save_settings` | `{ settings }`（JSON 字符串） | `void` | 保存设置 |
| `export_file` | `{ path, content }` | `void` | 导出文件到指定路径 |
| `read_audio_file` | `{ filePath }` | `string` | 读取音频文件（base64） |

---

## 数据格式

### VoiceClip（录音段落）

```typescript
interface VoiceClip {
  id: string;          // UUID
  timestamp: string;   // ISO 8601
  audioPath?: string;  // WAV 文件路径（可选）
  rawText: string;     // 转写文本
  durationSecs: number; // 录音时长（秒）
  confidence: number;  // 0-1 的界面置信度估计值
}
```

### ProjectData（项目）

```typescript
interface ProjectData {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  clips: VoiceClip[];
  polishedText: string; // AI 整理结果
  essayText: string;    // 生成的散文
}
```

### LLMConfig（LLM 配置）

```typescript
interface LLMConfig {
  baseUrl: string;     // API 地址
  apiKey: string;      // API 密钥（可为空）
  modelName: string;   // 模型名称
  maxTokens: number;   // 最大 Token 数
}
```

### AppSettings（应用设置）

```typescript
interface AppSettings {
  hotkey: string;           // 全局快捷键，如 'Ctrl+Alt+R'
  whisperModel: string;     // whisper 模型大小
  whisperLanguage: 'zh' | 'en' | 'yue';
  llm: {
    polish: LLMConfig;      // 整理用 LLM
    generate: LLMConfig;    // 生成用 LLM
  };
  tempAudioMaxAgeHours: number; // 旧设置兼容字段；原始录音默认不自动清理
}
```

### SQLite 资料库

资料库路径：`data/oral_history.sqlite3`

- `projects`：回忆录资料库项目。
- `memories`：独立记忆条目及其时间、地点、状态和备注。
- `audio_assets`：原始音频路径、时长、采样率。
- `text_versions`：原始转写、人工校订、AI 整理和后续草稿版本；每个派生版本可指向来源版本。
- `tags` / `people` 及关联表：主题与人物索引。
- `memory_fts`：FTS5 全文索引，用于关键词检索。

### 项目文件（.vse）

存储路径：`%APPDATA%/com.voice-to-essay.app/projects/{project_id}.vse`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "我的散文",
  "createdAt": "2025-01-01T00:00:00+08:00",
  "updatedAt": "2025-01-01T01:00:00+08:00",
  "clips": [
    {
      "id": "...",
      "timestamp": "...",
      "rawText": "今天天气真好...",
      "durationSecs": 12.5,
      "confidence": -0.2345
    }
  ],
  "polishedText": "今天天气真好，阳光明媚...",
  "essayText": "春日暖阳..."
}
```

---

## 已知问题与注意事项

1. **Windows 仅支持**：应用未适配 macOS/Linux，cpal 录音和路径处理均针对 Windows
2. **全局快捷键可能冲突**：默认 `Ctrl+Alt+R` 已注册；若被其他程序占用，应用会给出警告，请关闭占用程序或在设置中改用其他组合键
3. **无实时波形显示**：录音时仅有模拟动画，非真实音频振幅
4. **首次启动**：需确保 Python 虚拟环境已创建；首次转写前请先在设置页下载 Whisper 模型
5. **模型路径自动检测**：优先查找 `python_stt/.venv/`，找不到则使用系统 Python
6. **LLM 超时**：后端 180 秒 + 前端 200 秒双重保护；超时后需手动重试
7. **繁转简**：依赖 `opencc` 库，若未安装则使用手动映射表（覆盖约 70 个常见繁体字）
8. **Whisper 语言代码**：`zh` 对应普通话，`yue` 对应粤语（内部映射为 `zh` 并附加粤语 prompt）
9. **数据兼容**：`VoiceClip` 的 `audioPath` 和 `confidence` 字段带 `#[serde(default)]`，旧项目文件可正常加载
10. **Tauri 2.0 参数命名**：Rust 命令参数自动 camelCase 转换，前端调用时统一使用 camelCase

---

## 开发指南

### 常用命令

```bash
# 前端开发（单独启动 Vite）
npm run dev

# 启动完整桌面应用（开发模式）
npm run tauri dev

# 前端构建检查
npx tsc -b --noEmit
npx vite build

# Rust 构建
cd src-tauri && cargo build

# 完整打包
npm run tauri build
```

### 文件修改后验证

| 改动类型 | 验证命令 |
|---|---|
| TypeScript / React | `npx tsc -b --noEmit` + `npx vite build` |
| Rust 后端 | `cargo build`（需 VS Build Tools 环境） |
| Python STT | 在 `.venv` 环境中直接运行 `python python_stt/transcribe.py <wav文件>` |

### Rust 编译环境

每次新开终端需先加载 MSVC 环境：

```powershell
& "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
```

或使用自动化脚本：

```powershell
Get-Process -Name "app" -ErrorAction SilentlyContinue | Stop-Process -Force
$env:Path = "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build;$env:Path"
cmd /c """C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"" & set" |
  ForEach-Object { if ($_ -match '^(\w+)=(.*)') { Set-Item -Path "env:$($matches[1])" -Value "$($matches[2])" } }
cargo build
```

### 建议的开发流程

1. 前端改动 → `npx tsc -b --noEmit` + `npx vite build`
2. Rust 改动 → 加载 MSVC 环境后 `cargo build`
3. Python 改动 → 直接运行 `transcribe.py` 测试
4. 全量验证 → `npm run tauri dev`

### 注意事项

- Rust 项目使用 MSVC 工具链（非 GNU），需安装 Visual Studio Build Tools
- Cargo crates 使用 USTC 镜像加速下载（`~/.cargo/config.toml`）
- 模型管理器优先使用 HuggingFace 镜像，并在失败时回退到官方地址
- 所有 Rust IPC 结构体必须加 `#[serde(rename_all = "camelCase")]`
- Tauri 2.0 默认将 Rust 命令参数 snake_case 自动转为 camelCase，前端调用时统一使用 camelCase
- Zustand store 的 `isRecording` / `isTranscribing` / `isPolishing` / `isGenerating` 互斥控制
## Whisper 模型下载

应用参考开源项目 [Handy](https://github.com/cjpais/Handy) 的模型管理体验：模型下载显示状态和进度，支持取消、保留未完成文件并继续下载，完成后才会安装到目标目录。

当前语音识别引擎仍然是 Python `faster-whisper`，因此下载的是兼容它的 Hugging Face 模型仓库，而不是 Handy 使用的 GGML/GGUF 文件：

- `tiny`：约 75 MB，速度最快。
- `base`：约 145 MB，中文口述的默认推荐。
- `small`：约 465 MB，准确率更高。
- `medium`：约 1.5 GB，适合更重视准确率的长期口述史整理。

打开“设置 → Whisper 模型管理”后，可以选择模型存放文件夹、下载模型、取消下载、继续未完成下载、删除模型和选择当前使用的模型。应用不会在录音转写时隐式下载模型；没有已安装模型时，会提示先到设置页下载。

每个模型会安装为目标目录下的独立文件夹，并在安装前检查 `config.json`、`model.bin`、`tokenizer.json` 和词表文件是否完整。默认目录为 `%APPDATA%/com.voice-to-essay.app/models/`。
