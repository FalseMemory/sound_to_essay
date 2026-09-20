
path = r'F:/AI/sound_to_essay/src/components/LibraryView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update main content area to show chapter detail when in chapter mode
old_main = '''    <main className="min-w-0 flex-1 overflow-y-auto p-6">
      {notice && <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--text-primary)] flex items-center gap-2"><span className="text-[var(--accent)]">ℹ</span>{notice}</div>}
      {!detail ? (
        <div className="flex h-full items-center justify-center text-center text-[var(--text-secondary)]">
          <div className="max-w-sm">
            <div className="text-5xl mb-4">🎙️</div>
            <p className="text-lg font-medium text-[var(--text-primary)]">选择一条记忆，或开始录制新的口述</p>
            <p className="mt-2 text-sm leading-relaxed">原始音频和原始转写会被永久保留。<br/>后续编辑都会创建新版本，不会覆盖原始素材。</p>
          </div>
        </div>
      ) : (
        <MemoryEditor detail={detail} textDraft={textDraft} setTextDraft={setTextDraft} setDetail={setDetail} saveMetadata={saveMetadata} saveWorkingText={saveWorkingText} restoreVersion={restoreVersion} removeMemory={removeMemory} restoreMemory={restoreMemory} loadDetail={loadDetail} />
      )}
    </main>'''

new_main = '''    <main className="min-w-0 flex-1 overflow-y-auto p-6">
      {notice && <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--text-primary)] flex items-center gap-2"><span className="text-[var(--accent)]">ℹ</span>{notice}</div>}
      {browseMode === 'chapters' && chapterDetail ? (
        <ChapterView chapter={chapterDetail} onSelectMemory={(id) => { setBrowseMode('list'); void selectMemory(id); }} onRemoveMemory={(chapterId, memoryId) => void (async () => { await invoke('remove_memory_from_chapter', { chapterId, memoryId }); await loadChapterDetail(chapterId); })();} />
      ) : !detail ? (
        <div className="flex h-full items-center justify-center text-center text-[var(--text-secondary)]">
          <div className="max-w-sm">
            <div className="text-5xl mb-4">🎙️</div>
            <p className="text-lg font-medium text-[var(--text-primary)]">选择一条记忆，或开始录制新的口述</p>
            <p className="mt-2 text-sm leading-relaxed">原始音频和原始转写会被永久保留。<br/>后续编辑都会创建新版本，不会覆盖原始素材。</p>
          </div>
        </div>
      ) : (
        <MemoryEditor detail={detail} textDraft={textDraft} setTextDraft={setTextDraft} setDetail={setDetail} saveMetadata={saveMetadata} saveWorkingText={saveWorkingText} restoreVersion={restoreVersion} deleteVersion={deleteVersion} removeMemory={removeMemory} restoreMemory={restoreMemory} loadDetail={loadDetail} chapters={chapters} onAddToChapter={addMemoryToChapter} onRemoveFromChapter={removeMemoryFromChapter} />
      )}
    </main>'''

content = content.replace(old_main, new_main)

# 2. Add ChapterView component before MemoryEditor
old_chapterView = 'function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail }: {'

new_chapterView = '''function ChapterView({ chapter, onSelectMemory, onRemoveMemory }: { chapter: ChapterDetail; onSelectMemory: (id: string) => void; onRemoveMemory: (chapterId: string, memoryId: string) => void }) {
  return <div className="mx-auto max-w-3xl space-y-5">
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <h2 className="text-xl font-bold text-[var(--text-primary)]">{chapter.title}</h2>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">{chapter.memories.length} 条记忆</p>
    </div>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">章节素材</h3>
      <div className="space-y-2">
        {chapter.memories.map((memory) => (
          <div key={memory.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
            <button onClick={() => onSelectMemory(memory.id)} className="min-w-0 text-left">
              <div className="text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
              <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{memory.eventDateText || formatDate(memory.audioRecordedAt)}</div>
            </button>
            <button onClick={() => onRemoveMemory(chapter.id, memory.id)} className="shrink-0 rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 transition">移除</button>
          </div>
        ))}
        {chapter.memories.length === 0 && <p className="text-sm text-[var(--text-secondary)]">此章节还没有关联记忆。</p>}
      </div>
    </section>
  </div>;
}

function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail, chapters, onAddToChapter, onRemoveFromChapter }: {'

content = content.replace(old_chapterView, new_chapterView)

# 3. Update MemoryEditor signature
old_sig = '''function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail }: {
  detail: MemoryDetail;
  textDraft: string;
  setTextDraft: (v: string) => void;
  setDetail: (v: MemoryDetail | null) => void;
  saveMetadata: () => Promise<void>;
  saveWorkingText: () => Promise<void>;
  restoreVersion: (id: string) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  removeMemory: () => Promise<void>;
  restoreMemory: () => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
}) {'''

new_sig = '''function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail, chapters, onAddToChapter, onRemoveFromChapter }: {
  detail: MemoryDetail;
  textDraft: string;
  setTextDraft: (v: string) => void;
  setDetail: (v: MemoryDetail | null) => void;
  saveMetadata: () => Promise<void>;
  saveWorkingText: () => Promise<void>;
  restoreVersion: (id: string) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  removeMemory: () => Promise<void>;
  restoreMemory: () => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  chapters: Chapter[];
  onAddToChapter: (chapterId: string) => Promise<void>;
  onRemoveFromChapter: (chapterId: string) => Promise<void>;
}) {'''

content = content.replace(old_sig, new_sig)

# 4. Add chapters section in MemoryEditor before 版本历史
old_version_history = '''    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">版本历史</h3>'''

new_version_history = '''    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">所属章节</h3>
      <div className="space-y-2">
        {(detail as any).chapters?.map((chapter: Chapter) => (
          <div key={chapter.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-2">
            <div className="text-sm font-medium text-[var(--text-primary)]">{chapter.title}</div>
            <button onClick={() => void onRemoveFromChapter(chapter.id)} className="shrink-0 rounded-md border border-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10 transition">移除</button>
          </div>
        ))}
        {(!(detail as any).chapters || (detail as any).chapters.length === 0) && <p className="text-xs text-[var(--text-secondary)]">此记忆尚未加入任何章节。</p>}
        {chapters.length > 0 && (
          <div className="flex gap-2 pt-1">
            <select id="add-to-chapter" className="control flex-1 text-xs">
              <option value="">选择章节…</option>
              {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
            <button onClick={() => { const select = document.getElementById('add-to-chapter') as HTMLSelectElement; if (select.value) void onAddToChapter(select.value); }} className="rounded-md border border-[var(--accent)]/40 px-3 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">添加</button>
          </div>
        )}
      </div>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">版本历史</h3>'''

content = content.replace(old_version_history, new_version_history)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Main area and MemoryEditor updated')
