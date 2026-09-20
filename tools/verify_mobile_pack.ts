/**
 * 验证手机端打包器（`src/mobile/adapters/packExport.ts`）产出的 `.svpack`
 * 与桌面端解析器所要求的格式一致。
 *
 * 为什么要单独跑这一层：手机端在浏览器里生成包，桌面端在 Rust 里解析包，
 * 两边是**两套独立实现**。只做类型检查和构建通过，证明不了"手机上导出的包电脑能导入"。
 *
 * 用法：
 *   npx tsx tools/verify_mobile_pack.ts
 *
 * 产出：tools/pack_samples/mobile_generated.svpack
 * 之后可用 `python tools/validate_pack_samples.py` 或桌面端「导入素材包」进一步验证。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack } from '../src/mobile/adapters/packExport';
import type { LocalMemory } from '../src/mobile/adapters/types';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, 'pack_samples', 'mobile_generated.svpack');

/** 合成一段 16bit PCM 的 WAV（与 B2 样例同样的做法，不含任何真实素材）。 */
function synthWav(freq: number, seconds: number, sampleRate = 16000): Blob {
  const frames = Math.floor(sampleRate * seconds);
  const dataBytes = frames * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < frames; index += 1) {
    const sample = Math.round(32767 * 0.3 * Math.sin((2 * Math.PI * freq * index) / sampleRate));
    view.setInt16(44 + index * 2, sample, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

const audioA = synthWav(440, 1.0);
const audioB = synthWav(660, 0.6);
const audioById = new Map<string, Blob>([
  ['asset-a', audioA],
  ['asset-b', audioB],
]);

const memories: LocalMemory[] = [
  {
    recordId: 'mobile-rec-1',
    revision: 1,
    title: '手机端样例一',
    body: '用于验证手机端打包器与桌面端解析器一致。',
    recordedAt: '2026-09-19T10:00:00.000Z',
    eventDateText: '2026年9月',
    eventDatePrecision: 'month',
    people: ['测试人'],
    location: '测试地点',
    tags: ['手机端'],
    notes: undefined,
    audio: {
      assetId: 'asset-a',
      originalFilename: '录音-a.wav',
      sourceFormat: 'wav',
      mimeType: 'audio/wav',
      durationSecs: 1,
      sampleRate: 16000,
      sizeBytes: audioA.size,
      sha256: '',
    },
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
  },
  {
    recordId: 'mobile-rec-2',
    revision: 3,
    title: '手机端样例二',
    body: '第二条记录，含一个音频。',
    recordedAt: '2026-09-19T11:00:00.000Z',
    people: [],
    tags: [],
    audio: {
      assetId: 'asset-b',
      originalFilename: '录音-b.wav',
      sourceFormat: 'wav',
      mimeType: 'audio/wav',
      durationSecs: 0.6,
      sampleRate: 16000,
      sizeBytes: audioB.size,
      sha256: '',
    },
    createdAt: '2026-09-19T11:00:00.000Z',
    updatedAt: '2026-09-19T11:00:00.000Z',
  },
  {
    recordId: 'mobile-rec-3',
    revision: 1,
    title: '纯文字记录',
    body: '没有音频的记录也要能一起导出。',
    people: [],
    tags: ['文字'],
    createdAt: '2026-09-19T12:00:00.000Z',
    updatedAt: '2026-09-19T12:00:00.000Z',
  },
];

const pack = await buildPack(memories, async (assetId) => audioById.get(assetId) ?? null);

const bytes = Buffer.from(await pack.blob.arrayBuffer());
writeFileSync(outPath, bytes);

// 自检：读回容器头，确认结构符合预期
const magic = bytes.subarray(0, 8).toString('latin1');
const manifestLen = bytes.readUInt32LE(8);
const manifestSha = bytes.subarray(12, 44).toString('hex');
const manifestJson = bytes.subarray(44, 44 + manifestLen).toString('utf8');
const manifest = JSON.parse(manifestJson);

console.log('文件           :', outPath);
console.log('大小           :', bytes.length, 'bytes');
console.log('magic          :', JSON.stringify(magic), magic === 'SVPACK1\0' ? 'OK' : 'MISMATCH');
console.log('manifest 长度  :', manifestLen);
console.log('manifest sha   :', manifestSha.slice(0, 16) + '…');
console.log('formatVersion  :', manifest.formatVersion);
console.log('recordCount    :', manifest.recordCount);
console.log('audioCount     :', manifest.audioCount);
console.log('records.sha256 :', String(manifest.records.sha256).slice(0, 16) + '…');
console.log('audio 条目     :', manifest.audio.map((a: { path: string }) => a.path).join(', '));
console.log('');
console.log('打包结果       :', JSON.stringify({
  recordCount: pack.recordCount,
  audioCount: pack.audioCount,
  missingAudio: pack.missingAudio,
}));

if (magic !== 'SVPACK1\0') {
  console.error('容器魔数不正确');
  process.exit(1);
}
if (manifest.formatVersion !== 1) {
  console.error('formatVersion 不正确');
  process.exit(1);
}
if (pack.recordCount !== memories.length) {
  console.error('recordCount 与输入不符');
  process.exit(1);
}
if (pack.audioCount !== 2) {
  console.error('audioCount 应为 2');
  process.exit(1);
}
console.log('\n自检通过。下一步：用桌面端解析器校验该文件。');
