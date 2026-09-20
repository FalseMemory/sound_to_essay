import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from './stores/projectStore';
import { useSettingsStore } from './stores/settingsStore';
import { useThemeStore } from './stores/themeStore';
import { RecordingPanel } from './components/RecordingPanel';
import { CreationEditor } from './components/CreationEditor';
import { PolishView } from './components/PolishView';
import { EssayView } from './components/EssayView';
import { SettingsPage } from './components/SettingsPage';
import { LibraryView } from './components/LibraryView';
import { StyleSelector } from './components/StyleSelector';
import { useClipTranscription } from './hooks/useClipTranscription';
import { usePolish } from './hooks/usePolish';
import type { PageView, ProjectData, ProjectListItem, VoiceClip } from './types';

/**
 * A1：应用异常退出时，片段可能停在 "processing"。启动时把它复位为 "pending"
 * 并写明原因，避免界面上永久显示"转写中"且无法重试。
 */
function resetInterruptedClips(project: ProjectData): ProjectData {
  if (!project.clips.some((clip) => clip.transcriptionStatus === 'processing')) return project;
  return {
    ...project,
    clips: project.clips.map((clip) =>
      clip.transcriptionStatus === 'processing'
        ? { ...clip, transcriptionStatus: 'pending' as const, transcriptionError: '应用上次退出前转写未完成，可重新转写' }
        : clip
    ),
  };
}

function segTier(active: boolean) {
  return `rounded-md px-2.5 py-1 transition ${
    active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
  }`;
}

function segTab(active: boolean, enabled: boolean) {
  return `rounded-md px-3 py-1 transition ${
    !enabled ? 'cursor-not-allowed opacity-40 ' : ''
  }${active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`;
}

function App() {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const currentView = useProjectStore((s) => s.currentView);
  const setView = useProjectStore((s) => s.setView);
  const showSettings = useSettingsStore((s) => s.showSettings);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [isInitialized, setIsInitialized] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const saveTimerRef = useRef<number | null>(null);
  const initRef = useRef(false);
  const polish = usePolish();

  // 初始化创作区项目：录音按钮依赖当前 .vse 项目存在，必须保证启动时已加载，
  // 否则按钮会永久禁用。优先恢复上次打开的项目，其次取最近项目，都没有则新建默认项目。
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const init = async () => {
      await loadSettings();
      try {
        const lastId = await invoke<string | null>('load_last_project_id');
        if (lastId) {
          const loaded = await invoke<ProjectData>('load_project', { projectId: lastId });
          setProject(resetInterruptedClips(loaded));
          return;
        }
        const items = await invoke<ProjectListItem[]>('list_projects');
        if (items.length > 0) {
          const loaded = await invoke<ProjectData>('load_project', { projectId: items[0].id });
          setProject(resetInterruptedClips(loaded));
        } else {
          setProject(await invoke<ProjectData>('create_project', { name: '我的回忆录' }));
        }
      } catch (error) {
        console.error('初始化创作区项目失败：', error);
      }
    };
    init().finally(() => setIsInitialized(true));
  }, []);

  useEffect(() => {
    if (!isInitialized || !project) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        setSaveStatus('saving');
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('save_project', { project });
        setSaveStatus('saved');
      } catch (e) {
        console.error('Auto-save failed:', e);
        setSaveStatus('error');
      }
    }, 700);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [project, isInitialized]);

  const handleCleanup = async () => {
    if (!project) return;
    if (!window.confirm('将删除 sounds 文件夹中未被任何项目或资料库引用的录音。是否继续？')) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_project', { project });
      const activeAudioPaths = project.clips
        .map((c) => c.audioPath)
        .filter((p): p is string => Boolean(p));
      const result = await invoke<{ scanned: number; removed: number; retained: number }>(
        'cleanup_unreferenced_audio',
        { activeAudioPaths }
      );
      alert(`已扫描 ${result.scanned} 个录音，清理 ${result.removed} 个未引用文件，保留 ${result.retained} 个仍在使用的文件。`);
    } catch (error) {
      alert(`清理录音失败：${String(error)}`);
    }
  };

  const navItems: { key: PageView; label: string; icon: React.ReactNode }[] = [
    {
      key: 'library',
      label: '资料库',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
      ),
    },
    {
      key: 'workspace',
      label: '创作区',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      ),
    },
  ];

  const settingsIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* ===== Top bar ===== */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-6">
        <div className="flex min-w-0 items-center gap-6">
          {/* Brand */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-base font-bold text-white shadow-sm shadow-blue-500/20">声</div>
            <span className="text-[15px] font-bold text-[var(--text-primary)]">声文</span>
          </div>

          {/* Top nav (horizontal) */}
          <nav className="flex items-center gap-1 rounded-lg bg-[var(--bg-tertiary)] p-1">
            {navItems.map((item) => {
              const active = !showSettings && currentView === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => { setShowSettings(false); setView(item.key); }}
                  className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-3">
          {project && !showSettings && (
            <span className="text-xs text-[var(--text-secondary)]" aria-live="polite">
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-secondary)]/30 border-t-[var(--accent)]" />
                  保存中
                </span>
              ) : saveStatus === 'error' ? (
                <span className="text-[var(--error)]">保存失败</span>
              ) : null}
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[var(--text-secondary)] transition hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
          >
            {theme === 'light' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            )}
          </button>
          <button
            onClick={() => {
              if (showSettings) window.dispatchEvent(new Event('settings-close-request'));
              else setShowSettings(true);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition ${
              showSettings
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
            title="设置"
            aria-label="设置"
          >
            {settingsIcon}
          </button>
        </div>
      </header>

      {/* ===== Content ===== */}
      <main className="flex min-h-0 flex-1 flex-col bg-[var(--bg-primary)]">
        {showSettings ? (
          <>
            <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-secondary)] px-6 py-3">
              <button
                onClick={() => window.dispatchEvent(new Event('settings-close-request'))}
                className="flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
                返回
              </button>
            </div>
            <SettingsPage onClose={() => setShowSettings(false)} />
          </>
        ) : currentView === 'library' ? (
          <LibraryView />
        ) : currentView === 'workspace' ? (
          <Workspace polish={polish} onCleanup={handleCleanup} />
        ) : null}
      </main>
    </div>
  );
}

function Workspace({ polish, onCleanup }: { polish: ReturnType<typeof usePolish>; onCleanup: () => void }) {
  const project = useProjectStore((s) => s.project);
  const hasPolish = !!project?.polishedText;
  const hasEssay = !!project?.essayText;
  const hasClips = !!project && project.clips.length > 0;
  const [tab, setTab] = useState<'polish' | 'essay'>(hasEssay ? 'essay' : 'polish');
  // A1：创作区片段的"重新转写"入口。转写失败或未转写的片段都能重试，
  // 音频始终保留在项目里，不会被清理动作误删。
  const { transcribeClip, busyClipId } = useClipTranscription();
  const retranscribeClip = (clip: VoiceClip) => { void transcribeClip(clip); };

  useEffect(() => {
    if (hasEssay) setTab('essay');
    else if (hasPolish) setTab('polish');
  }, [hasEssay, hasPolish]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Command toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4">
        <RecordingPanel />
        <div className="h-6 w-px bg-[var(--border)]" />
        <div className="flex items-center rounded-lg bg-[var(--bg-tertiary)] p-0.5 text-xs">
          <button onClick={() => polish.setTier('faithful')} className={segTier(polish.tier === 'faithful')}>校订·保真</button>
          <button onClick={() => polish.setTier('creative')} className={segTier(polish.tier === 'creative')}>文学化改写</button>
        </div>
        <button
          onClick={polish.run}
          disabled={polish.isPolishing || !hasClips}
          className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {polish.isPolishing ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              整理中 {polish.elapsed}s
            </>
          ) : (
            '🤖 AI 整理'
          )}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <StyleSelector />
          <button
            onClick={onCleanup}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:border-[var(--error)] hover:text-[var(--error)]"
            title="清理未被引用的录音文件"
          >
            🧹 清理录音
          </button>
        </div>
      </div>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[42%] min-h-0 flex-col border-r border-[var(--border)]">
          <CreationEditor onRetranscribe={retranscribeClip} busyClipId={busyClipId} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4">
            <div className="flex items-center rounded-lg bg-[var(--bg-tertiary)] p-0.5 text-xs">
              <button onClick={() => setTab('polish')} disabled={!hasPolish} className={segTab(tab === 'polish', hasPolish)}>整理稿</button>
              <button onClick={() => setTab('essay')} disabled={!hasEssay} className={segTab(tab === 'essay', hasEssay)}>散文</button>
            </div>
            {tab === 'polish' && polish.tier === 'creative' && hasPolish && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">文学化改写·创作性</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {!hasPolish && !hasEssay ? (
              <ResultEmpty />
            ) : tab === 'polish' ? (
              <PolishView />
            ) : (
              <EssayView />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultEmpty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center text-[var(--text-secondary)]">
      <div className="mb-3 text-4xl">📝</div>
      <p className="text-sm">录制并整理后，成稿会显示在这里</p>
      <p className="mt-1 text-xs">点击上方「AI 整理」生成整理稿，或「生成散文」创作文章</p>
    </div>
  );
}

export default App;
