
path = r'F:/AI/sound_to_essay/src/components/LibraryView.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add load functions after loadDetail
old_loadDetail = '''  const loadDetail = async (memoryId: string) => {
    const result = await invoke<MemoryDetail | null>('get_memory', { memoryId });
    setDetail(result);
    const current = result?.textVersions.find((version) => version.isCurrent);
    setTextDraft(current?.content ?? '');
  };'''

new_loadDetail = '''  const loadDetail = async (memoryId: string) => {
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

  const loadChapterDetail = async (chapterId: string) => {
    const result = await invoke<ChapterDetail | null>('get_chapter', { chapterId });
    setChapterDetail(result);
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
  };'''

content = content.replace(old_loadDetail, new_loadDetail)

# 2. Update loadProjects to also load chapters and browse data
old_loadProjects = '''  const loadProjects = async () => {
    const result = await invoke<LibraryProject[]>('list_library_projects');
    setProjects(result);
    const firstId = result[0]?.id || '';
    const nextId = projectId || firstId;
    setProjectId(nextId);
    if (nextId) {
      await loadMemories(nextId);
    }
  };'''

new_loadProjects = '''  const loadProjects = async () => {
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
  };'''

content = content.replace(old_loadProjects, new_loadProjects)

# 3. Update projectId effect to also load chapters and browse data
old_effect = '''  useEffect(() => {
    if (!projectId) { setMemories([]); return; }
    void loadMemories(projectId).catch((error) => setNotice(`无法加载记忆：${String(error)}`));
  }, [projectId, showDeleted]);'''

new_effect = '''  useEffect(() => {
    if (!projectId) { setMemories([]); setChapters([]); return; }
    void loadMemories(projectId).catch((error) => setNotice(`无法加载记忆：${String(error)}`));
    void loadChapters(projectId).catch(() => {});
    void loadBrowseData(projectId).catch(() => {});
  }, [projectId, showDeleted]);'''

content = content.replace(old_effect, new_effect)

# 4. Add chapter handlers
old_removeMemory = '''  const removeMemory = async () => {
    if (!detail || !window.confirm('将此记忆移入可恢复的删除状态。确认继续？')) return;
    await invoke('delete_memory', { memoryId: detail.id });
    setDetail(null); setSelectedId('');
    await loadMemories(projectId);
  };'''

new_removeMemory = '''  const removeMemory = async () => {
    if (!detail || !window.confirm('将此记忆移入可恢复的删除状态。确认继续？')) return;
    await invoke('delete_memory', { memoryId: detail.id });
    setDetail(null); setSelectedId('');
    await loadMemories(projectId);
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
    setNotice('已从章节中移除。');
  };'''

content = content.replace(old_removeMemory, new_removeMemory)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Handlers added')
