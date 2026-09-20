import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { useSettingsStore } from '../stores/settingsStore';
import { ConfirmDialog } from './ConfirmDialog';
import type { BackupOutcome, Chapter, ChapterWithDrafts, ImportCandidate, ImportOutcome, LibraryProject, MemoryDetail, MemorySummary, PackImportOutcome, PackPreview, RestoreOutcome, RestorePreview, TextVersion, TranscriptionTask } from '../types';

const icons = {
  list: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  people: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  locations: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  tags: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  chapters: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  book: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>,
  pen: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  download: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  sparkle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  play: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  back: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>,
  timeline: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="14" r="2.5"/><circle cx="12" cy="21" r="2.5"/></svg>,
};

type Status = 'inbox' | 'pending' | 'organized' | 'in_chapter';
const statuses: { value: Status; label: string }[] = [
  { value: 'inbox', label: '收件箱' },
  { value: 'pending', label: '待整理' },
  { value: 'organized', label: '已整理' },
  { value: 'in_chapter', label: '已纳入章节' },
];

function statusLabel(status: string) {
  return statuses.find((item) => item.value === status)?.label ?? status;
}

function statusStyle(status: string) {
  const map: Record<string, string> = {
    inbox: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
    pending: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30',
    organized: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
    in_chapter: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  };
  return map[status] || 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-transparent';
}

/**
 * A1：转写状态徽标。`success` 不显示（记忆正文已有原始转写），
 * 其余状态都要让用户看见，并提供重新转写入口。
 */
function transcriptionBadge(task?: TranscriptionTask): { label: string; className: string } | null {
  if (!task) return null;
  switch (task.status) {
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

function splitNames(value: string) {
  return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value?: string) {
  if (!value) return '未标注时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dateSortValue(value?: string) {
  const parts = value?.match(/(\d{4})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/) ?? [];
  if (!parts[1]) return undefined;
  const year = Number(parts[1]);
  const month = Number(parts[2] || 1);
  const day = Number(parts[3] || 1);
  return year * 10000 + month * 100 + day;
}

/** Extract the 4-digit year from a memory (prefers the numeric sort key). */
function yearOf(memory: MemorySummary): number | undefined {
  if (typeof memory.eventDateSort === 'number' && memory.eventDateSort > 0) {
    return Math.floor(memory.eventDateSort / 10000);
  }
  const y = memory.eventDateText?.match(/(\d{4})/)?.[1];
  return y ? Number(y) : undefined;
}

/** A candidate memory suggested for a chapter, with the reason it matches. */
export type RelatedSuggestion = { memory: MemorySummary; reason: string };

/** Human-readable statement of how certain a memory's event time is. */
function timeCertainty(memory: MemorySummary): { label: string; uncertain: boolean } {
  if (!memory.eventDateText) return { label: '时间未标注', uncertain: true };
  if (memory.eventDatePrecision === 'unknown' || memory.eventDatePrecision === 'approx') {
    return { label: `时间约略（${memory.eventDateText}）`, uncertain: true };
  }
  return { label: `时间明确（${memory.eventDateText}）`, uncertain: false };
}

// 用户最近手动选择的资料库。列表按 updated_at 排序，"第一个项目"长期固定不变，
// 若每次都退回它，用户的选择就会被反复覆盖。持久化后即使组件重新挂载也能恢复。
const LIBRARY_SELECTION_KEY = 'sound_to_essay_library_project';

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
  const [browseMode, setBrowseMode] = useState<'list' | 'people' | 'locations' | 'tags' | 'chapters' | 'timeline'>('list');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [chapterDetail, setChapterWithDrafts] = useState<ChapterWithDrafts | null>(null);
  const [peopleList, setPeopleList] = useState<string[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [locationsList, setLocationsList] = useState<string[]>([]);
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false);
  const [showRemoveMemoryConfirm, setShowRemoveMemoryConfirm] = useState(false);
  // A1：转写任务状态来自数据库，不依赖内存中的临时变量，因此重启后仍能看到
  // "待转写 / 转写失败"并重新转写。
  const [tasks, setTasks] = useState<TranscriptionTask[]>([]);
  // A3：备份/恢复流程状态。
  const [backupNotice, setBackupNotice] = useState('');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreArchivePath, setRestoreArchivePath] = useState('');
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  // B1：导入音频流程状态。
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [importNotice, setImportNotice] = useState('');
  // B3：素材包导入状态。
  const [packPreview, setPackPreview] = useState<PackPreview | null>(null);
  const [packPath, setPackPath] = useState('');
  const [packNotice, setPackNotice] = useState('');
  // A3：加载记忆详情时保存一份原始快照，用于判断元数据是否有未保存改动。
  const [originalSnapshot, setOriginalSnapshot] = useState<MemoryDetail | null>(null);
  // A3：人物/地点/标签的选中值。与"选中的记忆"（selectedId）分离，
  // 这样按人物筛选后打开某条记忆，返回时筛选条件仍保持选中。
  const [browseFilter, setBrowseFilter] = useState('');

  const rememberLibrarySelection = (id: string) => {
    try { window.localStorage.setItem(LIBRARY_SELECTION_KEY, id); } catch { /* 隐私模式等写入失败可忽略 */ }
  };

  const loadProjects = async (preferId?: string) => {
    const result = await invoke<LibraryProject[]>('list_library_projects');
    setProjects(result);
    const available = new Set(result.map((item) => item.id));
    let remembered = '';
    try { remembered = window.localStorage.getItem(LIBRARY_SELECTION_KEY) ?? ''; } catch { /* ignore */ }
    // 选择优先级：显式指定 > 当前选择 > 上次记住的选择 > 第一个项目。
    // 关键点：只有候选值**确实存在于列表里**才沿用，否则才回退到第一个项目。
    // 旧实现直接 `projectId || result[0]`，而 result[0] 按 updated_at 排序长期固定，
    // 于是每次重载都可能把用户的选择拨回第一个项目，表现为下拉框来回跳。
    const nextId =
      [preferId, projectId, remembered].find((id) => !!id && available.has(id)) ??
      (result[0]?.id ?? '');
    setProjectId(nextId);
    if (nextId) {
      await loadMemories(nextId);
      await loadChapters(nextId);
      await loadBrowseData(nextId);
      await loadTasks(nextId);
    }
  };

  const loadTasks = async (targetProjectId: string) => {
    if (!targetProjectId) { setTasks([]); return; }
    const result = await invoke<TranscriptionTask[]>('list_transcription_tasks', { projectId: targetProjectId });
    setTasks(result);
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
    // A3：保存原始快照，用于未保存改动检测。
    setOriginalSnapshot(result ? JSON.parse(JSON.stringify(result)) as MemoryDetail : null);
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
    const result = await invoke<ChapterWithDrafts | null>('get_chapter_with_drafts', { chapterId });
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
    await loadProjects(created.id);
    setProjectId(created.id);
    rememberLibrarySelection(created.id);
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
      const audio = await invoke<{ audioPath: string; durationSecs: number; sampleRate: number }>('stop_recording');

      // A1：先登记"记忆 + 音频资产 + 待转写任务"，再执行转写。
      // 这样即使转写失败或应用崩溃，录音也已被引用，不会沦为待清理的孤儿文件。
      const registered = await invoke<{ memory: MemorySummary; task: TranscriptionTask }>('register_recording', {
        input: {
          projectId,
          audioPath: audio.audioPath,
          durationSecs: audio.durationSecs,
          sampleRate: audio.sampleRate,
          recordedAt: new Date().toISOString(),
          title: title?.trim() || undefined,
        },
      });
      await loadMemories(projectId);
      setSelectedId(registered.memory.id);
      await loadDetail(registered.memory.id);
      await loadTasks(projectId);
      setNotice('录音与原始音频已登记保存，正在转写…');

      try {
        const transcription = await invoke<{ text: string; confidence: number }>('transcribe_memory', {
          memoryId: registered.memory.id,
          modelSize: settings.whisperModel,
          language: settings.whisperLanguage,
          modelDir: settings.whisperModelDir || undefined,
        });
        await loadDetail(registered.memory.id);
        await loadTasks(projectId);
        setNotice(`转写完成，已保存 ${transcription.text.length} 字原始转写。`);
      } catch (error) {
        // 转写失败不丢资料：记忆与原始音频都已登记，列表里可直接重新转写。
        await loadTasks(projectId);
        setNotice(`转写失败：${String(error)}。录音与记忆已保留，可点击「重新转写」重试。`);
      }
    } catch (error) {
      setNotice(`录音保存失败：${String(error)}`);
    } finally {
      setTranscribing(false);
    }
  };

  /** A1：对某条记忆重新转写（待转写 / 转写失败均可）。 */
  const retryTranscription = async (memoryId: string) => {
    setTranscribing(true);
    try {
      const transcription = await invoke<{ text: string; confidence: number }>('transcribe_memory', {
        memoryId,
        modelSize: settings.whisperModel,
        language: settings.whisperLanguage,
        modelDir: settings.whisperModelDir || undefined,
      });
      await loadDetail(memoryId);
      await loadTasks(projectId);
      setNotice(`重新转写完成，已保存 ${transcription.text.length} 字原始转写。`);
    } catch (error) {
      await loadTasks(projectId);
      setNotice(`重新转写失败：${String(error)}。录音仍然保留，可稍后再试。`);
    } finally {
      setTranscribing(false);
    }
  };

  const taskForMemory = (memoryId: string) => tasks.find((task) => task.memoryId === memoryId && task.status !== 'success') ?? tasks.find((task) => task.memoryId === memoryId);

  // A3：未保存保护。正文草稿或元数据被改动但尚未保存时，关闭/刷新页面要给提示。
  const currentVersionContent = detail?.textVersions.find((v) => v.isCurrent)?.content ?? '';
  const metadataDirty = !!detail && !!originalSnapshot && (
    detail.title !== originalSnapshot.title
    || (detail.location ?? '') !== (originalSnapshot.location ?? '')
    || (detail.notes ?? '') !== (originalSnapshot.notes ?? '')
    || detail.eventDateText !== originalSnapshot.eventDateText
    || detail.status !== originalSnapshot.status
    || detail.tags.join('') !== originalSnapshot.tags.join('')
    || detail.people.join('') !== originalSnapshot.people.join('')
  );
  const hasUnsavedChanges = !!detail && (
    textDraft !== currentVersionContent || metadataDirty
  );
  useUnsavedGuard(hasUnsavedChanges, '[data-memory-editor]');

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // --- A3: backup & restore ---

  const createBackup = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filePath = await save({
        filters: [{ name: '声文备份', extensions: ['svbak'] }],
        defaultPath: `声文备份-${stamp}.svbak`,
      });
      if (!filePath) return;
      setBackupNotice('正在创建备份…');
      const outcome = await invoke<BackupOutcome>('create_full_backup', { archivePath: filePath });
      setBackupNotice(`备份完成：${outcome.audioCount} 个音频，数据库 ${(outcome.databaseBytes / 1024).toFixed(1)} KB。`);
    } catch (error) {
      setBackupNotice(`备份失败：${String(error)}`);
    }
  };

  const chooseRestoreFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: '声文备份', extensions: ['svbak'] }],
        multiple: false,
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) return;
      setBackupNotice('正在校验备份…');
      const preview = await invoke<RestorePreview>('validate_backup', { archivePath: filePath });
      setRestoreArchivePath(filePath);
      setRestorePreview(preview);
      setBackupNotice('');
    } catch (error) {
      setRestorePreview(null);
      setRestoreArchivePath('');
      setBackupNotice(`备份校验失败：${String(error)}`);
    }
  };

  const requestRestore = () => {
    if (!restorePreview) return;
    setShowRestoreConfirm(true);
  };

  // --- B1: import audio ---

  const chooseImportFiles = async () => {
    if (!projectId) { setImportNotice('请先创建或选择一个资料库项目。'); return; }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [
          {
            name: '音频文件',
            // 列表刻意放宽：能否真正处理由 audio_probe / convert_audio 的多后端探测决定，
            // 这里只是方便用户在文件选择器里看到自己的文件。
            extensions: [
              'wav', 'wave', 'mp3', 'mp2', 'm4a', 'm4b', 'mp4', 'aac',
              'ogg', 'oga', 'opus', 'flac', 'webm', 'amr', 'awb', 'wma',
              'aiff', 'aif', 'aifc', 'caf', 'au', 'snd', '3gp', '3gpp',
              'ape', 'wv', 'gsm', 'sln', 'ac3', 'dts',
            ],
          },
        ],
        multiple: true,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setImportNotice('正在探测音频…');
      const candidates: ImportCandidate[] = [];
      for (const path of paths) {
        candidates.push(await invoke<ImportCandidate>('inspect_import_file', { sourcePath: path }));
      }
      setImportCandidates(candidates);
      setImportNotice('');
    } catch (error) {
      setImportNotice(`选择文件失败：${String(error)}`);
    }
  };

  // --- B3: pack import ---

  const choosePackFile = async () => {
    if (!projectId) { setPackNotice('请先创建或选择一个资料库项目。'); return; }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: '声文素材包', extensions: ['svpack'] }],
        multiple: false,
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) return;
      setPackNotice('正在校验素材包…');
      const preview = await invoke<PackPreview>('preview_pack', { projectId, packPath: filePath });
      setPackPath(filePath);
      setPackPreview(preview);
      setPackNotice('');
    } catch (error) {
      setPackPreview(null);
      setPackPath('');
      setPackNotice(`素材包校验失败：${String(error)}`);
    }
  };

  const runPackImport = async () => {
    if (!projectId || !packPath) return;
    try {
      setPackNotice('正在导入素材包…');
      const outcome = await invoke<PackImportOutcome>('import_pack', {
        projectId,
        packPath,
      });
      setPackPreview(null);
      setPackPath('');
      setPackNotice(
        `导入完成：新增 ${outcome.imported}，更新 ${outcome.updated}，跳过重复 ${outcome.skippedDuplicates}，冲突保留双方 ${outcome.conflictsKeptBoth}，写入音频 ${outcome.audioWritten}。`
        + (outcome.missingAudio > 0 ? ` 注意：${outcome.missingAudio} 个音频缺失未导入。` : '')
      );
      await loadMemories(projectId);
      await loadTasks(projectId);
    } catch (error) {
      setPackNotice(`素材包导入失败：${String(error)}`);
    }
  };

  const runImport = async (candidate: ImportCandidate) => {
    if (!projectId) { setImportNotice('请先选择一个资料库项目。'); return; }
    try {
      setImportNotice(`正在导入 ${candidate.fileName}…`);
      const outcome = await invoke<ImportOutcome>('import_audio_file', {
        projectId,
        sourcePath: candidate.sourcePath,
      });
      setImportNotice(`已导入 ${candidate.fileName}，登记为记忆并创建待转写任务。`);
      setImportCandidates((prev) => prev.filter((item) => item.sourcePath !== candidate.sourcePath));
      await loadMemories(projectId);
      await loadTasks(projectId);
      setSelectedId(outcome.memoryId);
      await loadDetail(outcome.memoryId);
    } catch (error) {
      setImportNotice(`导入 ${candidate.fileName} 失败：${String(error)}`);
    }
  };

  const confirmRestore = async () => {
    setShowRestoreConfirm(false);
    if (!restoreArchivePath) return;
    try {
      // 恢复前先把当前数据库备份到音频目录旁的"后悔药"路径。
      const safetyPath = `pre-restore-${Date.now()}.sqlite3`;
      const outcome = await invoke<RestoreOutcome>('restore_full_backup', {
        archivePath: restoreArchivePath,
        currentDbBackupPath: safetyPath,
      });
      setRestorePreview(null);
      setRestoreArchivePath('');
      setBackupNotice(`恢复完成：${outcome.audioRestored} 个音频已恢复，数据库已替换。当前数据库已先备份到 ${safetyPath}。请重启应用以重新加载资料库。`);
      await loadProjects();
    } catch (error) {
      setBackupNotice(`恢复失败：${String(error)}`);
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
    // A2：原始转写与"被历史草稿引用的版本"受保护，后端会拒绝删除。
    if (!window.confirm('确定删除这个版本？删除后不可恢复。\n（原始转写、以及被历史草稿引用为来源的版本无法删除。）')) return;
    try {
      await invoke('delete_text_version', { versionId });
      await loadDetail(detail.id);
      setNotice('版本已删除。');
    } catch (error) {
      // 保护规则触发的拒绝要如实告诉用户原因，而不是静默失败。
      setNotice(String(error));
    }
  };

  const removeMemory = () => {
    setShowRemoveMemoryConfirm(true);
  };

  const confirmRemoveMemory = async () => {
    setShowRemoveMemoryConfirm(false);
    if (!detail) return;
    await invoke('delete_memory', { memoryId: detail.id });
    setDetail(null); setSelectedId('');
    await loadMemories(projectId);
  };

  const deleteLibraryProject = () => {
    if (!projectId) return;
    setShowDeleteProjectConfirm(true);
  };

  const confirmDeleteLibraryProject = async () => {
    setShowDeleteProjectConfirm(false);
    const targetId = projectId;
    if (!targetId) return;
    try {
      await invoke('delete_library_project', { projectId: targetId });
      const result = await invoke<LibraryProject[]>('list_library_projects');
      setProjects(result);
      const nextId = result[0]?.id || '';
      setProjectId(nextId);
      rememberLibrarySelection(nextId);
      setDetail(null); setSelectedId(''); setSelectedChapterId(''); setChapterWithDrafts(null);
      if (nextId) {
        await loadMemories(nextId);
        await loadChapters(nextId);
        await loadBrowseData(nextId);
      } else {
        setMemories([]); setChapters([]);
      }
      setNotice('项目已删除。');
    } catch (error) {
      setNotice(`删除项目失败：${String(error)}`);
    }
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

  const exportBook = async () => {
    if (!projectId) { setNotice('请先选择一个资料库项目。'); return; }
    try {
      const markdown = await invoke<string>('generate_book_markdown', { projectId });
      if (!markdown.trim()) { setNotice('没有可导出的内容。'); return; }
      const { save } = await import('@tauri-apps/plugin-dialog');
      const projectName = projects.find((project) => project.id === projectId)?.name || '回忆录';
      const filePath = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: `${projectName}.md`,
      });
      if (!filePath) return;
      await invoke('export_file', { path: filePath, content: markdown });
      setNotice('整本回忆录已导出。');
    } catch (error) {
      setNotice(`导出失败：${String(error)}`);
    }
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
    { mode: 'timeline', label: '时间线', icon: icons.timeline },
  ];

  const filterMemoriesByBrowse = (list: MemorySummary[]) => {
    if (browseMode === 'list') return list;
    if (browseMode === 'people') {
      if (!browseFilter) return [];
      return list.filter((m) => m.people.includes(browseFilter));
    }
    if (browseMode === 'locations') {
      if (!browseFilter) return [];
      return list.filter((m) => m.location === browseFilter);
    }
    if (browseMode === 'tags') {
      if (!browseFilter) return [];
      return list.filter((m) => m.tags.includes(browseFilter));
    }
    return list;
  };

  const browseList = filterMemoriesByBrowse(visibleMemories);

  return (
    <div className="flex min-h-0 flex-1 bg-[var(--bg-primary)]">
      <ConfirmDialog
        open={showDeleteProjectConfirm}
        title="删除项目"
        danger
        confirmLabel="删除项目"
        message={(
          <>
            确定删除资料库项目「<span className="font-semibold text-[var(--text-primary)]">{projects.find((p) => p.id === projectId)?.name}</span>」吗？
            该项目下的<span className="font-semibold">全部记忆、章节与草稿将一并永久删除</span>，且不可恢复。
          </>
        )}
        onConfirm={() => void confirmDeleteLibraryProject()}
        onCancel={() => setShowDeleteProjectConfirm(false)}
      />
      <ConfirmDialog
        open={showRemoveMemoryConfirm}
        title="移入回收站"
        danger
        confirmLabel="移入回收站"
        message="确定将这条记忆移入回收站吗？移入后仍可在「显示已删除」中恢复。"
        onConfirm={() => void confirmRemoveMemory()}
        onCancel={() => setShowRemoveMemoryConfirm(false)}
      />
      {/* A3：恢复备份的二次确认（替换式恢复，必须先确认） */}
      <ConfirmDialog
        open={showRestoreConfirm}
        title="恢复备份"
        danger
        confirmLabel="恢复备份"
        message={`确定用此备份替换当前资料库吗？\n\n备份时间：${restorePreview?.createdAt ?? ''}\n音频数量：${restorePreview?.audioCount ?? 0}\n\n恢复会替换当前数据库与音频，当前数据库会先备份到"后悔药"文件。此操作不可撤销。`}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setShowRestoreConfirm(false)}
      />
      {/* Sidebar */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)]">
        {/* Project header */}
        <div className="border-b border-[var(--border)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Oral History</div>
              <h2 className="mt-0.5 text-base font-bold">资料库</h2>
            </div>
            <button onClick={() => void createLibraryProject()} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20">新项目</button>
          </div>
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); rememberLibrarySelection(event.target.value); }} className="control w-full text-sm">
            <option value="">选择资料库项目</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {projectId && (
            <button
              onClick={() => deleteLibraryProject()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              title="删除当前资料库项目及其全部记忆与章节"
            >
              {icons.trash}
              删除当前项目
            </button>
          )}
        </div>

        {/* Browse mode switcher - modern segmented control */}
        <div className="border-b border-[var(--border)] p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {browseModes.map(({ mode, label, icon }) => (
              <button
                key={mode}
                onClick={() => { setBrowseMode(mode); setSelectedChapterId(''); setChapterWithDrafts(null); setSelectedId(''); setBrowseFilter(''); }}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                  browseMode === mode
                    ? 'bg-[var(--accent)] text-white shadow-sm shadow-blue-500/20'
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
            </>
          )}

          {/* 回收站开关：在记忆列表相关视图始终可见，确保「移入回收站」的记忆可被找回 */}
          {(browseMode === 'list' || browseMode === 'people' || browseMode === 'locations' || browseMode === 'tags' || browseMode === 'timeline') && (
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} className="rounded border-[var(--border)] bg-[var(--bg-tertiary)]" />
              显示已删除
            </label>
          )}

          {/* Browse-mode-specific sub-lists */}
          {browseMode === 'people' && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">选择人物</div>
              {peopleList.map((person) => (
                <button key={person} onClick={() => setBrowseFilter(person)} className={`w-full text-left rounded-lg px-3 py-2 text-sm transition ${browseFilter === person ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
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
                <button key={loc} onClick={() => setBrowseFilter(loc)} className={`w-full text-left rounded-lg px-3 py-2 text-sm transition ${browseFilter === loc ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
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
                  <button key={tag} onClick={() => setBrowseFilter(tag)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${browseFilter === tag ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
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
                <div className="flex items-center gap-2">
                  <button onClick={() => void exportBook()} title="导出整本回忆录为单个 Markdown" className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline">导出整本</button>
                  <button onClick={() => void createChapter()} className="text-[10px] font-medium text-[var(--accent)] hover:underline">+ 新建</button>
                </div>
              </div>

              {/* B1：导入音频入口 */}
              <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-[var(--text-secondary)]">导入音频</div>
                  <button onClick={() => void chooseImportFiles()} className="text-[10px] font-medium text-[var(--accent)] hover:underline">选择文件…</button>
                </div>
                {importNotice && <div className="text-[11px] text-[var(--text-secondary)] break-all">{importNotice}</div>}
                {importCandidates.map((candidate) => (
                  <div key={candidate.sourcePath} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">{candidate.fileName}</div>
                        <div className="text-[10px] text-[var(--text-secondary)]">
                          {candidate.format.toUpperCase()}
                          {candidate.durationSecs != null && ` · ${candidate.durationSecs.toFixed(1)}s`}
                          {candidate.sampleRate != null && ` · ${candidate.sampleRate}Hz`}
                          {candidate.alreadyImported && ' · 已导入'}
                        </div>
                      </div>
                      <button
                        onClick={() => void runImport(candidate)}
                        disabled={!!candidate.error || candidate.alreadyImported}
                        className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[var(--accent-hover)] transition disabled:opacity-40"
                      >
                        导入
                      </button>
                    </div>
                    {candidate.error && <div className="text-[10px] text-red-600 dark:text-red-300">{candidate.error}</div>}
                  </div>
                ))}
              </div>

              {/* B3：素材包导入入口 */}
              <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-[var(--text-secondary)]">导入素材包</div>
                  <button onClick={() => void choosePackFile()} className="text-[10px] font-medium text-[var(--accent)] hover:underline">选择素材包…</button>
                </div>
                {packNotice && <div className="text-[11px] text-[var(--text-secondary)] break-all">{packNotice}</div>}
                {packPreview && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2 space-y-1">
                    <div className="text-[11px] text-[var(--text-primary)]">
                      记录 {packPreview.recordCount} 条 · 音频 {packPreview.audioCount} 个
                      {packPreview.duplicates > 0 && ` · 重复 ${packPreview.duplicates}`}
                      {packPreview.conflicts > 0 && ` · 冲突 ${packPreview.conflicts}`}
                      {packPreview.missingAudio > 0 && ` · 缺失音频 ${packPreview.missingAudio}`}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      导出时间：{formatDate(packPreview.exportedAt)} · 协议 v{packPreview.formatVersion}
                    </div>
                    <button onClick={() => void runPackImport()} className="rounded-lg bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition">
                      导入此素材包
                    </button>
                  </div>
                )}
              </div>

              {/* A3：备份与恢复入口 */}
              <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-[var(--text-secondary)]">备份与恢复</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => void createBackup()} className="text-[10px] font-medium text-[var(--accent)] hover:underline">创建备份</button>
                    <button onClick={() => void chooseRestoreFile()} className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline">恢复…</button>
                  </div>
                </div>
                {backupNotice && <div className="text-[11px] text-[var(--text-secondary)] break-all">{backupNotice}</div>}
                {restorePreview && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2 space-y-1">
                    <div className="text-[11px] text-[var(--text-primary)]">
                      备份时间：{formatDate(restorePreview.createdAt)} · 音频 {restorePreview.audioCount} 个
                      {restorePreview.audioMissingLocally > 0 && ` · 本地缺失 ${restorePreview.audioMissingLocally} 个`}
                    </div>
                    <button onClick={() => requestRestore()} className="rounded-lg bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition">
                      恢复此备份
                    </button>
                  </div>
                )}
              </div>
              {chapters.map((chapter) => (
                <button key={chapter.id} onClick={() => { setSelectedChapterId(chapter.id); void loadChapterWithDrafts(chapter.id); }} className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition border ${selectedChapterId === chapter.id ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)] font-medium' : 'border-transparent text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  <div className="truncate">{chapter.title}</div>
                </button>
              ))}
              {chapters.length === 0 && <p className="text-xs text-[var(--text-secondary)]">暂无章节</p>}
            </div>
          )}

          {browseMode === 'timeline' && (
            <TimelineView memories={visibleMemories} onSelect={(id) => void selectMemory(id)} />
          )}

          {/* Memory list */}
          {(browseMode === 'list' || browseMode === 'people' || browseMode === 'locations' || browseMode === 'tags') && (
            <div className="space-y-1.5 pt-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {browseMode === 'list' ? '记忆列表' : `相关记忆 (${browseList.length})`}
              </div>
              {browseList.map((memory) => {
                const badge = transcriptionBadge(taskForMemory(memory.id));
                return (
                  <button key={memory.id} onClick={() => void selectMemory(memory.id)} className={`group w-full rounded-xl border p-3 text-left transition-all ${selectedId === memory.id ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5 shadow-sm' : 'border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                      {memory.audioCount > 0 && <span className="shrink-0 text-[10px] opacity-60">🎙</span>}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{memory.eventDateText || formatDate(memory.audioRecordedAt)}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusStyle(memory.status)}`}>{statusLabel(memory.status)}</span>
                      {badge && <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>}
                      {memory.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">#{tag}</span>)}
                    </div>
                  </button>
                );
              })}
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
          <button onClick={() => void createEmptyMemory()} className="flex-1 rounded-xl bg-[var(--bg-tertiary)] px-4 py-3.5 text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--border)] transition flex items-center justify-center gap-2 shadow-sm">
            {icons.pen}
            新建记忆
          </button>
          <button onClick={() => void (recording ? stopRecording() : startRecording())} disabled={transcribing} className={`flex-1 rounded-xl px-4 py-3.5 text-sm font-bold text-white disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-sm ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
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
            task={taskForMemory(detail.id)}
            retryTranscription={() => void retryTranscription(detail.id)}
            transcribing={transcribing}
          />
        )}
      </main>
    </div>
  );
}

function LazyAudioPlayer({ audio }: { audio: { id: string; filePath: string; durationSecs?: number; originalFilename?: string; sourceFormat?: string } }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const base64 = await invoke<string>('read_audio_file', { filePath: audio.filePath });
        if (!cancelled) {
          setSrc(`data:audio/wav;base64,${base64}`);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(`加载音频失败: ${String(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [audio.filePath]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div className="min-w-0 flex-1">
          {/* B1：导入音频优先显示原始文件名，便于溯源 */}
          <div className="truncate text-xs font-medium">{audio.originalFilename || audio.filePath.split("\\").pop()}</div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            {audio.sourceFormat ? `${audio.sourceFormat.toUpperCase()} · ` : ''}
            {audio.durationSecs !== undefined ? `${audio.durationSecs.toFixed(1)} 秒` : ''}
          </div>
        </div>
      </div>
      {loading && <p className="mt-3 text-xs text-[var(--text-secondary)]">加载中...</p>}
      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {src && <audio className="mt-3 w-full" controls src={src} />}
    </div>
  );
}

function AIProcessor({ memoryId, versionId, onDone }: { memoryId: string; versionId?: string; onDone: () => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const [processingType, setProcessingType] = useState<'correct' | 'summarize' | 'extract' | 'polish' | 'rewrite'>('polish');
  const [tier, setTier] = useState<'faithful' | 'creative'>('faithful');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  // 文学化改写天生是创作档；其余类型由用户选择保真 / 创作。
  const effectiveTier: 'faithful' | 'creative' = processingType === 'rewrite' ? 'creative' : tier;
  const tierLocked = processingType === 'rewrite';

  const config = settings.llm?.polish;
  const isConfigured = !!(config?.baseUrl && config?.modelName);

  useEffect(() => {
    if (isProcessing) {
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [isProcessing]);

  const handleProcess = async () => {
    if (!isConfigured) { setNotice('LLM 未配置，请先在设置中填写 API 信息。'); return; }
    setIsProcessing(true); setNotice('');
    try {
      await invoke('ai_process_memory', {
        memoryId,
        versionId: versionId || null,
        processingType,
        tier: effectiveTier,
        config,
      });
      setNotice(effectiveTier === 'creative'
        ? 'AI 整理完成（文学化改写·创作性结果），已保存为新版本，请核对事实。'
        : 'AI 整理完成，已保存为新版本。');
      onDone();
    } catch (e) {
      setNotice(`整理失败：${String(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const providerLabel = config?.baseUrl?.includes('localhost') || config?.baseUrl?.includes('127.0.0.1') ? '本地 Ollama' : '远程 API';

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <select className="control text-xs" value={processingType} onChange={(event) => setProcessingType(event.target.value as typeof processingType)} disabled={isProcessing}>
        <option value="correct">只修正口语和错字</option>
        <option value="summarize">压缩成摘要</option>
        <option value="extract">提炼人物/时间/地点/事件</option>
        <option value="polish">事实整理（分段+去冗余）</option>
        <option value="rewrite">文学化改写（创作性）</option>
      </select>
      <div className="flex items-center rounded-lg bg-[var(--bg-tertiary)] p-0.5 text-xs" title={tierLocked ? '文学化改写强制为创作档' : '选择整理档位'}>
        <button
          type="button"
          onClick={() => !tierLocked && setTier('faithful')}
          disabled={tierLocked}
          className={`px-2.5 py-1.5 rounded-md transition ${effectiveTier === 'faithful' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'} ${tierLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
          title="校订·保真：仅修正错字，保留口述者的语气词、方言与口头禅"
        >
          校订·保真
        </button>
        <button
          type="button"
          onClick={() => !tierLocked && setTier('creative')}
          disabled={tierLocked}
          className={`px-2.5 py-1.5 rounded-md transition ${effectiveTier === 'creative' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'} ${tierLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
          title="文学化改写·创作：允许润色删减与重组；输出属创作性结果，请核对事实"
        >
          文学化改写
        </button>
      </div>
      <button onClick={() => void handleProcess()} disabled={isProcessing || !isConfigured} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition flex items-center gap-2 ${isProcessing || !isConfigured ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
        {isProcessing && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
        {isProcessing ? `整理中（${elapsed}s）` : '开始整理'}
      </button>
    </div>
    {isProcessing && <div className="text-xs text-[var(--text-secondary)]">正在连接模型并等待响应，请勿关闭应用...</div>}
    {config?.modelName && !isProcessing && <div className="text-[10px] text-[var(--text-secondary)]">当前模型：{config.modelName} · {providerLabel}</div>}
    {!isConfigured && <div className="text-xs text-amber-600 dark:text-amber-400">⚠️ 请在「设置」中配置 LLM API 地址和模型名称后再使用 AI 整理。</div>}
    {notice && <div className={`text-xs ${notice.includes('失败') ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{notice}</div>}
  </div>;
}

function TimelineView({ memories, onSelect }: { memories: MemorySummary[]; onSelect: (id: string) => void }) {
  const groups = useMemo(() => {
    const byYear = new Map<number, MemorySummary[]>();
    const undated: MemorySummary[] = [];
    for (const m of memories) {
      const y = yearOf(m);
      if (y === undefined) { undated.push(m); continue; }
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(m);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const sorted = years.map((y) => ({
      year: y,
      items: (byYear.get(y) || []).sort(
        (a, b) => (dateSortValue(a.eventDateText) ?? 0) - (dateSortValue(b.eventDateText) ?? 0),
      ),
    }));
    return { sorted, undated };
  }, [memories]);

  if (memories.length === 0) {
    return <p className="px-1 py-2 text-xs text-[var(--text-secondary)]">没有可展示的记忆。先为记忆标注时间，或切换其它浏览方式。</p>;
  }

  return (
    <div className="space-y-4 py-1">
      {groups.sorted.map((group) => (
        <div key={group.year}>
          <div className="sticky top-0 z-10 -mx-1 mb-2 bg-[var(--bg-secondary)]/90 px-1 py-1 text-xs font-bold text-[var(--accent)] backdrop-blur">
            {group.year}
          </div>
          <div className="space-y-1.5 border-l border-[var(--border)] pl-3">
            {group.items.map((memory) => (
              <button key={memory.id} onClick={() => onSelect(memory.id)} className="group block w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                  {memory.eventDateText && <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">{memory.eventDateText}</span>}
                </div>
                {memory.location && <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">📍 {memory.location}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.undated.length > 0 && (
        <div>
          <div className="sticky top-0 z-10 -mx-1 mb-2 bg-[var(--bg-secondary)]/90 px-1 py-1 text-xs font-bold text-[var(--text-secondary)] backdrop-blur">未标注时间</div>
          <div className="space-y-1.5 border-l border-dashed border-[var(--border)] pl-3">
            {groups.undated.map((memory) => (
              <button key={memory.id} onClick={() => onSelect(memory.id)} className="group block w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                <div className="truncate text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">时间待补充</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChapterView({ chapter, onSelectMemory, onRemoveMemory, onBack, onChapterUpdated }: {
  chapter: ChapterWithDrafts;
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
  const [draftStyle, setDraftStyle] = useState('平实、忠实于口述者原意，保留真实语气与细节。');
  const [draftTier, setDraftTier] = useState<'faithful' | 'creative'>('faithful');
  const aiTimerRef = useRef<number | null>(null);
  const [suggestions, setSuggestions] = useState<RelatedSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const currentDraft = chapter.drafts.find((d) => d.isCurrent);
  const draftDirty = draftText !== (currentDraft?.content ?? '');
  useUnsavedGuard(draftDirty, '[data-chapter-editor]');
  const confirmDraftLeave = () => !draftDirty || window.confirm('章节草稿尚未保存，放弃修改并继续吗？');
  const uncertainCount = chapter.memories.filter((m) => timeCertainty(m).uncertain).length;

  useEffect(() => {
    setDraftText(currentDraft?.content ?? '');
  }, [chapter.id, currentDraft?.content]);

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
      // 人工撰写的草稿没有"生成来源"可言，故不记录来源与写作要求，
      // 避免伪造出并不存在的素材出处。
      await invoke('create_chapter_draft', {
        chapterId: chapter.id,
        content: draftText,
        draftType: 'manual',
        processingType: 'user_edit',
        provider: null,
        model: null,
        requirement: null,
        sources: [],
      });
      setExportNotice('草稿已保存。');
      setTimeout(() => setExportNotice(''), 2000);
      onChapterUpdated();
    } catch (e) {
      setExportNotice(`保存草稿失败：${String(e)}`);
    }
  };

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const result = await invoke<RelatedSuggestion[]>('suggest_related_memories', { chapterId: chapter.id });
      setSuggestions(result);
    } catch (e) {
      setExportNotice(`加载相关记忆失败：${String(e)}`);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const addSuggested = async (memoryId: string) => {
    try {
      await invoke('add_memory_to_chapter', { chapterId: chapter.id, memoryId });
      setSuggestions((prev) => prev.filter((s) => s.memory.id !== memoryId));
      onChapterUpdated();
      setExportNotice('已加入章节。');
      setTimeout(() => setExportNotice(''), 2000);
    } catch (e) {
      setExportNotice(`加入失败：${String(e)}`);
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
        memoryIds: chapter.memories.map((m) => m.id),
        style: draftStyle,
        tier: draftTier,
        config,
      });
      setAiNotice(draftTier === 'creative'
        ? 'AI 草稿生成完成（文学化改写·创作性），请核对事实后再采用。'
        : 'AI 草稿生成完成。');
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
      const header = `# ${chapter.title}\n\n> 来源：${chapter.memories.length} 条记忆\n> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
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
      // A2：只切换"当前草稿"指针，不再复制出一份内容相同的新草稿
      // （旧实现每次"恢复"都会新建副本，反复操作会让草稿数量无限增长）。
      await invoke('restore_chapter_draft', { draftId });
      onChapterUpdated();
    } catch (e) {
      setExportNotice(`切换失败：${String(e)}`);
    }
  };

  const config = settings.llm?.polish;
  const isConfigured = !!(config?.baseUrl && config?.modelName);
  const providerLabel = config?.baseUrl?.includes('localhost') || config?.baseUrl?.includes('127.0.0.1') ? '本地 Ollama' : '远程 API';

  return (
    <div data-chapter-editor className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { if (confirmDraftLeave()) onBack(); }} className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition border border-transparent hover:border-[var(--border)]">
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
              <button onClick={() => { if (confirmDraftLeave()) onSelectMemory(memory.id); }} className="min-w-0 text-left flex-1">
                <div className="text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{memory.eventDateText || formatDate(memory.audioRecordedAt)}</div>
              </button>
              <button onClick={() => onRemoveMemory(chapter.id, memory.id)} className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition font-medium">移除</button>
            </div>
          ))}
          {chapter.memories.length === 0 && <p className="text-sm text-[var(--text-secondary)]">此章节还没有关联记忆。</p>}
        </div>
      </section>

      {/* Source & uncertainty */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">来源与不确定性</h3>
        <p className="text-sm text-[var(--text-primary)]">
          本章共关联 <span className="font-semibold">{chapter.memories.length}</span> 条来源记忆，
          {chapter.memories.length > 0 && (
            <>其中 <span className={uncertainCount > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold text-emerald-600 dark:text-emerald-400'}>{uncertainCount}</span> 条的时间尚未确认（约略或未标注）。</>
          )}
        </p>
        {chapter.memories.length > 0 && (
          <div className="space-y-1.5">
            {chapter.memories.map((memory) => {
              const c = timeCertainty(memory);
              return (
                <div key={memory.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
                  <button onClick={() => onSelectMemory(memory.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{memory.title}</div>
                  </button>
                  <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium ${c.uncertain ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>{c.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {chapter.memories.length === 0 && <p className="text-sm text-[var(--text-secondary)]">关联来源记忆后，这里会列出每条记忆的时间确定性，帮助你在成稿时标注不确定性。</p>}
      </section>

      {/* Related memory suggestions */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">可能相关记忆</h3>
          <button onClick={() => void loadSuggestions()} disabled={loadingSuggestions} className="text-[10px] font-medium text-[var(--accent)] hover:underline disabled:opacity-50">
            {loadingSuggestions ? '加载中…' : '刷新候选'}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">根据本章已关联记忆的人物、标签、地点，推荐尚未纳入的相似记忆。</p>
        <div className="space-y-1.5">
          {suggestions.map((s) => (
            <div key={s.memory.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
              <button onClick={() => onSelectMemory(s.memory.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-[var(--text-primary)]">{s.memory.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{s.reason}</div>
              </button>
              <button onClick={() => void addSuggested(s.memory.id)} className="shrink-0 rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">加入</button>
            </div>
          ))}
          {suggestions.length === 0 && !loadingSuggestions && <p className="text-xs text-[var(--text-secondary)]">点击「刷新候选」获取建议，或当前暂无更多相似记忆。</p>}
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
        {exportNotice && <div className={`text-xs ${exportNotice.includes('失败') ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{exportNotice}</div>}
        <textarea
          className="control min-h-64 w-full leading-relaxed"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder="在此撰写章节草稿，或点击「AI 生成」根据素材自动创建..."
        />
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">AI 写作风格（可选）</label>
          <textarea
            className="control min-h-16 w-full text-xs leading-relaxed"
            value={draftStyle}
            onChange={(event) => setDraftStyle(event.target.value)}
            placeholder="例如：平实、忠实于口述者原意，保留真实语气与细节。"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">整理档位</label>
          <div className="flex items-center rounded-lg bg-[var(--bg-tertiary)] p-0.5 text-xs w-fit">
            <button
              type="button"
              onClick={() => setDraftTier('faithful')}
              className={`px-2.5 py-1.5 rounded-md transition ${draftTier === 'faithful' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              title="校订·保真：忠于口述原意，保留真实语气与细节，不虚构"
            >
              校订·保真
            </button>
            <button
              type="button"
              onClick={() => setDraftTier('creative')}
              className={`px-2.5 py-1.5 rounded-md transition ${draftTier === 'creative' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              title="文学化改写·创作：可润色重组、增强画面感；输出属创作性结果，请核对事实"
            >
              文学化改写
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-[var(--text-secondary)]">
            {currentDraft ? `当前草稿：${currentDraft.draftType} · ${formatDate(currentDraft.createdAt)}${currentDraft.model ? ` · ${currentDraft.model}` : ''}` : '暂无草稿'}
          </div>
          <button onClick={() => void aiGenerateDraft()} disabled={isAiGenerating || !isConfigured} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition flex items-center gap-2 ${isAiGenerating || !isConfigured ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600'}`}>
            {isAiGenerating && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {icons.sparkle}
            {isAiGenerating ? `生成中（${aiElapsed}s）` : 'AI 生成草稿'}
          </button>
        </div>
        {isAiGenerating && <div className="text-xs text-[var(--text-secondary)]">正在根据章节素材生成草稿，请勿关闭应用...</div>}
        {config?.modelName && !isAiGenerating && <div className="text-[10px] text-[var(--text-secondary)]">当前模型：{config.modelName} · {providerLabel}</div>}
        {!isConfigured && <div className="text-xs text-amber-600 dark:text-amber-400">⚠️ 请在「设置」中配置 LLM API 地址和模型名称后再使用 AI 生成。</div>}
        {aiNotice && <div className={`text-xs ${aiNotice.includes('失败') ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{aiNotice}</div>}
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
                    {draft.tier === 'creative' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">创作性</span>}
                    {draft.isCurrent && <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">当前</span>}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{formatDate(draft.createdAt)} · {draft.content.slice(0, 100) || '（空文本）'}</div>
                  {/* A2：来源必须读生成时记录下来的数据，而不是当前章节关联的记忆列表，
                      这样即便记忆被改名、版本被切换或已移出章节，旧草稿仍可追溯当时的输入。 */}
                  {draft.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                      <span>来源：</span>
                      {draft.sources.map((source) => (
                        <span
                          key={`${source.memoryId}-${source.textVersionId ?? 'none'}`}
                          className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-1.5 py-0.5"
                          title={source.textVersionId ? `文本版本 ID：${source.textVersionId}` : '生成时未记录文本版本'}
                        >
                          {source.memoryTitle || '（记忆已删除）'}
                          {source.versionType ? ` · ${source.versionType}` : ''}
                          {source.versionMissing ? ' ⚠️版本已不存在' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {draft.requirement && (
                    <div className="mt-1 truncate text-[10px] text-[var(--text-secondary)]" title={draft.requirement}>
                      写作要求：{draft.requirement}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {!draft.isCurrent && (
                    <button onClick={() => void switchDraft(draft.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/30 transition font-medium">
                      恢复
                    </button>
                  )}
                  <button onClick={() => void deleteDraft(draft.id)} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium">
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

function MemoryEditor({ detail, textDraft, setTextDraft, setDetail, saveMetadata, saveWorkingText, restoreVersion, deleteVersion, removeMemory, restoreMemory, loadDetail, chapters, onAddToChapter, onRemoveFromChapter, task, retryTranscription, transcribing }: {
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
  /** A1：该记忆的转写任务（若有）。用于展示状态并提供重新转写入口。 */
  task?: TranscriptionTask;
  retryTranscription: () => void;
  transcribing: boolean;
}) {
  const current = detail.textVersions.find((version) => version.isCurrent);
  const taskBadge = transcriptionBadge(task);
  const update = (patch: Partial<MemoryDetail>) => setDetail({ ...detail, ...patch } as MemoryDetail);

  return <div data-memory-editor className="mx-auto max-w-4xl space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{detail.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${statusStyle(detail.status)}`}>{statusLabel(detail.status)}</span>
          {taskBadge && <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${taskBadge.className}`}>{taskBadge.label}</span>}
          {detail.eventDateText && <span className="text-xs text-[var(--text-secondary)]">{detail.eventDateText}</span>}
          {detail.location && <span className="text-xs text-[var(--text-secondary)]">📍 {detail.location}</span>}
          {detail.deletedAt && <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] text-red-600 font-medium">已删除</span>}
        </div>
        {/* A1：转写失败时保留记忆与原始音频，这里给出失败原因与重试入口 */}
        {task?.status === 'failed' && task.error && (
          <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            上次转写失败：{task.error}
            <div className="mt-0.5 text-[11px] opacity-80">原始音频与这条记忆都已保留，可点击「重新转写」重试。</div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {task && task.status !== 'success' && (
          <button onClick={() => void retryTranscription()} disabled={transcribing} className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition disabled:opacity-50">
            {transcribing ? '转写中…' : task.status === 'failed' ? '重新转写' : '开始转写'}
          </button>
        )}
        {detail.deletedAt ? (
          <button onClick={() => void restoreMemory()} className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition">恢复</button>
        ) : (
          <button onClick={() => void removeMemory()} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition">移入回收站</button>
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
        <button onClick={() => void saveMetadata()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20">保存元数据</button>
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
        <button onClick={() => void saveWorkingText()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20 flex items-center gap-1.5">
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
            <button onClick={() => void onRemoveFromChapter(chapter.id)} className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition font-medium">移除</button>
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
                {version.tier === 'creative' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">创作性</span>}
                {version.isCurrent && <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">当前</span>}
              </div>
              <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{formatDate(version.createdAt)} · {version.content.slice(0, 90) || '（空文本）'}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!version.isCurrent && <button onClick={() => void restoreVersion(version.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/30 transition font-medium">恢复</button>}
              {/* A2：原始转写是原始素材，不提供删除入口 */}
              {version.versionType === 'raw_transcription' ? (
                <span className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)]" title="原始转写属于原始素材，为保证可追溯性不提供删除">受保护</span>
              ) : (
                <button onClick={() => void deleteVersion(version.id)} className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium">删除</button>
              )}
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
