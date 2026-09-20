import { useProjectStore } from '../stores/projectStore';
import { clipWorkingText, type VoiceClip } from '../types';

function confidenceColor(c: number): string {
  if (c > 0.9) return 'text-emerald-600 dark:text-emerald-400';
  if (c > 0.7) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * A1：片段转写状态徽标。`success` 与旧文件（undefined）都不显示，
 * 让"待转写 / 转写中 / 转写失败"这三种需要用户关注的状态浮现出来。
 */
function clipTranscriptionBadge(clip: VoiceClip): { label: string; className: string } | null {
  switch (clip.transcriptionStatus) {
    case 'pending':
      return { label: '待转写', className: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600' };
    case 'processing':
      return { label: '转写中', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30' };
    case 'failed':
      return { label: '转写失败', className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30' };
    default:
      return null;
  }
}

/** 有音频、且尚未成功转写的片段才提供重新转写入口。 */
function needsTranscription(clip: VoiceClip): boolean {
  if (!clip.audioPath) return false;
  if (clip.transcriptionStatus === 'success' || clip.transcriptionStatus === 'processing') return false;
  if (clip.transcriptionStatus === 'pending' || clip.transcriptionStatus === 'failed') return true;
  // 旧片段没有状态字段：文本为空说明当时转写没成功，值得补一次。
  return !clipWorkingText(clip).trim();
}

export function CreationEditor({ onRetranscribe, busyClipId }: {
  onRetranscribe: (clip: VoiceClip) => void;
  busyClipId: string | null;
}) {
  const project = useProjectStore((s) => s.project);
  const updateClipText = useProjectStore((s) => s.updateClipText);
  const removeClip = useProjectStore((s) => s.removeClip);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-secondary)]">
        <div className="space-y-3 text-center">
          <div className="text-5xl">🎙</div>
          <p className="text-lg">按 <kbd className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 font-mono text-[var(--accent)]">Ctrl+Alt+R</kbd> 开始录音</p>
          <p className="text-sm">或点击左上角"新建项目"</p>
        </div>
      </div>
    );
  }

  const allText = project.clips.map(clipWorkingText).join('\n');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">原始记录</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>{project.clips.length} 条记录</span>
          <span>{allText.length} 字</span>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {project.clips.length === 0 && (
          <div className="mt-12 space-y-1 text-center text-[var(--text-secondary)]">
            <p>还没有录音片段</p>
            <p className="text-sm">点击录音按钮开始录制你的故事</p>
          </div>
        )}

        {project.clips.map((clip, idx) => {
          const badge = clipTranscriptionBadge(clip);
          const canRetranscribe = needsTranscription(clip);
          const isBusy = busyClipId === clip.id;
          return (
            <div
              key={clip.id}
              className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]"
            >
              <div className="flex items-center justify-between bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-secondary)]">#{idx + 1}</span>
                  {badge && (
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                      title={clip.transcriptionError || undefined}
                    >
                      {badge.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono ${confidenceColor(clip.confidence)}`}>
                    {Math.round(clip.confidence * 100)}%
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {new Date(clip.timestamp).toLocaleTimeString()}
                  </span>
                  {clip.durationSecs > 0 && (
                    <span className="text-[var(--text-secondary)]">
                      {clip.durationSecs.toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>
              <textarea
                className="min-h-[60px] w-full resize-none bg-transparent p-3 text-sm leading-relaxed outline-none"
                value={clipWorkingText(clip)}
                onChange={(e) => updateClipText(clip.id, e.target.value)}
              />
              {/* A1：转写失败时保留录音，并在这里给出原因与重试入口 */}
              {clip.transcriptionStatus === 'failed' && clip.transcriptionError && (
                <div className="mx-3 mb-2 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1 text-[11px] text-red-600 dark:text-red-300">
                  {clip.transcriptionError}
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pb-1 pr-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                {canRetranscribe && (
                  <button
                    onClick={() => onRetranscribe(clip)}
                    disabled={isBusy}
                    className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
                  >
                    {isBusy ? '转写中…' : clip.transcriptionStatus === 'failed' ? '重新转写' : '开始转写'}
                  </button>
                )}
                <button
                  onClick={() => removeClip(clip.id)}
                  className="text-xs text-[var(--error)] hover:underline"
                >
                  删除此段
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
