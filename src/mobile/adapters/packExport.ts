/**
 * C3：在浏览器端生成 `.svpack` 素材包。
 *
 * 容器格式与桌面端 `src-tauri/src/pack_import.rs` 的解析逻辑严格对齐：
 *
 *   [8]   magic "SVPACK1\0"
 *   [u32] manifest 字节数（小端）
 *   [32]  manifest 的 SHA-256（原始字节，不是 hex）
 *   [..]  manifest JSON（UTF-8）
 *   然后重复若干文件条目：
 *     [u32] 文件名长度
 *     [..]  文件名（UTF-8）
 *     [u64] 数据长度（小端）
 *     [32]  数据的 SHA-256（原始字节）
 *     [..]  数据
 *
 * 注意：**SHA-256 只用于完整性与去重，不构成身份认证**（协议 §6）。
 */
import { sha256Hex } from './hash';
import { randomId } from './id';
import type { LocalMemory } from './types';

const PACK_MAGIC = new Uint8Array([0x53, 0x56, 0x50, 0x41, 0x43, 0x4b, 0x31, 0x00]); // "SVPACK1\0"
const RECORDS_NAME = 'records.json';
const FORMAT_VERSION = 1;

const textEncoder = new TextEncoder();

/**
 * 明确以 ArrayBuffer（而非可能为 SharedArrayBuffer）为底层的字节数组。
 * TS 5.7 起 `Uint8Array` 带泛型参数，`BlobPart` 只接受 ArrayBuffer 版本。
 */
type Bytes = Uint8Array<ArrayBuffer>;

/** 文本 → UTF-8 字节。 */
function encodeText(text: string): Bytes {
  return new Uint8Array(textEncoder.encode(text));
}

function u32(value: number): Bytes {
  const bytes = new Uint8Array(new ArrayBuffer(4));
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value: number): Bytes {
  const bytes = new Uint8Array(new ArrayBuffer(8));
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function hexToBytes(hex: string): Bytes {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** 与协议 records.json 中单条音频对应的结构。 */
interface PackRecordAudio {
  assetId: string;
  originalFilename: string | null;
  sourceFormat: string | null;
  durationSecs: number | null;
  sampleRate: number | null;
  sha256: string;
}

/** 与协议 records.json 中单条记录对应的结构。 */
interface PackRecord {
  recordId: string;
  revision: number;
  title: string;
  body: string;
  recordedAt: string | null;
  eventDateText: string | null;
  eventDatePrecision: string | null;
  people: string[];
  location: string | null;
  tags: string[];
  notes: string | null;
  audio: PackRecordAudio[];
}

interface ManifestAudio {
  assetId: string;
  path: string;
  format: string;
  size: number;
  sha256: string;
}

export interface PackBuildResult {
  blob: Blob;
  filename: string;
  recordCount: number;
  audioCount: number;
  /** 引用了但本地读不到音频的记录数（不伪装成完整导出） */
  missingAudio: number;
}

function timestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * 把选中的素材打包成 `.svpack`。
 *
 * `loadAudio` 由调用方注入（从 IndexedDB 取音频），避免这里耦合具体存储实现。
 * 本地读不到音频时**跳过该音频并计数**，不伪装成完整导出。
 */
export async function buildPack(
  memories: LocalMemory[],
  loadAudio: (assetId: string) => Promise<Blob | null>,
  appVersion = '0.1.0',
): Promise<PackBuildResult> {
  if (memories.length === 0) {
    throw new Error('没有选中的素材可导出。');
  }
  if (memories.reduce((total, memory) => total + (memory.audio?.sizeBytes ?? 0), 0) > 256 * 1024 * 1024) {
    throw new Error('所选音频超过 256 MiB，请分批导出，避免手机内存不足。');
  }

  const records: PackRecord[] = [];
  const manifestAudio: ManifestAudio[] = [];
  // 文件名 -> 数据。records.json 也会作为普通文件条目写入（桌面端按名字查找它）。
  const fileEntries: { name: string; data: Blob | Bytes; sha256: string; size: number }[] = [];
  const missingAudio = 0;
  let audioCount = 0;

  for (const memory of memories) {
    const recordAudio: PackRecordAudio[] = [];

    if (memory.audio) {
      const blob = await loadAudio(memory.audio.assetId);
      if (!blob) {
        throw new Error(`「${memory.title}」的音频在本机缺失，已取消导出，请先恢复音频。`);
      } else {
        // 以实际字节重算校验值，确保包里声明的一定与内容一致
        const digest = await sha256Hex(blob);
        const extension = memory.audio.sourceFormat || 'bin';
        const path = `audio/${memory.audio.assetId}.${extension}`;

        recordAudio.push({
          assetId: memory.audio.assetId,
          originalFilename: memory.audio.originalFilename ?? null,
          sourceFormat: memory.audio.sourceFormat ?? null,
          durationSecs: memory.audio.durationSecs ?? null,
          sampleRate: memory.audio.sampleRate ?? null,
          sha256: digest,
        });
        manifestAudio.push({
          assetId: memory.audio.assetId,
          path,
          format: extension,
          size: blob.size,
          sha256: digest,
        });
        fileEntries.push({ name: path, data: blob, sha256: digest, size: blob.size });
        audioCount += 1;
      }
    }

    records.push({
      recordId: memory.recordId,
      revision: memory.revision,
      title: memory.title,
      body: memory.body,
      recordedAt: memory.recordedAt ?? null,
      eventDateText: memory.eventDateText ?? null,
      eventDatePrecision: memory.eventDatePrecision ?? null,
      people: memory.people ?? [],
      location: memory.location ?? null,
      tags: memory.tags ?? [],
      notes: memory.notes ?? null,
      audio: recordAudio,
    });
  }

  // records.json
  const recordsBytes = encodeText(JSON.stringify(records, null, 2));
  const recordsSha = await sha256Hex(recordsBytes);
  fileEntries.unshift({
    name: RECORDS_NAME,
    data: recordsBytes,
    sha256: recordsSha,
    size: recordsBytes.byteLength,
  });

  // manifest
  const exportedAt = new Date().toISOString();
  const manifest = {
    formatVersion: FORMAT_VERSION,
    packId: randomId(),
    appVersion,
    exportedAt,
    recordCount: records.length,
    audioCount,
    records: { path: RECORDS_NAME, size: recordsBytes.byteLength, sha256: recordsSha },
    audio: manifestAudio,
  };
  const manifestBytes = encodeText(JSON.stringify(manifest, null, 2));
  const manifestSha = await sha256Hex(manifestBytes);

  // 组装容器
  const parts: BlobPart[] = [
    PACK_MAGIC,
    u32(manifestBytes.byteLength),
    hexToBytes(manifestSha),
    manifestBytes,
  ];

  for (const entry of fileEntries) {
    const nameBytes = encodeText(entry.name);
    parts.push(u32(nameBytes.byteLength));
    parts.push(nameBytes);
    parts.push(u64(entry.size));
    parts.push(hexToBytes(entry.sha256));
    parts.push(entry.data);
  }

  return {
    blob: new Blob(parts, { type: 'application/octet-stream' }),
    filename: `声文素材包-${timestampForFilename(new Date())}.svpack`,
    recordCount: records.length,
    audioCount,
    missingAudio,
  };
}
