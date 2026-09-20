import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const mobileOnly = process.env.BUILD_MOBILE === '1'

/**
 * 手机真机测试录音需要 HTTPS：
 * 浏览器只在 https:// 或 localhost 下暴露麦克风接口，用局域网 IP 走 http 时
 * `navigator.mediaDevices` 直接不存在。
 *
 * 因此提供开关：默认仍是 http:57123（桌面端 `tauri dev` 的 devUrl 固定指向它），
 * 需要手机测试时用 `VITE_HTTPS=1 npm run dev` 起一个 https:57124 的服务，两者互不抢占端口。
 * 证书由 `certs/` 下的本地 CA 签发，手机需一次性安装并信任该 CA（见 docs/手机端HTTPS调试说明.md）。
 */
const useHttps = process.env.VITE_HTTPS === '1'
const certDir = entry('./certs')
const keyFile = join(certDir, 'server.key')
const certFile = join(certDir, 'server.crt')
const httpsConfig =
  useHttps && existsSync(keyFile) && existsSync(certFile)
    ? { key: readFileSync(keyFile), cert: readFileSync(certFile) }
    : undefined

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'mobile-offline-shell',
    generateBundle(_options, bundle) {
      if (!mobileOnly) return;
      for (const name of ['mobile.webmanifest', 'mobile-icon.svg']) {
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(entry('./public/' + name)) });
      }
      this.emitFile({ type: 'asset', fileName: 'mobile-icon.png', source: readFileSync(entry('./src-tauri/icons/128x128@2x.png')) });
      const files = [...new Set([...Object.keys(bundle).filter(name => /\.(js|css|woff2?|html)$/.test(name)), 'mobile.html', 'mobile.webmanifest', 'mobile-icon.svg', 'mobile-icon.png'])];
      const version = Date.now().toString(36);
      this.emitFile({ type: 'asset', fileName: 'mobile-sw.js', source: `
const CACHE = 'shengwen-mobile-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(p => new URL(p, self.registration.scope).href)))));
// Updates wait for all old clients to close. Never reload an active recording.
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shengwen-mobile-') && k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.search = '';
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const allowed = FILES.some(p => new URL(p, self.registration.scope).href === url.href);
  if (!allowed) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.href)) || fetch(event.request)));
});` });
    },
  }],
  clearScreen: false,
  base: './',
  publicDir: mobileOnly ? false : 'public',
  build: {
    outDir: mobileOnly ? 'dist-mobile' : 'dist',
    rollupOptions: {
      input: mobileOnly ? { mobile: entry('./mobile.html') } : {
        // 桌面端（Tauri 使用 index.html）
        main: entry('./index.html'),
        // C1：手机记录端独立入口，浏览器直接访问 /mobile.html
        mobile: entry('./mobile.html'),
      },
    },
  },
  server: {
    // https 模式用另一个端口，避免和桌面端（tauri dev 的 57123）互相抢占
    port: useHttps ? 57124 : 57123,
    // 必须为 true：tauri.conf.json 的 devUrl 固定指向 57123，若 Vite 在端口被占时
    // 静默切换端口（strictPort:false 的行为），桌面窗口仍会去加载 57123，
    // 结果是白屏且极难排查。改为端口被占用时直接报错，让冲突立刻可见。
    strictPort: true,
    // 手机端要在局域网里用手机浏览器访问调试，需要监听 0.0.0.0
    host: true,
    https: httpsConfig,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
