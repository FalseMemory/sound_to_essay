/**
 * C1/C3：我的素材。列表显示标题、时间、时长与保存／导出状态，可播放、可导出素材包。
 * 导出语义严格对应用户能看到的事实，不宣称「电脑已接收」。
 */
import { useEffect, useRef, useState } from 'react';
import { buildPack, exporter, importAudioFiles, store } from '../adapters';
import type { ExportResult, ImportSummary, LocalMemory } from '../adapters';
import { MemoryEditor } from '../components/MemoryEditor';

/**
 * 文件选择器的过滤列表。刻意写得很宽：accept 只影响选择器的默认筛选，
 * 用户仍可切到"所有文件"，因此**真正的格式判定靠 audioImport 的魔数探测**，
 * 而不是这里的白名单。
 */
const AUDIO_ACCEPT = [
  'audio/*',
  '.wav', '.wave', '.mp3', '.mp2', '.m4a', '.m4b', '.mp4', '.aac',
  '.ogg', '.oga', '.opus', '.flac', '.webm', '.amr', '.awb', '.wma',
  '.aiff', '.aif', '.aifc', '.caf', '.au', '.snd', '.3gp', '.3gpp',
  '.ape', '.wv', '.gsm', '.sln', '.ac3', '.dts',
].join(',');

/** 编辑器目标：新建文字记录 / 编辑某条已有素材 / 关闭。 */
type EditorTarget = { mode: 'new' } | { mode: 'edit'; memory: LocalMemory } | null;

function formatDuration(secs?: number): string {
  if (!secs || secs <= 0) return '--:--';
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso?: string): string {
  if (!iso) return '未记录时间';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把导出结果翻译成**如实**的中文说明。 */
function describeExportResult(result: ExportResult): { text: string; tone: 'ok' | 'warn' | 'error' } {
  switch (result.status) {
    case 'shared':
      return { text: '已通过系统分享发出。请在目标应用里确认是否保存成功。', tone: 'ok' };
    case 'downloaded':
      return {
        text: '已发起下载。浏览器不会告知是否真的保存成功，请到「文件」App 里确认。',
        tone: 'ok',
      };
    case 'cancelled':
      return { text: '已取消导出，手机上的素材没有变化。', tone: 'warn' };
    case 'failed':
      return { text: result.error, tone: 'error' };
  }
}

/** 把导入结果翻译成**如实**的中文说明，不掩盖"本机放不了"的部分。 */
function describeImport(summary: ImportSummary): { text: string; tone: 'ok' | 'warn' | 'error' } {
  if (summary.imported === 0 && summary.failed.length > 0) {
    return {
      text: `导入失败：${summary.failed.map((item) => `${item.fileName}（${item.reason}）`).join('；')}`,
      tone: 'error',
    };
  }

  const parts: string[] = [
    `成功导入 ${summary.imported} 个文件，共 ${formatBytes(summary.bytes)}。`,
  ];

  if (summary.unplayable > 0) {
    const names = summary.results
      .filter((item) => item.ok && item.playable === false)
      .map((item) => item.fileName);
    parts.push(
      `其中 ${summary.unplayable} 个本机无法播放（${names.slice(0, 3).join('、')}` +
        `${names.length > 3 ? ' 等' : ''}）——文件已完整保存，导出到电脑后由电脑处理。`,
    );
  }

  if (summary.failed.length > 0) {
    parts.push(
      `另有 ${summary.failed.length} 个失败：${summary.failed
        .map((item) => `${item.fileName}（${item.reason}）`)
        .join('；')}`,
    );
  }

  parts.push('录制时间未自动填写（文件名无法可靠反映录制时间），可在「编辑」里补充。');

  return { text: parts.join(''), tone: summary.failed.length > 0 ? 'warn' : 'ok' };
}

export function MaterialsView({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [items, setItems] = useState<LocalMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState('');
  const [playError, setPlayError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{
    text: string;
    tone: 'ok' | 'warn' | 'error';
  } | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const [editorTarget, setEditorTarget] = useState<EditorTarget>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importNotice, setImportNotice] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef('');

  const releaseUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const list = await store.list();
        if (!cancelled) setItems(list);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [version, localVersion]);

  useEffect(() => {
    return () => {
      releaseUrl();
    };
  }, []);

  const handlePlay = async (memory: LocalMemory) => {
    if (!memory.audio) return;
    setPlayError('');
    if (playingId === memory.recordId) {
      audioRef.current?.pause();
      setPlayingId('');
      return;
    }
    try {
      const blob = await store.getAudio(memory.audio.assetId);
      if (!blob) {
        setPlayError('找不到这条记录的音频数据（可能已被浏览器清理存储空间）。');
        return;
      }
      releaseUrl();
      urlRef.current = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = urlRef.current;
        await audioRef.current.play();
        setPlayingId(memory.recordId);
      }
    } catch (caught) {
      setPlayError(caught instanceof Error ? caught.message : String(caught));
      setPlayingId('');
    }
  };

  /** 导出若干条素材为一个 .svpack，并如实记录导出状态。 */
  const runExport = async (targets: LocalMemory[]) => {
    if (exporting || targets.length === 0) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const pack = await buildPack(targets, (assetId) => store.getAudio(assetId));
      const result = await exporter.exportPack(pack.blob, pack.filename);

      if (result.status === 'shared' || result.status === 'downloaded') {
        // 只有真正发起成功才记录导出时间；取消或失败都不标记为已导出
        const stamp = new Date().toISOString();
        for (const memory of targets) {
          await store.put({ ...memory, lastExportedAt: stamp });
        }
        setLocalVersion((value) => value + 1);
      }

      const described = describeExportResult(result);
      const extra =
        pack.missingAudio > 0
          ? `（注意：有 ${pack.missingAudio} 条记录的音频在本机读不到，未包含在包内）`
          : '';
      setExportNotice({
        text: `包含 ${pack.recordCount} 条记录、${pack.audioCount} 个音频，共 ${formatBytes(pack.blob.size)}。${described.text}${extra}`,
        tone: described.tone,
      });
    } catch (caught) {
      setExportNotice({
        text: `导出失败：${caught instanceof Error ? caught.message : String(caught)}`,
        tone: 'error',
      });
    } finally {
      setExporting(false);
    }
  };

  /** 把手机里已有的音频文件导入为素材。逐个处理，单个失败不影响其余。 */
  const handleImportFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setImporting(true);
    setImportNotice(null);
    setImportProgress(`准备处理 ${files.length} 个文件…`);
    try {
      const summary = await importAudioFiles(files, {
        store,
        onProgress: (done, total, current) => {
          setImportProgress(`正在处理 ${Math.min(done + 1, total)}/${total}：${current}`);
        },
      });
      setLocalVersion((value) => value + 1);
      setImportNotice(describeImport(summary));
    } catch (caught) {
      setImportNotice({
        text: `导入失败：${caught instanceof Error ? caught.message : String(caught)}`,
        tone: 'error',
      });
    } finally {
      setImporting(false);
      setImportProgress('');
      // 清空 input，否则同一个文件再选一次不会触发 change
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** 删除一条素材：先删音频再删记录，并**明确告知不可恢复**。 */
  const handleDelete = async (memory: LocalMemory) => {
    const confirmed = window.confirm(
      `删除「${memory.title}」吗？\n\n` +
        '这会同时删除本机保存的音频，且无法恢复。\n' +
        '如果还想在电脑上留一份，请先导出素材包。',
    );
    if (!confirmed) return;
    try {
      if (memory.audio) {
        await store.removeAudio(memory.audio.assetId);
      }
      await store.remove(memory.recordId);
      setLocalVersion((value) => value + 1);
      setExportNotice({ text: '已删除这条素材。', tone: 'warn' });
    } catch (caught) {
      setExportNotice({
        text: `删除失败：${caught instanceof Error ? caught.message : String(caught)}`,
        tone: 'error',
      });
    }
  };

  // 编辑/新建时整页切到编辑器，避免移动端在窄屏里再叠一层弹窗
  if (editorTarget) {
    return (
      <MemoryEditor
        memory={editorTarget.mode === 'edit' ? editorTarget.memory : null}
        onCancel={() => setEditorTarget(null)}
        onSaved={() => {
          setEditorTarget(null);
          setLocalVersion((value) => value + 1);
          setExportNotice({ text: '已保存修改。', tone: 'ok' });
        }}
      />
    );
  }

  const withAudio = items.filter((item) => item.audio);
  const exportedCount = items.filter((item) => item.lastExportedAt).length;

  return (
    <div className="px-5 pb-8 pt-6">
      <audio
        ref={audioRef}
        onEnded={() => setPlayingId('')}
        onError={() => {
          setPlayError('音频无法播放（浏览器可能不支持该编码）。');
          setPlayingId('');
        }}
        className="hidden"
      />

      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">我的素材</h2>
        <span className="text-xs text-[var(--text-secondary)]">
          共 {items.length} 条 · 已发起导出 {exportedCount} 条
        </span>
      </div>

      {/* 新建来源：写文字 / 导入已有音频文件 */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setEditorTarget({ mode: 'new' })}
          className="touch-target flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
        >
          ＋ 写文字
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="touch-target flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
        >
          {importing ? '导入中…' : '⬆ 导入音频'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => void handleImportFiles(event.target.files)}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        可以导入手机里已有的录音（语音备忘录、微信语音、录音笔文件等）。
        本机放不了的格式也会完整保存，导出到电脑后再处理。
      </p>

      {importProgress && (
        <p className="wrap-anywhere mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          {importProgress}
        </p>
      )}

      {importNotice && (
        <p
          className={`wrap-anywhere mt-3 rounded-xl border px-4 py-3 text-xs leading-relaxed ${
            importNotice.tone === 'error'
              ? 'border-[var(--error)]/30 bg-[var(--error)]/10 text-[var(--error)]'
              : importNotice.tone === 'warn'
                ? 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]'
                : 'border-[var(--border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
          }`}
        >
          {importNotice.text}
        </p>
      )}

      {/* 导出：把素材打包发到电脑 */}
      {items.length > 0 && (
        <button
          onClick={() => void runExport(items)}
          disabled={exporting}
          className="touch-target mt-3 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {exporting ? '正在打包…' : `导出全部 ${items.length} 条素材`}
        </button>
      )}

      {exportNotice && (
        <p
          className={`wrap-anywhere mt-3 rounded-xl border px-4 py-3 text-xs leading-relaxed ${
            exportNotice.tone === 'error'
              ? 'border-[var(--error)]/30 bg-[var(--error)]/10 text-[var(--error)]'
              : exportNotice.tone === 'warn'
                ? 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]'
                : 'border-[var(--border)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
          }`}
        >
          {exportNotice.text}
        </p>
      )}

      {loading && <p className="mt-6 text-sm text-[var(--text-secondary)]">读取中…</p>}

      {error && (
        <p className="wrap-anywhere mt-4 rounded-xl border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-xs text-[var(--error)]">
          {error}
        </p>
      )}

      {playError && (
        <p className="wrap-anywhere mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3 text-xs text-[var(--warning)]">
          {playError}
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-[var(--border)] px-5 py-10 text-center">
          <p className="text-sm text-[var(--text-primary)]">还没有素材</p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            到「记录」页录一条，或点上面的「写文字」「导入音频」。素材只保存在本机浏览器内。
          </p>
        </div>
      )}

      <ul className="mt-5 space-y-3">
        {items.map((memory) => {
          const isPlaying = playingId === memory.recordId;
          return (
            <li
              key={memory.recordId}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="wrap-anywhere text-sm font-semibold text-[var(--text-primary)]">
                    {memory.title}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {formatTime(memory.recordedAt)}
                    {memory.audio && ` · ${formatDuration(memory.audio.durationSecs)}`}
                    {memory.audio && ` · ${memory.audio.sourceFormat.toUpperCase()}`}
                    {memory.audio && ` · ${formatBytes(memory.audio.sizeBytes)}`}
                  </div>
                </div>
                {memory.audio && (
                  <button
                    onClick={() => void handlePlay(memory)}
                    aria-label={isPlaying ? '停止播放' : '播放'}
                    className="touch-target flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 px-4 text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                  >
                    {isPlaying ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6,4 20,12 6,20" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {memory.body && (
                <p className="wrap-anywhere mt-3 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {memory.body}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                  本机保存
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] ${
                    memory.lastExportedAt
                      ? 'border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)]'
                  }`}
                >
                  {memory.lastExportedAt ? `已发起导出 ${formatTime(memory.lastExportedAt)}（请核对文件）` : '未导出'}
                </span>
                {memory.people.map((person) => (
                  <span
                    key={person}
                    className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] text-[var(--accent)]"
                  >
                    {person}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditorTarget({ mode: 'edit', memory })}
                  className="touch-target flex-1 rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
                >
                  编辑
                </button>
                <button
                  onClick={() => void runExport([memory])}
                  disabled={exporting}
                  className="touch-target flex-1 rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  导出
                </button>
                <button
                  onClick={() => void handleDelete(memory)}
                  className="touch-target rounded-xl border border-[var(--error)]/30 px-3 py-2.5 text-xs font-medium text-[var(--error)] transition hover:bg-[var(--error)]/10"
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {items.length > 0 && (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-[var(--text-secondary)]">
          导出后手机上的素材<b className="text-[var(--text-primary)]">不会被自动删除</b>，可以放心多次导出。
          {withAudio.length < items.length && ' 纯文字素材也能一起导出。'}
        </p>
      )}

      <button
        onClick={onChanged}
        className="touch-target mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]"
      >
        刷新列表
      </button>
    </div>
  );
}
