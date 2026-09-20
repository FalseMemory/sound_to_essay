/**
 * C1：手机端平台适配接口。
 *
 * 手机记录端运行在浏览器里，**禁止调用任何 Tauri API**（浏览器没有 `__TAURI_INTERNALS__`，
 * 直接 invoke 会抛 "Cannot read properties of undefined"）。所有设备能力都经由下面这些接口获取，
 * 便于将来替换实现（如 Capacitor / PWA 包装）而不动业务代码。
 */

/** 模糊事件时间的精度。与三阶段无关的精确时间戳一律不伪造。 */
export type EventDatePrecision = 'year' | 'month' | 'day' | 'decade' | 'unknown';

/** 本地音频资产。字段与 B2 素材包协议对齐，导出时可直接映射。 */
export interface LocalAudioAsset {
  assetId: string;
  /** 原始文件名（导出到桌面后用于溯源展示） */
  originalFilename: string;
  /** 运行时探测到的真实格式，如 webm / mp4 / ogg / wav —— 不做任何假定 */
  sourceFormat: string;
  /** 浏览器实际给出的 MIME 类型 */
  mimeType: string;
  durationSecs?: number;
  sampleRate?: number;
  sizeBytes: number;
  /** 音频字节的 SHA-256（hex），仅用于完整性与去重，不构成身份认证 */
  sha256: string;
}

/** 一条本地素材（录音或纯文字）。 */
export interface LocalMemory {
  /** 稳定记录 ID：跨导出、跨设备不变 */
  recordId: string;
  /** 修订标识：内容修改后递增，但**不换 ID** */
  revision: number;
  title: string;
  body: string;
  /** 录音时间，ISO 8601 带时区；纯文字记忆可留空 */
  recordedAt?: string;
  /** 模糊事件时间以文本 + 精度分开保存，不强行解析成精确时间戳 */
  eventDateText?: string;
  eventDatePrecision?: EventDatePrecision;
  people: string[];
  location?: string;
  tags: string[];
  notes?: string;
  audio?: LocalAudioAsset;
  createdAt: string;
  updatedAt: string;
  /**
   * 最近一次成功导出的时间。
   * 注意语义：只表示「已导出」，**不代表电脑已接收**——手机无从得知对方是否收到。
   */
  lastExportedAt?: string;
}

/**
 * 录音状态。刻意区分「保存中」与「已保存」：
 * 存储失败时必须是 error，绝不能显示成「已保存」。
 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'saving' | 'saved' | 'error';

/** 浏览器实际支持的录音格式，由运行时探测得出。 */
export interface AudioFormat {
  mimeType: string;
  /** 对应文件扩展名，如 webm / mp4 / ogg */
  extension: string;
}

/**
 * 一段**尚未完成**的录音。
 *
 * 为什么要单独记录：录音过程中按时间切片持续写入 IndexedDB，若页面被刷新、
 * 标签页被系统回收或浏览器崩溃，内存里的分片就没了。把「这次录音的元信息 + 分片」
 * 都留在磁盘上，重启后才能把它们捞回来、合并成一条可播放的素材。
 */
export interface PendingRecording {
  recordingId: string;
  startedAt: string;
  mimeType: string;
  extension: string;
  sampleRate?: number;
  /** 已落盘的分片数量与字节数 */
  chunkCount: number;
  bytes: number;
}

export interface MemoryStore {
  /**
   * 原子提交一条带音频的素材：写记录 + 写音频 + （若有）清分片与未完成标记，
   * 全部在**同一个 IndexedDB 事务**里完成，避免中途失败留下不一致状态。
   *
   * `recordingId` 可选：手动导入音频文件时没有分片与 pending 记录，不传即可。
   */
  commitRecording(memory: LocalMemory, blob: Blob, recordingId?: string): Promise<void>;
  init(): Promise<void>;
  list(): Promise<LocalMemory[]>;
  get(recordId: string): Promise<LocalMemory | null>;
  put(memory: LocalMemory): Promise<void>;
  remove(recordId: string): Promise<void>;
  /** 音频分块：录制过程中持续写入，中断/崩溃后仍可恢复 */
  appendChunk(recordingId: string, seq: number, blob: Blob): Promise<void>;
  listChunks(recordingId: string): Promise<{ seq: number; blob: Blob }[]>;
  clearChunks(recordingId: string): Promise<void>;

  /** 未完成录音的元信息。同一时刻最多只有一条。 */
  getPendingRecording(): Promise<PendingRecording | null>;
  savePendingRecording(recording: PendingRecording): Promise<void>;
  /** 清除未完成录音及其全部分片。 */
  clearPendingRecording(recordingId: string): Promise<void>;

  putAudio(assetId: string, blob: Blob): Promise<void>;
  getAudio(assetId: string): Promise<Blob | null>;
  removeAudio(assetId: string): Promise<void>;
  /** 估算本设备已用与可用配额，供设置页如实展示 */
  usage(): Promise<{ usedBytes: number; quotaBytes?: number }>;
}

export interface RecorderAdapter {
  /** 当前浏览器是否具备录音能力 */
  isSupported(): boolean;
  /** 运行时探测可用的录音格式；完全不支持时返回 null */
  pickFormat(): AudioFormat | null;
  /**
   * 请求麦克风权限并开始录音。
   * `onChunk` 会在录制过程中持续收到音频分块，用于边录边存。
   * 权限被拒绝 / 设备不可用时抛出带可读原因的错误。
   */
  start(onChunk: (blob: Blob) => void): Promise<void>;
  pause(): void;
  resume(): void;
  /** 结束录音并返回完整音频。 */
  stop(): Promise<Blob>;
  /** 放弃本次录音（不产生素材）。 */
  cancel(): void;
  state(): RecordingState;
  /** 已录制秒数（暂停期间不计入）。 */
  elapsedSecs(): number;
  /**
   * 最近一次录音实际用到的音频参数。
   * 采样率取不到时留空，**不猜一个默认值**。
   */
  lastAudioMeta(): { mimeType: string; sampleRate?: number };
}

/**
 * 导出结果。注意这里**没有**「电脑已接收」这种状态：
 * 手机端只能知道「已分享/已下载」，无从得知对方是否收到，不得越权显示。
 */
export type ExportResult =
  | { status: 'shared' }
  | { status: 'downloaded' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string };

export interface ExporterAdapter {
  /** 优先使用系统分享；不可用时回退为文件下载。 */
  exportPack(blob: Blob, filename: string): Promise<ExportResult>;
}

/** 手机端整体能力探测结果，用于设置页如实展示。 */
export interface PlatformCapabilities {
  hasMediaRecorder: boolean;
  hasGetUserMedia: boolean;
  hasIndexedDb: boolean;
  hasWebShare: boolean;
  audioFormat: AudioFormat | null;
}
