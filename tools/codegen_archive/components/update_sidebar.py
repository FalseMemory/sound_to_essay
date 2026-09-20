
path = r'F:/AI/sound_to_essay/src/components/LibraryView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the entire sidebar content (from project select div to </aside>)
old_sidebar = '''    <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Oral History</div>
            <h2 className="mt-0.5 text-base font-bold">资料库</h2>
          </div>
          <button onClick={() => void createLibraryProject()} className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition">新项目</button>
        </div>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="control w-full text-sm">
          <option value="">选择资料库项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </div>
      <div className="space-y-2 border-b border-[var(--border)] p-3">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input className="control w-full pl-8 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词、人物、地点…" />
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
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button onClick={() => void createEmptyMemory()} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--border)] transition">新建记忆</button>
        <button onClick={() => void (recording ? stopRecording() : startRecording())} disabled={transcribing} className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium text-white disabled:opacity-50 transition ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
          {transcribing ? '转写中…' : recording ? '停止录音' : '录制口述'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {visibleMemories.map((memory) => (
          <button key={memory.id} onClick={() => void selectMemory(memory.id)} className={`group w-full rounded-lg border p-3 text-left transition-all ${selectedId === memory.id ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 shadow-sm' : 'border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]'}`}>
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
        {projectId && visibleMemories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="text-2xl mb-2">📝</div>
            <p className="text-xs text-[var(--text-secondary)]">还没有符合条件的记忆</p>
            <p className="mt-1 text-[10px] text-[var(--text-secondary)]">点击「录制口述」或「新建记忆」开始积累</p>
          </div>
        )}
      </div>
    </aside>'''

new_sidebar = '''    <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="border-b border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Oral History</div>
            <h2 className="mt-0.5 text-base font-bold">资料库</h2>
          </div>
          <button onClick={() => void createLibraryProject()} className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition">新项目</button>
        </div>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="control w-full text-sm">
          <option value="">选择资料库项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </div>
      <div className="flex gap-1 border-b border-[var(--border)] p-2 overflow-x-auto">
        {([['list','列表'],['people','人物'],['locations','地点'],['tags','标签'],['chapters','章节']] as const).map(([mode,label]) => (
          <button key={mode} onClick={() => { setBrowseMode(mode); setSelectedChapterId(''); setChapterDetail(null); }} className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition ${browseMode === mode ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}>{label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {browseMode === 'list' && (
          <div className="p-2 space-y-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input className="control w-full pl-8 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词、人物、地点…" />
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
            <div className="space-y-1 pt-1">
              {visibleMemories.map((memory) => (
                <button key={memory.id} onClick={() => void selectMemory(memory.id)} className={`group w-full rounded-lg border p-3 text-left transition-all ${selectedId === memory.id ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 shadow-sm' : 'border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]'}`}>
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
              {projectId && visibleMemories.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">还没有符合条件的记忆</p>}
            </div>
          </div>
        )}
        {browseMode === 'people' && (
          <div className="p-2 space-y-1">
            {peopleList.map((name) => (
              <button key={name} onClick={() => { setFilterValue(name); void (async () => { const result = await invoke<MemorySummary[]>('list_memories_by_filter', { projectId, filterType: 'person', filterValue: name }); setMemories(result); setBrowseMode('list'); })(); }} className="w-full rounded-lg border border-transparent p-2.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)] transition">
                {name}
              </button>
            ))}
            {peopleList.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">暂无人物数据</p>}
          </div>
        )}
        {browseMode === 'locations' && (
          <div className="p-2 space-y-1">
            {locationsList.map((name) => (
              <button key={name} onClick={() => { setFilterValue(name); void (async () => { const result = await invoke<MemorySummary[]>('list_memories_by_filter', { projectId, filterType: 'location', filterValue: name }); setMemories(result); setBrowseMode('list'); })(); }} className="w-full rounded-lg border border-transparent p-2.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)] transition">
                {name}
              </button>
            ))}
            {locationsList.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">暂无地点数据</p>}
          </div>
        )}
        {browseMode === 'tags' && (
          <div className="p-2 space-y-1">
            {tagsList.map((name) => (
              <button key={name} onClick={() => { setFilterValue(name); void (async () => { const result = await invoke<MemorySummary[]>('list_memories_by_filter', { projectId, filterType: 'tag', filterValue: name }); setMemories(result); setBrowseMode('list'); })(); }} className="w-full rounded-lg border border-transparent p-2.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)] transition">
                #{name}
              </button>
            ))}
            {tagsList.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">暂无标签数据</p>}
          </div>
        )}
        {browseMode === 'chapters' && (
          <div className="p-2 space-y-2">
            <button onClick={() => void createChapter()} className="w-full rounded-lg border border-[var(--accent)]/40 px-3 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">+ 新建章节</button>
            <div className="space-y-1">
              {chapters.map((chapter) => (
                <button key={chapter.id} onClick={() => { setSelectedChapterId(chapter.id); void loadChapterDetail(chapter.id); }} className={`w-full rounded-lg border p-3 text-left transition ${selectedChapterId === chapter.id ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10' : 'border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]'}`}>
                  <div className="text-sm font-medium text-[var(--text-primary)]">{chapter.title}</div>
                  <div className="mt-1 text-[10px] text-[var(--text-secondary)]">顺序 {chapter.sortOrder}</div>
                </button>
              ))}
              {chapters.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-secondary)]">还没有章节</p>}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
        <button onClick={() => void createEmptyMemory()} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--border)] transition">新建记忆</button>
        <button onClick={() => void (recording ? stopRecording() : startRecording())} disabled={transcribing} className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium text-white disabled:opacity-50 transition ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
          {transcribing ? '转写中…' : recording ? '停止录音' : '录制口述'}
        </button>
      </div>
    </aside>'''

content = content.replace(old_sidebar, new_sidebar)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Sidebar replaced')
