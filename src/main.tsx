import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import App from './App.tsx'
import { useThemeStore } from './stores/themeStore'

// Apply the persisted theme before first paint to avoid a flash of the wrong theme.
document.documentElement.dataset.theme = useThemeStore.getState().theme

/**
 * 声文是 Tauri 桌面应用：数据库、录音、转写、备份等能力都由 Rust 侧提供。
 * 直接在浏览器里打开时，Tauri 运行时不注入 window.__TAURI_INTERNALS__，
 * 任何 invoke 调用都会抛出难懂的 "Cannot read properties of undefined"。
 * 这里提前识别并给出明确指引，而不是让用户面对底层报错。
 */
const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function BrowserFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-8">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Voice to Essay</div>
        <h1 className="mt-2 text-xl font-bold text-[var(--text-primary)]">请在桌面应用中打开</h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          当前页面是在浏览器中打开的。声文依赖桌面应用（Tauri）提供数据库、录音与转写能力，
          浏览器环境无法访问资料库，因此看不到历史数据，页面上的操作也会失败。
        </p>
        <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <div className="text-xs font-semibold text-[var(--text-primary)]">正确的启动方式</div>
          <pre className="mt-2 overflow-x-auto text-xs leading-relaxed text-[var(--text-secondary)]">
{`# 在项目根目录执行（会打开桌面窗口）
npm run tauri dev

# 或使用一键脚本
powershell -ExecutionPolicy Bypass -File .\\start.ps1`}
          </pre>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">
          如果执行 <code className="rounded bg-[var(--bg-tertiary)] px-1">npm run tauri dev</code> 后只有浏览器页面、没有桌面窗口，
          通常是缺少 C 语言构建工具链（Windows 需要 MSVC 或 MinGW），Rust 侧编译失败。
          请查看终端报错，详见 <code className="rounded bg-[var(--bg-tertiary)] px-1">docs/启动说明.md</code>。
        </p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTauriRuntime ? <App /> : <BrowserFallback />}
  </StrictMode>,
)
