/**
 * C1/C2：基于 MediaRecorder 的录音实现。
 *
 * 关键约束（来自计划）：
 * - **运行时探测**实际支持的格式，不能假定 WebM 或 WAV：
 *   iOS Safari 主要支持 `audio/mp4`，Android Chrome 多为 `audio/webm;codecs=opus`。
 * - 权限拒绝 / 设备不可用 / 录制异常都要给出可读原因。
 * - 录制过程中按时间切片持续交出分块，便于边录边存、中断后恢复。
 */
import type { AudioFormat, RecorderAdapter, RecordingState } from './types';

/** 候选格式按「优先使用」排列。实际能否使用由浏览器探测决定。 */
const FORMAT_CANDIDATES: AudioFormat[] = [
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: 'm4a' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mimeType: 'audio/ogg', extension: 'ogg' },
  { mimeType: 'audio/wav', extension: 'wav' },
];

/** 录音分片的时长（毫秒）。1 秒一片，兼顾落盘频率与开销。 */
const TIMESLICE_MS = 1000;

/**
 * 是否处于安全上下文。浏览器只在 `https://` 或 `localhost` 下暴露麦克风接口，
 * 用局域网 IP 以 http 访问时 `navigator.mediaDevices` 直接是 undefined。
 */
export function isSecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** 录音不可用时的诊断结论：给出**真实原因**与**可执行的解法**，而不是笼统的"不支持"。 */
export interface RecordingDiagnosis {
  ok: boolean;
  /** 不可用的真实原因 */
  reason: string;
  /** 怎么解决 */
  hint: string;
}

/**
 * 逐项排查录音能力。
 * 顺序很重要：**先判断安全上下文**——它是最常见的原因，且与"浏览器太旧"是完全不同的问题，
 * 混为一谈会让用户去换浏览器却依然失败。
 */
export function diagnoseRecording(): RecordingDiagnosis {
  if (!isSecureContext()) {
    return {
      ok: false,
      reason: '当前页面不是安全上下文（未通过 HTTPS 访问）',
      hint: '浏览器只在 https:// 或 localhost 下开放麦克风。用手机测试请改用 HTTPS 地址；在电脑上用 localhost 打开则可以正常录音。',
    };
  }
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return {
      ok: false,
      reason: '此浏览器未提供麦克风接口（getUserMedia）',
      hint: '请改用较新版本的 iOS Safari 或 Android Chrome 打开。',
    };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      reason: '此浏览器不支持网页录音接口（MediaRecorder）',
      hint: '请改用较新版本的 iOS Safari 或 Android Chrome 打开。',
    };
  }
  if (!pickAudioFormat()) {
    return {
      ok: false,
      reason: '此浏览器没有可用的录音编码格式',
      hint: '请改用较新版本的 iOS Safari 或 Android Chrome 打开。',
    };
  }
  return { ok: true, reason: '', hint: '' };
}

/** 运行时探测可用的录音格式；都不支持则返回 null。 */
export function pickAudioFormat(): AudioFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of FORMAT_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
    } catch {
      // 某些实现在传入奇怪字符串时会抛错，跳过即可
    }
  }
  // 极端情况：不支持 isTypeSupported 但能录音，交给浏览器自己挑默认格式
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return { mimeType: '', extension: 'bin' };
  }
  return null;
}

/** 把 getUserMedia 的异常翻译成用户能看懂的中文原因。 */
function describeMediaError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '麦克风权限被拒绝。请在浏览器地址栏的权限设置里允许后重试。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '没有检测到可用的麦克风设备。';
    case 'NotReadableError':
    case 'TrackStartError':
      return '麦克风被其他应用占用，或系统拒绝了访问。请关闭占用麦克风的应用后重试。';
    case 'OverconstrainedError':
      return '当前设备无法满足录音参数要求。';
    case 'AbortError':
      return '录音启动被中断。';
    default: {
      const message = (error as { message?: string })?.message;
      return message ? `录音失败：${message}` : '录音失败：未知原因。';
    }
  }
}

export function createMediaRecorderAdapter(): RecorderAdapter {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let state: RecordingState = 'idle';
  let segmentStartedAt = 0;
  let accumulatedMs = 0;
  let mimeType = '';
  let sampleRate: number | undefined;

  const cleanupStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const currentElapsedMs = () => {
    if (state === 'recording') return accumulatedMs + (performance.now() - segmentStartedAt);
    return accumulatedMs;
  };

  /** 结束当前段落并把时间累加进累计值（用于暂停）。 */
  const foldSegment = () => {
    if (state === 'recording') {
      accumulatedMs += performance.now() - segmentStartedAt;
    }
  };

  return {
    isSupported: isRecordingSupported,

    pickFormat: pickAudioFormat,

    async start(onChunk) {
      const diagnosis = diagnoseRecording();
      if (!diagnosis.ok) {
        state = 'error';
        throw new Error(`${diagnosis.reason}。${diagnosis.hint}`);
      }
      const format = pickAudioFormat();
      if (!format) {
        state = 'error';
        throw new Error('此浏览器没有可用的录音编码格式。请改用较新版本的 iOS Safari 或 Android Chrome。');
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (error) {
        state = 'error';
        throw new Error(describeMediaError(error));
      }

      // 采样率仅作记录，取不到就留空（不猜）
      const settings = stream.getAudioTracks()[0]?.getSettings?.();
      sampleRate = settings?.sampleRate;

      mimeType = format.mimeType;
      chunks = [];
      accumulatedMs = 0;
      segmentStartedAt = performance.now();

      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (error) {
        cleanupStream();
        state = 'error';
        throw new Error(describeMediaError(error));
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          onChunk(event.data);
        }
      };
      recorder.onerror = () => {
        foldSegment();
        state = 'error';
        cleanupStream();
      };
      stream.getAudioTracks().forEach(track => {
        track.onended = () => { foldSegment(); state = 'error'; cleanupStream(); };
      });
      mimeType = recorder.mimeType || mimeType;

      recorder.start(TIMESLICE_MS);
      state = 'recording';
    },

    pause() {
      if (state !== 'recording' || !recorder) return;
      recorder.pause();
      foldSegment();
      state = 'paused';
    },

    resume() {
      if (state !== 'paused' || !recorder) return;
      recorder.resume();
      segmentStartedAt = performance.now();
      state = 'recording';
    },

    async stop() {
      if (!recorder) {
        throw new Error('当前没有正在进行的录音。');
      }
      const active = recorder;
      foldSegment();
      state = 'saving';

      // onstop 在个别情况下可能不触发（例如系统中断了音频输入）。
      // 必须加兜底超时，否则界面会永远停在「正在保存…」而不是给出错误。
      const done = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('录音结束超时，分片已保留，请通过恢复入口处理。')), 5000);
        active.onstop = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });

      try {
        active.stop();
      } catch {
        // 已经停止，忽略
      }
      try { await done; } catch (error) { state = 'error'; cleanupStream(); throw error; }
      const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type || '' });
      recorder = null;
      cleanupStream();
      chunks = [];
      state = 'saved';
      return blob;
    },

    cancel() {
      if (recorder) recorder.ondataavailable = null;
      try {
        recorder?.stop();
      } catch {
        // ignore
      }
      recorder = null;
      cleanupStream();
      chunks = [];
      accumulatedMs = 0;
      state = 'idle';
    },

    state() {
      return state;
    },

    elapsedSecs() {
      return Math.floor(currentElapsedMs() / 1000);
    },

    lastAudioMeta() {
      return { mimeType, sampleRate };
    },
  };
}
