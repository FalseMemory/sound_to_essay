import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { clipWorkingText } from '../types';

export function PolishView() {
  const project = useProjectStore((s) => s.project);
  const setPolishedText = useProjectStore((s) => s.setPolishedText);
  const [editText, setEditText] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [adopted, setAdopted] = useState(false);

  useEffect(() => {
    setEditText(project?.polishedText || '');
    setAdopted(false);
  }, [project?.polishedText]);

  if (!project || !project.polishedText) return null;

  const rawText = project.clips.map(clipWorkingText).join('\n');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showOriginal ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col border-r border-[var(--border)]">
            <div className="bg-[var(--bg-tertiary)] px-3 py-1 text-xs text-[var(--text-secondary)]">原始口述</div>
            <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              {rawText}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="bg-[var(--bg-tertiary)] px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400">整理稿（可编辑）</div>
            <textarea
              className="flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed outline-none"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <textarea
          className="flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed outline-none"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          placeholder="AI 整理结果会显示在这里，也可以手动修改。"
        />
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
        <button
          onClick={() => setShowOriginal((v) => !v)}
          className="text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          {showOriginal ? '隐藏原文对照' : '对照原文'}
        </button>
        <div className="flex items-center gap-2">
          {adopted && <span className="text-xs text-emerald-600 dark:text-emerald-400">已采用</span>}
          <button
            onClick={() => setPolishedText('')}
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            重新整理
          </button>
          <button
            onClick={() => { setPolishedText(editText); setAdopted(true); }}
            className="rounded-lg bg-[var(--success)] px-3 py-1 text-xs text-white transition hover:brightness-110"
          >
            确认采用
          </button>
        </div>
      </div>
    </div>
  );
}
