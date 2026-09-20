/**
 * C1：手机记录端主框架。
 *
 * 单栏布局 + 底部导航（记录 / 我的素材 / 设置）。
 * 第一版**不展示**桌面端的章节与旧创作区入口，避免移动端信息过载。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { RecordView } from './views/RecordView';
import { MaterialsView } from './views/MaterialsView';
import { SettingsView } from './views/SettingsView';
import { OfflineStatus } from './components/OfflineStatus';

export type MobileTab = 'record' | 'materials' | 'settings';

const icons: Record<MobileTab, ReactNode> = {
  record: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  ),
  materials: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

const TABS: { key: MobileTab; label: string }[] = [
  { key: 'record', label: '记录' },
  { key: 'materials', label: '我的素材' },
  { key: 'settings', label: '设置' },
];

export function MobileApp() {
  const [tab, setTab] = useState<MobileTab>('record');
  // 素材变化后用于强制刷新列表
  const [materialsVersion, setMaterialsVersion] = useState(0);

  const bumpMaterials = () => setMaterialsVersion((value) => value + 1);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <header className="safe-top shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
            声
          </div>
          <span className="text-base font-bold text-[var(--text-primary)]">声文</span>
          <span className="truncate text-xs text-[var(--text-secondary)]">手机记录</span>
        </div>
      </header>

      <OfflineStatus />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div hidden={tab !== 'record'}>
          <RecordView
            onSaved={() => {
              bumpMaterials();
              setTab('materials');
            }}
          />
        </div>
        {tab === 'materials' && (
          <MaterialsView version={materialsVersion} onChanged={bumpMaterials} />
        )}
        {tab === 'settings' && <SettingsView />}
      </main>

      <nav className="safe-bottom shrink-0 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex">
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`touch-target flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                {icons[item.key]}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
