import { useEffect, useState } from 'react';

export function OfflineStatus() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let disposed = false;
    void navigator.serviceWorker.register('./mobile-sw.js').then(async registration => {
      const ready = await navigator.serviceWorker.ready;
      if (!disposed && ready.active) setMessage('离线资源已准备好。请先试一次断网打开。');
      const check = () => {
        if (!disposed && registration.waiting) setMessage('新版本已准备好。请保存录音和编辑内容，关闭所有声文页面后重新打开。');
      };
      check();
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check));
    }).catch(() => { if (!disposed) setMessage('离线资源准备失败，请联网重新打开后再试。'); });
    return () => { disposed = true; };
  }, []);
  return message ? <p role="status" className="px-4 py-2 text-xs text-[var(--text-secondary)]">{message}</p> : null;
}
