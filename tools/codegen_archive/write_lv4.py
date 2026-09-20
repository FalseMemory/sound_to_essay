import os
path = r'F:\AI\sound_to_essay\src\components\LibraryView.tsx'

content = '''
function ChapterView({ chapter, projectId, onSelectMemory, onRemoveMemory, onBack, onChapterUpdated }: {
  chapter: ChapterWithDrafts;
  projectId: string;
  onSelectMemory: (id: string) => void;
  onRemoveMemory: (chapterId: string, memoryId: string) => void;
  onBack: () => void;
  onChapterUpdated: () => void;
}) {
  const settings = useSettingsStore((state) => state.settings);
  const [draftText, setDraftText] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiElapsed, setAiElapsed] = useState(0);
  const [aiNotice, setAiNotice] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const aiTimerRef = useRef<number | null>(null);

  const currentDraft = chapter.drafts.find((d) => d.isCurrent);

  useEffect(() => {
    setDraftText(currentDraft?.content ?? '');
  }, [currentDraft?.content]);

  useEffect(() => {
    if (isAiGenerating) {
      setAiElapsed(0);
      aiTimerRef.current = window.setInterval(() => setAiElapsed((e) => e + 1), 1000);
    } else if (aiTimerRef.current) {
      window.clearInterval(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    return () => {
      if (aiTimerRef.current) { window.clearInterval(aiTimerRef.current); aiTimerRef.current = null; }
    };
  }, [isAiGenerating]);

  const saveDraft = async () => {
    if (!draftText.trim()) return;
    try {
      await invoke('create_chapter_draft', {
        chapterId: chapter.id,
        content: draftText,
        draftType: 'manual',
        processingType: 'user_edit',
        provider: null,
        model: null,
      });
      setExportNotice('草稿已保存。');
      setTimeout(() => setExportNotice(''), 2000);
      onChapterUpdated();
    } catch (e) {
      setExportNotice(`保存草稿失败：${String(e)}`);
    }
  };

  const aiGenerateDraft = async () => {
    const config = settings.llm?.polish;
    if (!config?.baseUrl || !config?.modelName) {
      setAiNotice('LLM 未配置，请先在设置中填写 API 信息。');
      return;
    }
    setIsAiGenerating(true);
    setAiNotice('');
    try {
      await invoke('ai_generate_chapter_draft', {
        chapterId: chapter.id,
        config,
      });
      setAiNotice('AI 草稿生成完成。');
      onChapterUpdated();
    } catch (e) {
      setAiNotice(`生成失败：${String(e)}`);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const exportMarkdown = async () => {
    const text = draftText.trim() || currentDraft?.content || '';
    if (!text) {
      setExportNotice('没有可导出的内容。');
      return;
    }
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: `${chapter.title}.md`,
      });
      if (!filePath) return;
      const header = `# ${chapter.title}\\n\\n> 来源：${chapter.memories.length} 条记忆\\n> 导出时间：${new Date().toLocaleString()}\\n\\n---\\n\\n`;
      await invoke('export_file', { path: filePath, content: header + text });
      setExportNotice('Markdown 导出成功。');
      setTimeout(() => setExportNotice(''), 3000);
    } catch (e) {
      setExportNotice(`导出失败：${String(e)}`);
    }
  };

  const deleteDraft = async (draftId: string) => {
    if (!window.confirm('确定删除这个草稿？')) return;
    try {
      await invoke('delete_chapter_draft', { draftId });
      onChapterUpdated();
    } catch (e) {
      setExportNotice(`删除失败：${String(e)}`);
    }
  };

  const switchDraft = async (draftId: string) => {
    try {
      // Restore by creating a new manual draft with the old content
      const draft = chapter.drafts.find((d) => d.id === draftId);
      if (!draft) return;
      await invoke('create_chapter_draft', {
        chapterId: chapter.id,
        content: draft.content,
        draftType: 'manual',
        processingType: 'restored',
        provider: draft.provider,
        model: draft.model,
      });
      onChapterUpdated();
    } catch (e) {
      setExportNotice(`切换失败：${String(e)}`);
    }
  };

  const config = settings.llm?.polish;
  const isConfigured = !!(config?.baseUrl && config?.modelName);
  const providerLabel = config?.baseUrl?.includes('localhost') || config?.baseUrl?.includes('127.0.0.1') ? '本地 Ollama' : '远程 API';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition border border-transparent hover:border-[var(--border)]">
          {icons.back}
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">{chapter.title}</h2>
          <p className="text-xs text-[var(--text-secondary)]">{chapter.memories.length} 条记忆 · {chapter.drafts.length} 个草稿</p>
        </div>
      </div>

      {/* Chapter materials */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">章节素材</h3>
        <div className="space-y-2">
          {chapter.memories.map((memory) => (
            <div key={memory.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3 transition hover:border-[var(--accent)]/20">
              <button onClick={() => onSelectMemory(memory.id)} className="min-w-0 text-left flex-1">
                <div className="text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{memory.eventDateText || formatDate(memory.audioRecordedAt)}</div>
              </button>
              <button onClick={() => onRemoveMemory(chapter.id, memory.id)} className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition font-medium">移除</button>
            </div>
          ))}
          {chapter.memories.length === 0 && <p className="text-sm text-[var(--text-secondary)]">此章节还没有关联记忆。</p>}
        </div>
      </section>

      {/* Draft editor */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">章节草稿</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">编辑后保存为新草稿版本，不会覆盖已有内容。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void exportMarkdown()} className="rounded-lg border border-[var(--accent)]/40 px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10 transition flex items-center gap-1.5">
              {icons.download}
              导出 Markdown
            </button>
            <button onClick={() => void saveDraft()} disabled={!draftText.trim()} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition disabled:opacity-50 flex items-center gap-1.5">
              {icons.pen}
              保存草稿
            </button>
          </div>
        </div>
        {exportNotice && <div className={`text-xs ${exportNotice.includes('失败') ? 'text-red-400' : 'text-emerald-400'}`}>{exportNotice}</div>}
        <textarea
          className="control min-h-64 w-full leading-relaxed"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder="在此撰写章节草稿，或点击「AI 生成」根据素材自动创建..."
        />
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-[var(--text-secondary)]">
            {currentDraft ? `当前草稿：${currentDraft.draftType} · ${formatDate(currentDraft.createdAt)}${currentDraft.model ? ` · ${currentDraft.model}` : ''}` : '暂无草稿'}
          </div>
          <button onClick={() => void aiGenerateDraft()} disabled={isAiGenerating || !isConfigured} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition flex items-center gap-2 ${isAiGenerating || !isConfigured ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : 'bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600'}`}>
            {isAiGenerating && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {icons.sparkle}
            {isAiGenerating ? `生成中（${aiElapsed}s）` : 'AI 生成草稿'}
          </button>
        </div>
        {isAiGenerating && <div className="text-xs text-[var(--text-secondary)]">正在根据章节素材生成草稿，请勿关闭应用...</div>}
        {config?.modelName && !isAiGenerating && <div className="text-[10px] text-[var(--text-secondary)]">当前模型：{config.modelName} · {providerLabel}</div>}
        {!isConfigured && <div className="text-xs text-amber-400">⚠️ 请在「设置」中配置 LLM API 地址和模型名称后再使用 AI 生成。</div>}
        {aiNotice && <div className={`text-xs ${aiNotice.includes('失败') ? 'text-red-400' : 'text-emerald-400'}`}>{aiNotice}</div>}
      </section>

      {/* Draft history */}
      {chapter.drafts.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">草稿历史</h3>
          <div className="space-y-2">
            {chapter.drafts.map((draft) => (
              <div key={draft.id} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition ${draft.isCurrent ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5' : 'border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--accent)]/20'}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <span className={`h-2 w-2 rounded-full ${draft.isCurrent ? 'bg-[var(--accent)]' : 'bg-[var(--text-secondary)]'}`} />
                    <span className="capitalize">{draft.draftType}</span>
                    {draft.processingType && <span className="text-[10px] text-[var(--text-secondary)]">({draft.processingType})</span>}
                    {draft.isCurrent && <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">当前</span>}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{formatDate(draft.createdAt)} · {draft.content.slice(0, 100) || '（空文本）'}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!draft.isCurrent && (
                    <button onClick={() => void switchDraft(draft.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/30 transition font-medium">
                      恢复
                    </button>
                  )}
                  <button onClick={() => void deleteDraft(draft.id)} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium">
                    {icons.trash}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
'''

with open(path, 'a', encoding='utf-8') as f:
    f.write(content)
print('OK part4')
