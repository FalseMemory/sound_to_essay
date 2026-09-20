import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import { MobileApp } from './App'

const THEME_KEY = 'sound_to_essay_theme'

/**
 * 手机端默认跟随系统深浅色；用户在设置页手动切换过则以手动值为准。
 * 在首次渲染前写入 data-theme，避免主题闪变。
 */
function resolveTheme(): 'light' | 'dark' {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // 隐私模式等场景读不到 localStorage，走系统偏好
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

document.documentElement.dataset.theme = resolveTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
)
