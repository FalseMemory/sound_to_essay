/**
 * C1/C2：记录页。录音是最突出的操作。
 *
 * 状态机：idle → recording ⇄ paused → saving → saved（或 error）。
 * 「保存中」与「已保存」严格区分：任何一步失败都必须显示错误，不得显示成已保存。
 *
 * C2 关键能力——**边录边存**：录音过程中按时间切片持续写入 IndexedDB，
 * 并单独记录「这次录音还没结束」。页面被刷新、标签页被系统回收或浏览器崩溃后，
 * 回到本页会提示恢复，把分片合并成一条可播放的素材。
 */
import { useEffect, useRef, useState } from 'react';
import { diagnoseRecording, randomId, recorder, sha256Hex, store } from '../adapters';
import type {
  LocalAudioAsset,
  LocalMemory,
  PendingRecording,
  RecordingDiagnosis,
  RecordingState,
} from '../adapters';

function formatDuration(totalSecs: number): string {
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 生成带本地时间的人可读标题，如「录音 09-18 13:05」。 */
function defaultTitle(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `录音 ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 文件名用的时间戳，如 20260918-130512。 */
function fileStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ACTIVE_STATES: RecordingState[] = ['recording', 'paused', 'saving'];

async function checkRecoveredAudio(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('恢复音频无法解码，原分片已保留。请勿丢弃。')), 8000);
      audio.onloadeddata = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); reject(new Error('恢复音频格式不完整，原分片已保留。')); };
      audio.preload = 'auto'; audio.src = url; audio.load();
    });
  } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
}

export function RecordView({ onSaved }: { onSaved: () => void }) {
  const [state, setState] = useState<RecordingState>(recorder.state());
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 进来就先判断这台设备/这个地址能不能录音，避免用户点了才看到失败。
  const [diagnosis] = useState<RecordingDiagnosis>(() => diagnoseRecording());
  const canRecord = diagnosis.ok;
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  // 录音过程中的分块统计：保存失败时用于说明"到底有没有拿到音频数据"
  const chunkCountRef = useRef(0);
  const chunkBytesRef = useRef(0);
  // 分片落盘失败次数：不影响最终保存，但会削弱中断恢复能力，要如实告知
  const chunkWriteFailuresRef = useRef(0);
  const recordingIdRef = useRef('');
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef(false);
  const startedAtRef = useRef('');

  // 上次未完成的录音（用于中断恢复）
  const [pending, setPending] = useState<PendingRecording | null>(null);
  const [recovering, setRecovering] = useState(false);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      const next = recorder.elapsedSecs();
      elapsedRef.current = next;
      setElapsed(next);
      if (recorder.state() === 'error') {
        stopTimer(); setState('error');
        setError('录音被系统或设备中断。请恢复已落盘分片后再录音。');
        void writesRef.current.then(() => store.getPendingRecording()).then(setPending);
      }
    }, 500);
  };

  // 挂载时检查有没有未完成的录音
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await store.getPendingRecording();
        if (!cancelled && existing) setPending(existing);
      } catch {
        // 读取失败不阻塞录音
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      // 组件卸载时只停计时器；录音本身由适配层持有，不会因切页而丢失
      stopTimer();
    };
  }, []);

  // 录音进行中离开页面时给出提示
  useEffect(() => {
    if (!ACTIVE_STATES.includes(state)) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  /** 把一段音频落盘成素材。录音保存与「中断恢复」共用这段逻辑。 */
  const persistMemory = async (options: {
    blob: Blob;
    durationSecs: number;
    title: string;
    recordedAtIso: string;
    extension: string;
    mimeType: string;
    sampleRate?: number;
    sourceFormat: string;
    recordingId: string;
  }): Promise<LocalMemory> => {
    const assetId = options.recordingId;
    const digest = await sha256Hex(options.blob);
    const date = new Date(options.recordedAtIso);

    // 先落音频，再落素材：避免素材引用了并不存在的音频


    const asset: LocalAudioAsset = {
      assetId,
      originalFilename: `录音-${fileStamp(date)}.${options.extension}`,
      sourceFormat: options.sourceFormat,
      mimeType: options.mimeType,
      durationSecs: options.durationSecs,
      sampleRate: options.sampleRate,
      sizeBytes: options.blob.size,
      sha256: digest,
    };

    const memory: LocalMemory = {
      recordId: options.recordingId,
      revision: 1,
      title: options.title,
      body: '',
      recordedAt: options.recordedAtIso,
      eventDatePrecision: 'unknown',
      people: [],
      tags: [],
      audio: asset,
      createdAt: options.recordedAtIso,
      updatedAt: options.recordedAtIso,
    };

    await store.commitRecording(memory, options.blob, options.recordingId);
    return memory;
  };

  const handleStart = async () => {
    if (busyRef.current || ACTIVE_STATES.includes(recorder.state())) return;
    busyRef.current = true;
    setError(''); setNotice('');
    try {
      const existing = await store.getPendingRecording();
      if (existing) {
        setPending(existing);
        throw new Error('请先恢复或丢弃未完成录音。');
      }
      elapsedRef.current = 0; setElapsed(0);
      chunkCountRef.current = 0; chunkBytesRef.current = 0; chunkWriteFailuresRef.current = 0;
      const recordingId = randomId();
      recordingIdRef.current = recordingId;
      const format = recorder.pickFormat();
      const startedAt = new Date().toISOString();
      startedAtRef.current = startedAt;
      await store.savePendingRecording({ recordingId, startedAt, mimeType: format?.mimeType ?? '',
        extension: format?.extension ?? 'bin', chunkCount: 0, bytes: 0 });
      await recorder.start(chunk => {
        const sequence = ++chunkCountRef.current;
        chunkBytesRef.current += chunk.size;
        const bytes = chunkBytesRef.current;
        const meta = recorder.lastAudioMeta();
        writesRef.current = writesRef.current.then(async () => {
          await store.appendChunk(recordingId, sequence, chunk);
          await store.savePendingRecording({ recordingId, startedAt, mimeType: meta.mimeType,
            extension: format?.extension ?? 'bin', sampleRate: meta.sampleRate, chunkCount: sequence, bytes });
        }).catch(() => { chunkWriteFailuresRef.current += 1; });
      });
      setState(recorder.state()); startTimer();
    } catch (caught) {
      recorder.cancel(); stopTimer();
      await writesRef.current;
      setPending(await store.getPendingRecording().catch(() => null));
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { busyRef.current = false; }
  };

  const handlePause = () => {
    recorder.pause();
    setState(recorder.state());
    stopTimer();
    elapsedRef.current = recorder.elapsedSecs();
    setElapsed(elapsedRef.current);
  };

  const handleResume = () => {
    recorder.resume();
    setState(recorder.state());
    startTimer();
  };

  const handleDiscard = () => {
    if (!window.confirm('放弃这段录音吗？放弃后不会保存。')) return;
    recorder.cancel();
    stopTimer();
    setState('idle');
    setElapsed(0);
    elapsedRef.current = 0;
    setNotice('已放弃本次录音。');
    const recordingId = recordingIdRef.current;
    if (recordingId) {
      void writesRef.current.then(() => store.clearPendingRecording(recordingId)).catch(() => {});
    }
  };

  const handleStop = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    stopTimer();
    const durationSecs = recorder.elapsedSecs();
    setState('saving');
    setError('');
    setNotice('');
    try {
      const blob = await recorder.stop();
      await writesRef.current;
      if (blob.size === 0) {
        throw new Error('没有录到音频数据，本次未保存。');
      }
      const format = recorder.pickFormat();
      const meta = recorder.lastAudioMeta();
      const now = new Date(startedAtRef.current);

      await persistMemory({
        recordingId: recordingIdRef.current,
        blob,
        durationSecs,
        title: defaultTitle(now),
        recordedAtIso: now.toISOString(),
        extension: format?.extension ?? 'bin',
        mimeType: blob.type || meta.mimeType || format?.mimeType || '',
        sampleRate: meta.sampleRate,
        sourceFormat: format?.extension ?? 'bin',
      });

      // 保存成功才清掉"未完成"痕迹
      const recordingId = recordingIdRef.current;
      if (recordingId) {
        await store.clearPendingRecording(recordingId).catch(() => {});
      }
      recordingIdRef.current = '';

      setState('saved');
      setElapsed(durationSecs);
      const degraded =
        chunkWriteFailuresRef.current > 0
          ? `（录音过程中有 ${chunkWriteFailuresRef.current} 个分片未能落盘，本次已正常保存，但中断恢复能力受限）`
          : '';
      setNotice(
        `已保存在此设备浏览器内（${formatBytes(blob.size)}）。` +
          '可在「我的素材」补充标题、人物与地点。' +
          degraded,
      );
      onSaved();
    } catch (caught) {
      await writesRef.current;
      setPending(await store.getPendingRecording().catch(() => null));
      setState('error');
      const message = caught instanceof Error ? caught.message : String(caught);
      // 附上本次录制的实际情况，便于判断是「没收到数据」还是「写入失败」
      setError(
        `${message}\n本次录制：${chunkCountRef.current} 个分块，共收到 ${chunkBytesRef.current} 字节。`,
      );
    } finally { busyRef.current = false; }
  };

  /** 恢复上次未完成的录音：合并分片 → 存成一条素材。 */
  const handleRecover = async () => {
    if (!pending || recovering) return;
    setRecovering(true);
    setError('');
    setNotice('');
    try {
      const chunks = await store.listChunks(pending.recordingId);
      if (chunks.some((chunk, index) => chunk.seq !== index + 1)) throw new Error('分片不连续，已保留原分片，无法作为完整录音恢复。');
      if (chunks.length === 0) {
        await store.clearPendingRecording(pending.recordingId);
        setPending(null);
        throw new Error('这段录音没有可用的分片数据，已清理记录。');
      }

      // 分片是同一个录音流的连续片段，按 seq 顺序拼接
      const blob = new Blob(
        chunks.map((chunk) => chunk.blob),
        { type: pending.mimeType || chunks[0].blob.type || '' },
      );
      if (blob.size === 0) {
        throw new Error('分片合并后为空，无法恢复。');
      }
      await checkRecoveredAudio(blob);

      // 时长无法精确还原（分片不带时间戳），用分片数 × 切片长度估算并标注
      const estimatedSecs = Math.max(1, chunks.length);

      await persistMemory({
        blob,
        recordingId: pending.recordingId,
        durationSecs: estimatedSecs,
        title: `录音 ${formatTime(pending.startedAt)}（中断恢复）`,
        recordedAtIso: pending.startedAt,
        extension: pending.extension || 'bin',
        mimeType: blob.type || pending.mimeType,
        sampleRate: pending.sampleRate,
        sourceFormat: pending.extension || 'bin',
      });

      await store.clearPendingRecording(pending.recordingId);
      setPending(null);
      setNotice(
        `已恢复并保存（${chunks.length} 个分片，${formatBytes(blob.size)}）。` +
          '时长是按分片数估算的，建议到「我的素材」播放确认音质是否完整。',
      );
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRecovering(false);
    }
  };

  const handleDismissPending = async () => {
    if (!pending) return;
    if (!window.confirm('丢弃这段未完成的录音吗？丢弃后无法找回。')) return;
    try {
      await store.clearPendingRecording(pending.recordingId);
    } catch (caught) {
      setError(`丢弃失败，原录音仍保留：${String(caught)}`);
      return;
    }
    setPending(null);
    setNotice('已丢弃未完成的录音。');
  };

  useEffect(() => {
    const hidden = () => {
      if (document.hidden && recorder.state() === 'recording') {
        recorder.pause(); stopTimer(); setState(recorder.state());
        setElapsed(recorder.elapsedSecs());
        setNotice('离开页面已暂停，回来后请手动继续。锁屏和来电期间不保证持续录音。');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  const isRecording = state === 'recording';
  const isPaused = state === 'paused';
  const isSaving = state === 'saving';

  const statusText: Record<RecordingState, string> = {
    idle: '准备就绪',
    recording: '正在录音',
    paused: '已暂停',
    saving: '正在保存…',
    saved: '已保存',
    error: '出错了',
  };

  return (
    <div className="flex flex-col items-center px-5 pb-8 pt-8">
      {/* 未完成录音的恢复入口：只在真的录到分片时才提示 */}
      {pending && !recovering && (
        <div className="wrap-anywhere mb-5 w-full max-w-md rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3">
          <p className="text-xs font-semibold text-[var(--accent)]">发现一段未完成的录音</p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-primary)]">
            开始于 {formatTime(pending.startedAt)}，已保存 {pending.chunkCount} 个分片（
            {formatBytes(pending.bytes)}）。可能是页面被刷新或浏览器被系统回收。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void handleRecover()}
              className="touch-target flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
            >
              恢复并保存
            </button>
            <button
              onClick={() => void handleDismissPending()}
              className="touch-target flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              丢弃
            </button>
          </div>
        </div>
      )}
      {pending && pending.chunkCount > 0 && recovering && (
        <p className="mb-5 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          正在合并分片并保存…
        </p>
      )}

      {/* 录音不可用时的真实原因与解法：一进页面就说清，不留到点击后才报错 */}
      {!canRecord && (
        <div className="wrap-anywhere mb-5 w-full max-w-md rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3">
          <p className="text-xs font-semibold text-[var(--warning)]">{diagnosis.reason}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-primary)]">{diagnosis.hint}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            「我的素材」与「设置」仍然可以正常使用。
          </p>
        </div>
      )}

      {/* 状态与时长 */}
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              isRecording ? 'animate-pulse bg-red-500' : isPaused ? 'bg-amber-500' : 'bg-[var(--border)]'
            }`}
          />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {canRecord ? statusText[state] : '本机无法录音'}
          </span>
        </div>
        <div className="mt-3 font-mono text-4xl font-bold tabular-nums text-[var(--text-primary)]">
          {formatDuration(elapsed)}
        </div>
        <p className="wrap-anywhere mt-2 text-xs text-[var(--text-secondary)]">
          {!canRecord && '当前环境不支持录音，详见上方说明'}
          {canRecord && state === 'idle' && '点击下方按钮开始口述'}
          {canRecord && isRecording && '再点一次结束并保存'}
          {canRecord && isPaused && '已暂停，可继续或结束'}
          {canRecord && isSaving && '正在写入本机存储，请不要关闭页面'}
          {canRecord && state === 'saved' && '已保存在本机浏览器内'}
          {canRecord && state === 'error' && '本次录音未保存'}
        </p>
        {canRecord && (isRecording || isPaused) && chunkCountRef.current > 0 && (
          <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
            已收到（正在依次保存）{chunkCountRef.current} 个分片（{formatBytes(chunkBytesRef.current)}）
          </p>
        )}
      </div>

      {/* 主录音按钮：触控目标远大于 44×44 */}
      <button
        onClick={() => {
          if (state === 'idle' || state === 'saved' || state === 'error') void handleStart();
          else if (isRecording || isPaused) void handleStop();
        }}
        disabled={isSaving || !canRecord}
        aria-label={isRecording || isPaused ? '结束录音' : '开始录音'}
        className={`mt-8 flex h-32 w-32 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-50 ${
          isRecording || isPaused
            ? 'bg-red-600 shadow-red-500/30'
            : 'bg-[var(--accent)] shadow-blue-500/30'
        }`}
      >
        {isSaving ? (
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
        ) : isRecording || isPaused ? (
          <span className="h-9 w-9 rounded-md bg-white" />
        ) : (
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {/* 暂停 / 继续 / 放弃 */}
      {(isRecording || isPaused) && (
        <div className="mt-6 flex w-full max-w-md gap-3">
          <button
            onClick={isPaused ? handleResume : handlePause}
            className="touch-target flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
          >
            {isPaused ? '继续录音' : '暂停'}
          </button>
          <button
            onClick={handleDiscard}
            className="touch-target flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm font-medium text-[var(--error)] transition hover:bg-[var(--bg-tertiary)]"
          >
            放弃
          </button>
        </div>
      )}

      {/* 提示与错误 */}
      {notice && (
        <p className="wrap-anywhere mt-6 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--text-primary)]">
          {notice}
        </p>
      )}
      {error && (
        <p className="wrap-anywhere mt-6 w-full max-w-md whitespace-pre-line rounded-xl border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-xs leading-relaxed text-[var(--error)]">
          {error}
        </p>
      )}

      <p className="mt-8 max-w-md text-center text-xs leading-relaxed text-[var(--text-secondary)]">
        录音保存在<b className="text-[var(--text-primary)]">此设备浏览器内</b>，不会自动上传，过程中也会持续落盘。
        整理好后到「我的素材」导出素材包，再在电脑上导入。
      </p>
    </div>
  );
}
