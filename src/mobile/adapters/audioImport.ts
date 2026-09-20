/**
 * C4：手机端手动导入音频文件。
 *
 * 设计要点（与"自己录音"路径的关键差别）：
 *
 * 1. **不转码、不假定格式**。手机端只负责把原始字节安全存下来并如实记录格式；
 *    真正的解码/转码交给桌面端（`python_stt/audio_probe.py` + `convert_audio.py` + PyAV）。
 *    这样"支持多种格式"不受浏览器解码能力限制——浏览器放不了的，照样能导入并导出到电脑。
 *
 * 2. **可播放性单独判断并如实告知**。导入成功 ≠ 本机能播放。
 *    不能播放的格式会明确提示"已导入，可导出到电脑处理，但本机无法播放"，而不是假装一切正常。
 *
 * 3. **不把导入时间冒充录制时间**（沿用 B1 约定：录制时间不可靠时留空）。
 */
import { sha256Hex } from './hash';
import { randomId } from './id';
import type { LocalAudioAsset, LocalMemory, MemoryStore } from './types';

/** 单文件上限。超过时拒绝并说明原因，避免手机上内存被吃满。 */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 读取时长的超时。拿不到就留空，**不猜一个默认值**。 */
const DURATION_TIMEOUT_MS = 6000;

/** 按魔数识别容器。顺序有意义：先匹配到的胜出。 */
const MAGIC_TABLE: { bytes: number[]; offset?: number; format: string }[] = [
  { bytes: [0x52, 0x49, 0x46, 0x46], format: 'riff' }, // RIFF，需再看子类型
  { bytes: [0x4f, 0x67, 0x67, 0x53], format: 'ogg' }, // OggS
  { bytes: [0x66, 0x4c, 0x61, 0x43], format: 'flac' }, // fLaC
  { bytes: [0x49, 0x44, 0x33], format: 'mp3' }, // ID3 标签
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], format: 'webm' }, // EBML
  { bytes: [0x23, 0x21, 0x41, 0x4d, 0x52], format: 'amr' }, // #!AMR
  { bytes: [0x30, 0x26, 0xb2, 0x75], format: 'wma' }, // ASF
  { bytes: [0x63, 0x61, 0x66, 0x66], format: 'caf' }, // caff
  { bytes: [0x46, 0x4f, 0x52, 0x4d], format: 'aiff' }, // FORM
  { bytes: [0x2e, 0x73, 0x6e, 0x64], format: 'au' }, // .snd
  { bytes: [0x4d, 0x41, 0x43, 0x20], format: 'ape' }, // MAC␠
];

/** MPEG 帧同步（无 ID3 的裸 mp3）。 */
function looksLikeMpegFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function startsWith(bytes: Uint8Array, pattern: number[], offset = 0): boolean {
  if (bytes.length < offset + pattern.length) return false;
  return pattern.every((byte, index) => bytes[offset + index] === byte);
}

/** 扩展名兜底表（魔数认不出时使用）。 */
const EXTENSION_MAP: Record<string, string> = {
  wav: 'wav',
  wave: 'wav',
  mp3: 'mp3',
  m4a: 'm4a',
  m4b: 'm4b',
  mp4: 'm4a',
  aac: 'aac',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'opus',
  flac: 'flac',
  webm: 'webm',
  amr: 'amr',
  awb: 'amr',
  wma: 'wma',
  aiff: 'aiff',
  aif: 'aiff',
  aifc: 'aiff',
  caf: 'caf',
  au: 'au',
  snd: 'au',
  '3gp': '3gp',
  '3gpp': '3gp',
  ape: 'ape',
  wv: 'wavpack',
  gsm: 'gsm',
  sln: 'sln',
  mp2: 'mp2',
  ac3: 'ac3',
  dts: 'dts',
  ra: 'ra',
  vox: 'vox',
};

/** 扩展名 → 常见 MIME，仅用于填写展示字段；不参与判定。 */
const MIME_MAP: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  mp2: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  amr: 'audio/amr',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  au: 'audio/basic',
  '3gp': 'audio/3gpp',
};

export interface DetectedFormat {
  /** 归一化后的容器/编码名，写入 sourceFormat */
  format: string;
  /** 用作导出的文件扩展名 */
  extension: string;
}

/**
 * 取文件扩展名（小写，不含点）。
 *
 * 不能直接用 `split('.').pop()`：没有点时它会返回**整个文件名**，
 * 于是 `"blob"` 会被当成扩展名 "blob"。这里显式处理没有点的情形。
 */
function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return '';
  return fileName.slice(index + 1).toLowerCase();
}

/** 从文件头字节 + 文件名后缀判断格式。魔数优先，扩展名兜底。 */
export function detectAudioFormat(fileName: string, head: Uint8Array): DetectedFormat {
  const fromName = extensionOf(fileName);

  for (const entry of MAGIC_TABLE) {
    if (!startsWith(head, entry.bytes)) continue;
    if (entry.format === 'riff') {
      // RIFF 容器里可能是 WAVE（音频）或 WEBP（图片），必须看子类型
      const sub = String.fromCharCode(...head.slice(8, 12));
      if (sub === 'WAVE') return { format: 'wav', extension: 'wav' };
      continue;
    }
    const extension = entry.format === 'amr' && fromName === 'awb' ? 'awb' : entry.format;
    return { format: entry.format, extension };
  }

  // ISO-BMFF：偏移 4 处是 ftyp
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    if (brand.startsWith('M4B')) return { format: 'm4b', extension: 'm4b' };
    if (brand.startsWith('M4A')) return { format: 'm4a', extension: 'm4a' };
    if (brand.startsWith('3gp')) return { format: '3gp', extension: '3gp' };
    return { format: 'm4a', extension: 'm4a' };
  }

  if (looksLikeMpegFrame(head)) return { format: 'mp3', extension: 'mp3' };

  const byExtension = EXTENSION_MAP[fromName];
  if (byExtension) return { format: byExtension, extension: byExtension };

  // 认不出就如实标记，不编造一个"看起来合理"的格式
  return { format: fromName || 'unknown', extension: fromName || 'bin' };
}

/** 文件名去掉扩展名，作为默认标题。 */
function titleFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || fileName;
}

/**
 * 尝试读取时长。
 *
 * 能拿到 `loadedmetadata` 说明**这个浏览器能解码该文件**，顺带得到时长；
 * 拿不到则 `playable = false`，时长留空——不伪造。
 * 注意：能解码 ≠ 文件内容完整（截断的文件有时也能读出头部元数据）。
 */
async function readDurationAndPlayability(
  blob: Blob,
): Promise<{ durationSecs?: number; playable: boolean }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let settled = false;

    const finish = (result: { durationSecs?: number; playable: boolean }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        // 释放失败无所谓
      }
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish({ playable: false }), DURATION_TIMEOUT_MS);

    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      finish({
        durationSecs: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
        playable: true,
      });
    };
    audio.onerror = () => finish({ playable: false });

    try {
      audio.src = url;
    } catch {
      finish({ playable: false });
    }
  });
}

export interface ImportedFileResult {
  fileName: string;
  ok: boolean;
  /** 失败原因（ok=false 时） */
  reason?: string;
  playable?: boolean;
  format?: string;
}

export interface ImportSummary {
  imported: number;
  failed: ImportedFileResult[];
  /** 已导入但本机无法播放的数量 */
  unplayable: number;
  /** 总字节数 */
  bytes: number;
  /** 逐文件结果（含可播放性与识别到的格式），供 UI 如实展示 */
  results: ImportedFileResult[];
}

export interface ImportOptions {
  /**
   * 存储实现由调用方注入。
   * 这样本模块不必从适配层入口取单例，避免 audioImport ↔ index 的循环依赖。
   */
  store: MemoryStore;
  onProgress?: (done: number, total: number, current: string) => void;
}

/**
 * 把用户选中的音频文件导入为素材。
 *
 * 逐个处理，单个失败不影响其余文件（结果里逐条说明）。
 */
export async function importAudioFiles(
  files: File[],
  options: ImportOptions,
): Promise<ImportSummary> {
  const { store, onProgress } = options;
  const summary: ImportSummary = { imported: 0, failed: [], unplayable: 0, bytes: 0, results: [] };
  let index = 0;

  for (const file of files) {
    index += 1;
    onProgress?.(index - 1, files.length, file.name);

    try {
      if (file.size === 0) throw new Error('文件为空');
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(0)} MB），上限 200 MB`);
      }

      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const detected = detectAudioFormat(file.name, head);
      const probe = await readDurationAndPlayability(file);
      const digest = await sha256Hex(file);

      const now = new Date();
      const asset: LocalAudioAsset = {
        assetId: randomId(),
        originalFilename: file.name,
        sourceFormat: detected.format,
        mimeType: file.type || MIME_MAP[detected.extension] || 'application/octet-stream',
        durationSecs: probe.durationSecs,
        sizeBytes: file.size,
        sha256: digest,
      };

      const memory: LocalMemory = {
        recordId: randomId(),
        revision: 1,
        title: titleFromFilename(file.name),
        body: '',
        // 导入时间不是录制时间，两者不能混为一谈 → 留空，交由用户补填
        recordedAt: undefined,
        eventDatePrecision: 'unknown',
        people: [],
        tags: ['导入'],
        audio: asset,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      // 与录音共用同一条原子提交路径（无分片，故不传 recordingId）
      await store.commitRecording(memory, file);

      summary.imported += 1;
      summary.bytes += file.size;
      if (!probe.playable) summary.unplayable += 1;
      summary.results.push({
        fileName: file.name,
        ok: true,
        playable: probe.playable,
        format: detected.format,
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      const failure: ImportedFileResult = { fileName: file.name, ok: false, reason };
      summary.failed.push(failure);
      summary.results.push(failure);
    }

    onProgress?.(index, files.length, file.name);
  }

  return summary;
}
