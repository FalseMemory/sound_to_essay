import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useClipTranscription } from '../hooks/useClipTranscription';
import { useProjectStore } from '../stores/projectStore';
import type { VoiceClip } from '../types';

type Status = 'idle' | 'recording' | 'stopping' | 'transcribing';

export function RecordingPanel() {
  const isRecording = useProjectStore((s) => s.isRecording);
  const setRecording = useProjectStore((s) => s.setRecording);
  const isTranscribing = useProjectStore((s) => s.isTranscribing);
  const setTranscribing = useProjectStore((s) => s.setTranscribing);
  const addClip = useProjectStore((s) => s.addClip);
  const project = useProjectStore((s) => s.project);
  // 首次转写与创作区的"重新转写"共用同一段逻辑，避免两处行为不一致。
  const { transcribeClip } = useClipTranscription();
  // 转写可能发生在录音停止之后：用 ref 持有最新实现，避免闭包拿到过期的模型设置。
  const transcribeRef = useRef(transcribeClip);
  transcribeRef.current = transcribeClip;
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const statusTimer = useRef<number | null>(null);
  const isStoppingRef = useRef(false);
  const clickHandlerRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!isRecording && status === 'recording') setStatus('idle');
  }, [isRecording]);

  useEffect(() => {
    if (isTranscribing) setStatus('transcribing');
    else if (status === 'transcribing') setStatus('idle');
  }, [isTranscribing]);

  useEffect(() => {
    if (!isRecording || status !== 'recording') return;
    const poll = setInterval(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const still = await invoke<boolean>('is_recording');
        if (!still) handleStopRecording();
      } catch { /* ignore */ }
    }, 300);
    return () => clearInterval(poll);
  }, [isRecording, status]);

  const showStatus = (msg: string, durationMs = 0) => {
    setStatusMsg(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    if (durationMs > 0) {
      statusTimer.current = window.setTimeout(() => setStatusMsg(''), durationMs);
    }
  };

  const handleStopRecording = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    setStatus('stopping');
    setRecording(false);
    showStatus('⏹ 录音保存中...');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('stop_recording') as any;
      if (!result || result.durationSecs == null) {
        showStatus('❌ 录音结果无效', 3000);
        return;
      }
      const durationSecs = result.durationSecs as number;
      const audioPath = result.audioPath as string;

      // A1：先登记片段（状态 pending、文本为空），再执行转写。
      // 这样即使转写失败，音频也已被项目引用，不会被"清理未引用录音"删掉。
      const clip: VoiceClip = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        audioPath: audioPath,
        rawText: '',
        durationSecs: durationSecs,
        confidence: 0,
        transcriptionStatus: 'pending',
      };
      addClip(clip);

      showStatus(`✅ 录音完成 (${durationSecs.toFixed(1)}s)，正在识别...`);
      setStatus('transcribing');
      setTranscribing(true);

      const outcome = await transcribeRef.current(clip);
      showStatus(
        outcome.ok
          ? `✅ ${outcome.message}，已添加到创作区`
          : `❌ 转写失败：${outcome.message}。录音已保留，可点「重新转写」重试。`,
        outcome.ok ? 3000 : 6000
      );
    } catch (e: any) {
      showStatus(`❌ ${e?.toString?.() || String(e)}`, 5000);
    } finally {
      setTranscribing(false);
      setStatus('idle');
      isStoppingRef.current = false;
    }
  }, []);

  const handleStartRecording = async () => {
    if (!project) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_recording');
      setRecording(true);
      setStatus('recording');
      showStatus('🎤 录音中... 点击停止录音结束本段');
    } catch (e: any) {
      showStatus(`❌ ${e?.toString?.() || String(e)}`, 5000);
    }
  };

  const handleClick = () => {
    if (status === 'recording') {
      handleStopRecording();
    } else if (status === 'idle') {
      handleStartRecording();
    }
  };

  clickHandlerRef.current = handleClick;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen('global-recording-toggle', () => {
      if (!disposed) clickHandlerRef.current();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => {
      console.error('Global shortcut listener failed:', error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const btnLabel = () => {
    switch (status) {
      case 'recording': return '⏹ 停止录音';
      case 'stopping': return '⏹ 保存中...';
      case 'transcribing': return '🔄 识别中...';
      default: return '🎤 开始录音';
    }
  };

  const isBusy = status === 'stopping' || status === 'transcribing';

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={!project || isBusy}
        className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${
          status === 'recording'
            ? 'animate-pulse bg-red-600 text-white shadow-sm shadow-red-500/40'
            : isBusy
            ? 'bg-amber-600 text-white'
            : 'bg-[var(--accent)] text-white shadow-sm shadow-blue-500/20 hover:bg-[var(--accent-hover)]'
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span className={`h-3 w-3 rounded-full ${
          status === 'recording' ? 'bg-white' : isBusy ? 'bg-amber-300 dark:bg-amber-400' : 'bg-white/70'
        } ${status === 'transcribing' ? 'animate-ping' : ''}`} />
        {btnLabel()}
      </button>

      {isBusy && (
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <span className="h-3 w-1 animate-bounce rounded bg-amber-400 dark:bg-amber-300" style={{ animationDelay: '0ms' }} />
            <span className="h-3 w-1 animate-bounce rounded bg-amber-400 dark:bg-amber-300" style={{ animationDelay: '150ms' }} />
            <span className="h-3 w-1 animate-bounce rounded bg-amber-400 dark:bg-amber-300" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {status === 'stopping' ? '保存录音文件...' : 'Whisper 语音识别中...'}
          </span>
        </div>
      )}

      {status === 'recording' && (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
          <span className="text-xs text-red-600 dark:text-red-400">录音中</span>
        </div>
      )}

      {statusMsg && status !== 'recording' && !isBusy && (
        <span className="animate-fade-in text-xs text-emerald-600 dark:text-emerald-400">{statusMsg}</span>
      )}
    </div>
  );
}
