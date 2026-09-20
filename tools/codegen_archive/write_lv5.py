import os
path = r'F:\AI\sound_to_essay\src\components\LibraryView.tsx'

content = '''
function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail, chapters, onAddToChapter, onRemoveFromChapter }: {
  detail: MemoryDetail;
  textDraft: string;
  setTextDraft: (v: string) => void;
  setDetail: (v: MemoryDetail) => void;
  saveMetadata: () => void;
  saveWorkingText: () => void;
  restoreVersion: (id: string) => void;
  deleteVersion: (id: string) => void;
  removeMemory: () => void;
  restoreMemory: () => void;
  loadDetail: (id: string) => void;
  chapters: Chapter[];
  onAddToChapter: (id: string) => void;
  onRemoveFromChapter: (id: string) => void;
}) {
  const current = detail.textVersions.find((version) => version.isCurrent);
  const update = (patch: Partial<MemoryDetail>) => setDetail({ ...detail, ...patch } as MemoryDetail);

  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{detail.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${statusStyle(detail.status)}`}>{statusLabel(detail.status)}</span>
          {detail.eventDateText && <span className="text-xs text-[var(--text-secondary)]">{detail.eventDateText}</span>}
          {detail.location && <span className="text-xs text-[var(--text-secondary)]">📍 {detail.location}</span>}
          {detail.deletedAt && <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400 font-medium">已删除</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {detail.deletedAt ? (
          <button onClick={() => void restoreMemory()} className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">恢复</button>
        ) : (
          <button onClick={() => void removeMemory()} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition">移入回收站</button>
        )}
      </div>
    </div>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">元数据</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="标题"><input className="control w-full" value={detail.title} onChange={(event) => update({ title: event.target.value })} /></Field>
        <Field label="录音时间"><input type="datetime-local" className="control w-full" value={detail.audioRecordedAt ? detail.audioRecordedAt.slice(0, 16) : ''} onChange={(event) => update({ audioRecordedAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></Field>
        <Field label="事件发生时间"><input className="control w-full" value={detail.eventDateText || ''} onChange={(event) => update({ eventDateText: event.target.value })} placeholder="如：1985年春、约1990年" /></Field>
        <Field label="时间精度">
          <select className="control w-full" value={detail.eventDatePrecision || 'unknown'} onChange={(event) => update({ eventDatePrecision: event.target.value })}>
            <option value="unknown">未知</option>
            <option value="year">年份</option>
            <option value="month">年月</option>
            <option value="day">精确日期</option>
            <option value="approx">大约</option>
          </select>
        </Field>
        <Field label="地点"><input className="control w-full" value={detail.location || ''} onChange={(event) => update({ location: event.target.value })} placeholder="如：北京、上海" /></Field>
        <Field label="人物"><input className="control w-full" value={detail.people.join('，')} onChange={(event) => update({ people: splitNames(event.target.value) })} placeholder="多人用逗号分隔" /></Field>
        <Field label="标签"><input className="control w-full" value={detail.tags.join('，')} onChange={(event) => update({ tags: splitNames(event.target.value) })} placeholder="多人用逗号分隔" /></Field>
        <Field label="状态">
          <select className="control w-full" value={detail.status} onChange={(event) => update({ status: event.target.value })}>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2"><Field label="备注"><textarea className="control min-h-24 w-full" value={detail.notes || ''} onChange={(event) => update({ notes: event.target.value })} placeholder="尚待核实的细节、后续想补充的内容..." /></Field></div>
      </div>
      <div className="flex justify-end">
        <button onClick={() => void saveMetadata()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-purple-500/20">保存元数据</button>
      </div>
    </section>

    {detail.audioAssets.length > 0 && (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">原始音频</h3>
        {detail.audioAssets.map((audio) => <LazyAudioPlayer key={audio.id} audio={audio} />)}
      </section>
    )}

    {detail.textVersions.length > 0 && (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">原始转写</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">这是语音识别生成的原始文本，不可编辑。</p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
          {detail.textVersions.find((v) => v.versionType === 'raw_transcription')?.content || detail.textVersions[0]?.content || '（无文本）'}
        </div>
      </section>
    )}

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">当前工作文本</h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">保存会产生新的人工校订版本，原始转写不会被覆盖。</p>
        </div>
        <button onClick={() => void saveWorkingText()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-purple-500/20 flex items-center gap-1.5">
          {icons.pen}
          保存为新版本
        </button>
      </div>
      <textarea className="control min-h-56 w-full leading-relaxed" value={textDraft} onChange={(event) => setTextDraft(event.target.value)} placeholder="原始转写会显示在这里；你可以开始校订。" />
      <div className="text-xs text-[var(--text-secondary)]">当前版本：{current?.versionType || '暂无文本'} · {current ? formatDate(current.createdAt) : ''}</div>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">AI 整理</h3>
      <AIProcessor memoryId={detail.id} versionId={current?.id} onDone={() => void loadDetail(detail.id)} />
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">所属章节</h3>
      <div className="space-y-2">
        {(detail as any).chapters?.map((chapter: Chapter) => (
          <div key={chapter.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
            <div className="text-sm font-medium text-[var(--text-primary)]">{chapter.title}</div>
            <button onClick={() => void onRemoveFromChapter(chapter.id)} className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 transition font-medium">移除</button>
          </div>
        ))}
        {(!(detail as any).chapters || (detail as any).chapters.length === 0) && <p className="text-xs text-[var(--text-secondary)]">此记忆尚未加入任何章节</p>}
        {chapters.length > 0 && (
          <div className="flex gap-2 pt-1">
            <select id="add-to-chapter" className="control flex-1 text-xs">
              <option value="">选择章节...</option>
              {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
            <button onClick={() => { const select = document.getElementById('add-to-chapter') as HTMLSelectElement; if (select.value) void onAddToChapter(select.value); }} className="rounded-lg border border-[var(--accent)]/40 px-4 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">添加</button>
          </div>
        )}
      </div>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">版本历史</h3>
      <div className="space-y-2">
        {detail.textVersions.map((version) => (
          <div key={version.id} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition ${version.isCurrent ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5' : 'border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--accent)]/20'}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className={`h-2 w-2 rounded-full ${version.isCurrent ? 'bg-[var(--accent)]' : 'bg-[var(--text-secondary)]'}`} />
                {version.versionType}
                {version.isCurrent && <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">当前</span>}
              </div>
              <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{formatDate(version.createdAt)} · {version.content.slice(0, 90) || '（空文本）'}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!version.isCurrent && <button onClick={() => void restoreVersion(version.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/30 transition font-medium">恢复</button>}
              <button onClick={() => void deleteVersion(version.id)} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium">删除</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
    {children}
  </label>;
}
'''

with open(path, 'a', encoding='utf-8') as f:
    f.write(content)
print('OK part5')
