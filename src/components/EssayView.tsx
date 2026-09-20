import { useState } from 'react';
import { useProjectStore } from '../stores/projectStore';

export function EssayView() {
  const project = useProjectStore((s) => s.project);
  const addClip = useProjectStore((s) => s.addClip);
  const [added, setAdded] = useState(false);

  if (!project || !project.essayText) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(project.essayText).catch(() => {});
  };

  const handleAddToWorkspace = () => {
    addClip({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      rawText: project.essayText,
      durationSecs: 0,
      confidence: 1,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2000);
  };

  const handleExport = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: `${project.name}.md`,
      });
      if (path) {
        await invoke('export_file', { path, content: project.essayText });
      }
    } catch {
      const blob = new Blob([project.essayText], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl prose prose-slate dark:prose-invert">
          {project.essayText.split('\n\n').map((para, i) => (
            <p key={i} className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{para}</p>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2">
        <button
          onClick={handleAddToWorkspace}
          className="rounded-lg bg-[var(--success)] px-3 py-1 text-xs text-white transition hover:brightness-110"
        >
          {added ? '✓ 已添加' : '+ 添加到创作区'}
        </button>
        <button
          onClick={handleCopy}
          className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          复制
        </button>
        <button
          onClick={handleExport}
          className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs text-white transition hover:bg-[var(--accent-hover)]"
        >
          导出 Markdown
        </button>
      </div>
    </div>
  );
}
