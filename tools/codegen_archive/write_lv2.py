import os
path = r'F:\AI\sound_to_essay\src\components\LibraryView.tsx'

content = '''
export function LibraryView() {
  const settings = useSettingsStore((state) => state.settings);
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [memories, setMemories] = useState<MemorySummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState<'all' | 'dated' | 'undated'>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState('');
  const [textDraft, setTextDraft] = useState('');
  const [browseMode, setBrowseMode] = useState<'list' | 'people' | 'locations' | 'tags' | 'chapters'>('list');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [chapterDetail, setChapterWithDrafts] = useState<ChapterWithDrafts | null>(null);
  const [peopleList, setPeopleList] = useState<string[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [locationsList, setLocationsList] = useState<string[]>([]);

  const loadProjects = async () => {
    const result = await invoke<LibraryProject[]>('list_library_projects');
    setProjects(result);
    const firstId = result[0]?.id || '';
    const nextId = projectId || firstId;
    setProjectId(nextId);
    if (nextId) {
      await loadMemories(nextId);
      await loadChapters(nextId);
      await loadBrowseData(nextId);
    }
  };

  const loadMemories = async (targetProjectId: string) => {
    if (!targetProjectId) { setMemories([]); return; }
    const result = query.trim()
      ? await invoke<MemorySummary[]>('search_memories', { query, projectId: targetProjectId })
      : await invoke<MemorySummary[]>('list_memories', { projectId: targetProjectId, includeDeleted: showDeleted });
    setMemories(result);
    if (selectedId && !result.some((memory) => memory.id === selectedId)) {
      setSelectedId('');
      setDetail(null);
    }
  };

  const loadDetail = async (memoryId: string) => {
    const result = await invoke<MemoryDetail | null>('get_memory', { memoryId });
    setDetail(result);
    const current = result?.textVersions.find((version) => version.isCurrent);
    setTextDraft(current?.content ?? '');
    if (result) {
      const chapters = await invoke<Chapter[]>('list_memory_chapters', { memoryId: result.id });
      setDetail({ ...result, chapters } as MemoryDetail & { chapters: Chapter[] });
    }
  };

  const loadChapters = async (targetProjectId = projectId) => {
    if (!targetProjectId) { setChapters([]); return; }
    const result = await invoke<Chapter[]>('list_chapters', { projectId: targetProjectId });
    setChapters(result);
  };

  const loadChapterWithDrafts = async (chapterId: string) => {
    const result = await invoke<ChapterWithDrafts | null>('get_chapter', { chapterId });
    setChapterWithDrafts(result);
  };

  const loadBrowseData = async (targetProjectId = projectId) => {
    if (!targetProjectId) return;
    const [people, tags, locations] = await Promise.all([
      invoke<string[]>('list_all_people', { projectId: targetProjectId }),
      invoke<string[]>('list_all_tags', { projectId: targetProjectId }),
      invoke<string[]>('list_all_locations', { projectId: targetProjectId }),
    ]);
    setPeopleList(people);
    setTagsList(tags);
    setLocationsList(locations);
  };

  useEffect(() => { void loadProjects().catch((error) => setNotice(`无法加载资料库：${String(error)}`)); }, []);
  useEffect(() => {
    if (!projectId) { setMemories([]); setChapters([]); return; }
    void loadMemories(projectId).catch((error) => setNotice(`无法加载记忆：${String(error)}`));
    void loadChapters(projectId).catch(() => {});
    void loadBrowseData(projectId).catch(() => {});
  }, [projectId, showDeleted]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!projectId) return;
      void loadMemories(projectId).catch((error) => setNotice(String(error)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, projectId]);

  const visibleMemories = useMemo(() => memories.filter((memory) => {
    if (statusFilter && memory.status !== statusFilter) return false;
    if (timeFilter === 'dated' && !memory.eventDateText) return false;
    if (timeFilter === 'undated' && memory.eventDateText) return false;
    return true;
  }), [memories, statusFilter, timeFilter]);

  const createLibraryProject = async () => {
    const name = window.prompt('回忆录项目名称', '我的口述史');
    if (!name?.trim()) return;
    const created = await invoke<LibraryProject>('create_library_project', { name: name.trim() });
    await loadProjects();
    setProjectId(created.id);
    setNotice('已创建资料库项目。');
  };

  const createEmptyMemory = async () => {
    if (!projectId) { await createLibraryProject(); return; }
    const title = window.prompt('这段记忆的标题', `记忆 ${new Date().toLocaleDateString()}`);
    if (!title?.trim()) return;
    const memory = await invoke<MemorySummary>('create_memory', {
      input: { projectId, title: title.trim(), status: 'inbox' },
    });
    await loadMemories(projectId);
    setSelectedId(memory.id);
    await loadDetail(memory.id);
  };

  const startRecording = async () => {
    if (!projectId) { setNotice('请先创建或选择一个资料库项目。'); return; }
    await invoke('start_recording');
    setRecording(true);
    setNotice('正在录音。停止后会自动转写并保存为一条记忆。');
  };

  const stopRecording = async () => {
    setRecording(false);
    setTranscribing(true);
    try {
      const title = window.prompt('这段口述的标题', `口述 ${new Date().toLocaleString()}`);
      const audio = await invoke<{ audioPath: string; durationSecs: number }>('stop_recording');
      const transcription = await invoke<{ text: string; confidence: number }>('transcribe_audio', {
        audioPath: audio.audioPath,
        modelSize: settings.whisperModel,
        language: settings.whisperLanguage,
        modelDir: settings.whisperModelDir || undefined,
      });
      const memory = await invoke<MemorySummary>('create_memory', {
        input: {
          projectId,
          title: title?.trim() || `口述 ${new Date().toLocaleDateString()}`,
          audioRecordedAt: new Date().toISOString(),
          audioPath: audio.audioPath,
          durationSecs: audio.durationSecs,
          rawText: transcription.text || '',
          status: 'inbox',
        },
      });
      await loadMemories(projectId);
      setSelectedId(memory.id);
      await loadDetail(memory.id);
      setNotice('录音、原始转写和记忆条目已保存。');
    } catch (error) {
      setNotice(`录音或转写失败：${String(error)}`);
    } finally {
      setTranscribing(false);
    }
  };

  const selectMemory = async (memoryId: string) => {
    setSelectedId(memoryId);
    await loadDetail(memoryId);
  };

  const saveMetadata = async () => {
    if (!detail) return;
    try {
      await invoke('update_memory_metadata', { input: {
        id: detail.id,
        title: detail.title,
        audioRecordedAt: detail.audioRecordedAt || undefined,
        eventDateText: detail.eventDateText || undefined,
        eventDatePrecision: detail.eventDatePrecision || 'unknown',
        eventDateSort: dateSortValue(detail.eventDateText),
        location: detail.location || undefined,
        notes: detail.notes || undefined,
        status: detail.status,
      } });
      await invoke('set_memory_tags', { memoryId: detail.id, names: detail.tags });
      await invoke('set_memory_people', { memoryId: detail.id, names: detail.people });
      await loadMemories(projectId);
      await loadDetail(detail.id);
      setNotice('记忆元数据已保存。');
    } catch (error) { setNotice(`保存失败：${String(error)}`); }
  };

  const saveWorkingText = async () => {
    if (!detail) return;
    const current = detail.textVersions.find((version) => version.isCurrent);
    if (textDraft === (current?.content ?? '')) return;
    await invoke<TextVersion>('create_text_version', {
      memoryId: detail.id,
      content: textDraft,
      versionType: 'user_edit',
      processingType: 'manual_edit',
      parentVersionId: current?.id,
    });
    await loadDetail(detail.id);
    await loadMemories(projectId);
    setNotice('已保存为新的人工校订版本；原始转写未被修改。');
  };

  const restoreVersion = async (versionId: string) => {
    if (!detail) return;
    await invoke('restore_text_version', { versionId });
    await loadDetail(detail.id);
    setNotice('已切换到该版本。');
  };

  const deleteVersion = async (versionId: string) => {
    if (!detail) return;
    if (!window.confirm('确定删除这个版本？删除后不可恢复。')) return;
    await invoke('delete_text_version', { versionId });
    await loadDetail(detail.id);
    setNotice('版本已删除。');
  };

  const removeMemory = async () => {
    if (!detail || !window.confirm('将此记忆移入可恢复的删除状态。确认继续？')) return;
    await invoke('delete_memory', { memoryId: detail.id });
    setDetail(null); setSelectedId('');
    await loadMemories(projectId);
  };

  const restoreMemory = async () => {
    if (!detail) return;
    await invoke('restore_memory', { memoryId: detail.id });
    await loadMemories(projectId);
    await loadDetail(detail.id);
  };

  const createChapter = async () => {
    if (!projectId) return;
    const title = window.prompt('章节标题', '第 X 章');
    if (!title?.trim()) return;
    await invoke('create_chapter', { projectId, title: title.trim() });
    await loadChapters(projectId);
    setNotice('章节已创建。');
  };

  const addMemoryToChapter = async (chapterId: string) => {
    if (!detail) return;
    await invoke('add_memory_to_chapter', { chapterId, memoryId: detail.id });
    await loadChapters(projectId);
    const updated = await invoke<Chapter[]>('list_memory_chapters', { memoryId: detail.id });
    setDetail({ ...detail, chapters: updated } as MemoryDetail & { chapters: Chapter[] });
    setNotice('已添加到章节。');
  };

  const removeMemoryFromChapter = async (chapterId: string) => {
    if (!detail) return;
    await invoke('remove_memory_from_chapter', { chapterId, memoryId: detail.id });
    await loadChapters(projectId);
    const updated = await invoke<Chapter[]>('list_memory_chapters', { memoryId: detail.id });
    setDetail({ ...detail, chapters: updated } as MemoryDetail & { chapters: Chapter[] });
  };

  const browseModes: { mode: typeof browseMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'list', label: '全部记忆', icon: icons.list },
    { mode: 'people', label: '人物', icon: icons.people },
    { mode: 'locations', label: '地点', icon: icons.locations },
    { mode: 'tags', label: '标签', icon: icons.tags },
    { mode: 'chapters', label: '章节', icon: icons.chapters },
  ];

  const filterMemoriesByBrowse = (list: MemorySummary[]) => {
    if (browseMode === 'list') return list;
    if (browseMode === 'people') {
      const person = selectedId;
      if (!person) return [];
      return list.filter((m) => m.people.includes(person));
    }
    if (browseMode === 'locations') {
      const loc = selectedId;
      if (!loc) return [];
      return list.filter((m) => m.location === loc);
    }
    if (browseMode === 'tags') {
      const tag = selectedId;
      if (!tag) return [];
      return list.filter((m) => m.tags.includes(tag));
    }
    return list;
  };

  const browseList = filterMemoriesByBrowse(visibleMemories);

  return (
    <div className="flex min-h-0 flex-1 bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
        {/* Project header */}
        <div className="border-b border-[var(--border)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Oral History</div>
              <h2 className="mt-0.5 text-base font-bold">资料库</h2>
            </div>
            <button onClick={() => void createLibraryProject()} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-purple-500/20">新项目</button>
          </div>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="control w-full text-sm">
            <option value="">选择资料库项目</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>

        {/* Browse mode switcher - modern segmented control */}
        <div className="border-b border-[var(--border)] p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {browseModes.map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => { setBrowseMode(mode); setSelectedChapterId(''); setChapterWithDrafts(null); setSelectedId(''); }}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                  browseMode === mode
                    ? 'bg-[var(--accent)] text-white shadow-sm shadow-purple-500/20'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Filters & search */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {browseMode === 'list' && (
            <>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input className="control w-full pl-9 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词、人物、地点..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="control w-full text-xs" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">全部状态</option>
                  {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
                <select className="control w-full text-xs" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as typeof timeFilter)}>
                  <option value="all">全部时间</option>
                  <option value="dated">已标注时间</option>
                  <option value="undated">未标注时间</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} className="rounded border-[var(--border)] bg-[var(--bg-tertiary)]" />
                显示已删除
              </label>
            </>
          )}

          {/* Browse-mode-specific sub-lists */}
          {browseMode === 'people' && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">选择人物</div>
              {peopleList.map((person) => (
                <button key={person} onClick={() => setSelectedId(person)} className={`w-full text-left rounded-lg px-3 py-2 text-sm transition ${selectedId === person ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  {person}
                </button>
              ))}
              {peopleList.length === 0 && <p className="text-xs text-[var(--text-secondary)]">暂无人物数据</p>}
            </div>
          )}
          {browseMode === 'locations' && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">选择地点</div>
              {locationsList.map((loc) => (
                <button key={loc} onClick={() => setSelectedId(loc)} className={`w-full text-left rounded-lg px-3 py-2 text-sm transition ${selectedId === loc ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  {loc}
                </button>
              ))}
              {locationsList.length === 0 && <p className="text-xs text-[var(--text-secondary)]">暂无地点数据</p>}
            </div>
          )}
          {browseMode === 'tags' && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">选择标签</div>
              <div className="flex flex-wrap gap-1.5">
                {tagsList.map((tag) => (
                  <button key={tag} onClick={() => setSelectedId(tag)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${selectedId === tag ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                    #{tag}
                  </button>
                ))}
              </div>
              {tagsList.length === 0 && <p className="text-xs text-[var(--text-secondary)]">暂无标签数据</p>}
            </div>
          )}
          {browseMode === 'chapters' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-[var(--text-secondary)]">章节列表</div>
                <button onClick={() => void createChapter()} className="text-[10px] font-medium text-[var(--accent)] hover:underline">+ 新建</button>
              </div>
              {chapters.map((chapter) => (
                <button key={chapter.id} onClick={() => { setSelectedChapterId(chapter.id); void loadChapterWithDrafts(chapter.id); }} className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition border ${selectedChapterId === chapter.id ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)] font-medium' : 'border-transparent text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  <div className="truncate">{chapter.title}</div>
                </button>
              ))}
              {chapters.length === 0 && <p className="text-xs text-[var(--text-secondary)]">暂无章节</p>}
            </div>
          )}

          {/* Memory list */}
          {(browseMode === 'list' || browseMode === 'people' || browseMode === 'locations' || browseMode === 'tags') && (
            <div className="space-y-1.5 pt-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {browseMode === 'list' ? '记忆列表' : `相关记忆 (${browseList.length})`}
              </div>
              {browseList.map((memory) => (
                <button key={memory.id} onClick={() => void selectMemory(memory.id)} className={`group w-full rounded-xl border p-3 text-left transition-all ${selectedId === memory.id ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5 shadow-sm' : 'border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                    {memory.audioCount > 0 && <span className="shrink-0 text-[10px] opacity-60">🎙</span>}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{memory.eventDateText || formatDate(memory.audioRecordedAt)}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusStyle(memory.status)}`}>{statusLabel(memory.status)}</span>
                    {memory.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-300">#{tag}</span>)}
                  </div>
                </button>
              ))}
              {browseList.length === 0 && (
                <div className="text-center py-6 text-xs text-[var(--text-secondary)]">
                  {browseMode === 'list' ? '暂无记忆' : '没有符合条件的记忆'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="border-t border-[var(--border)] p-3 flex gap-2">
          <button onClick={() => void createEmptyMemory()} className="flex-1 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--border)] transition flex items-center justify-center gap-1.5">
            {icons.pen}
            新建记忆
          </button>
          <button onClick={() => void (recording ? stopRecording() : startRecording())} disabled={transcribing} className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50 transition flex items-center justify-center gap-1.5 ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
            {transcribing ? (
              <><span className="inline-block h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />转写中...</>
            ) : recording ? (
              <><span className="h-2 w-2 rounded-full bg-white animate-pulse" />停止录音</>
            ) : (
              <>{icons.play}录制口述</>
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {notice && (
          <div className="mb-4 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-4 py-3 text-sm text-[var(--text-primary)] flex items-center gap-2 animate-fade-in">
            <span className="text-[var(--accent)] text-lg">ℹ</span>
            {notice}
          </div>
        )}
        {browseMode === 'chapters' && chapterDetail ? (
          <ChapterView
            chapter={chapterDetail}
            projectId={projectId}
            onSelectMemory={(id) => { setBrowseMode('list'); void selectMemory(id); }}
            onRemoveMemory={(chapterId, memoryId) => { void (async () => { await invoke('remove_memory_from_chapter', { chapterId, memoryId }); await loadChapterWithDrafts(chapterId); })(); }}
            onBack={() => { setSelectedChapterId(''); setChapterWithDrafts(null); }}
            onChapterUpdated={() => void loadChapterWithDrafts(chapterDetail.id)}
          />
        ) : !detail ? (
          <div className="flex h-full items-center justify-center text-center text-[var(--text-secondary)]">
            <div className="max-w-sm">
              <div className="text-5xl mb-4">🎙️</div>
              <p className="text-lg font-medium text-[var(--text-primary)]">选择一条记忆，或开始录制新的口述</p>
              <p className="mt-2 text-sm leading-relaxed">原始音频和原始转写会被永久保留。<br/>后续编辑都会创建新版本，不会覆盖原始素材。</p>
            </div>
          </div>
        ) : (
          <MemoryEditor
            detail={detail}
            textDraft={textDraft}
            setTextDraft={setTextDraft}
            setDetail={setDetail}
            saveMetadata={saveMetadata}
            saveWorkingText={saveWorkingText}
            restoreVersion={restoreVersion}
            deleteVersion={deleteVersion}
            removeMemory={removeMemory}
            restoreMemory={restoreMemory}
            loadDetail={loadDetail}
            chapters={chapters}
            onAddToChapter={addMemoryToChapter}
            onRemoveFromChapter={removeMemoryFromChapter}
          />
        )}
      </main>
    </div>
  );
}
'''

with open(path, 'a', encoding='utf-8') as f:
    f.write(content)
print('OK part2')
