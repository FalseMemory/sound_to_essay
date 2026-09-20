/**
 * 验证手机端音频格式探测（`src/mobile/adapters/audioImport.ts` 的 `detectAudioFormat`）。
 *
 * 为什么单独跑这一层：格式判断错会把"webm 当 wav"这类错误一路带到导出和桌面端导入，
 * 而它本身是纯函数，最适合直接喂字节验证。
 *
 * 用法：npx tsx tools/verify_audio_detect.ts
 */
import { detectAudioFormat } from '../src/mobile/adapters/audioImport';

/** 用给定字节填充文件头（不足 16 字节时补零，与真实读取行为一致）。 */
function head(...bytes: number[]): Uint8Array {
  const out = new Uint8Array(16);
  out.set(bytes.slice(0, 16));
  return out;
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

interface Case {
  name: string;
  fileName: string;
  bytes: Uint8Array;
  expectFormat: string;
  expectExtension: string;
}

const cases: Case[] = [
  // --- 魔数识别 ---
  { name: 'WAV (RIFF/WAVE)', fileName: 'a.wav', bytes: head(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')), expectFormat: 'wav', expectExtension: 'wav' },
  { name: 'Ogg', fileName: 'a.ogg', bytes: head(...ascii('OggS')), expectFormat: 'ogg', expectExtension: 'ogg' },
  { name: 'FLAC', fileName: 'a.flac', bytes: head(...ascii('fLaC')), expectFormat: 'flac', expectExtension: 'flac' },
  { name: 'MP3 (ID3 tag)', fileName: 'a.mp3', bytes: head(...ascii('ID3')), expectFormat: 'mp3', expectExtension: 'mp3' },
  { name: 'MP3 (bare frame sync)', fileName: 'noext', bytes: head(0xff, 0xfb, 0x90, 0x00), expectFormat: 'mp3', expectExtension: 'mp3' },
  { name: 'WebM/Matroska (EBML)', fileName: 'a.webm', bytes: head(0x1a, 0x45, 0xdf, 0xa3), expectFormat: 'webm', expectExtension: 'webm' },
  { name: 'AMR', fileName: 'a.amr', bytes: head(...ascii('#!AMR')), expectFormat: 'amr', expectExtension: 'amr' },
  { name: 'AMR-WB', fileName: 'a.awb', bytes: head(...ascii('#!AMR-WB')), expectFormat: 'amr', expectExtension: 'awb' },
  { name: 'WMA (ASF)', fileName: 'a.wma', bytes: head(0x30, 0x26, 0xb2, 0x75), expectFormat: 'wma', expectExtension: 'wma' },
  { name: 'CAF', fileName: 'a.caf', bytes: head(...ascii('caff')), expectFormat: 'caf', expectExtension: 'caf' },
  { name: 'AIFF (FORM)', fileName: 'a.aiff', bytes: head(...ascii('FORM'), 0, 0, 0, 0, ...ascii('AIFF')), expectFormat: 'aiff', expectExtension: 'aiff' },
  { name: 'AU', fileName: 'a.au', bytes: head(...ascii('.snd')), expectFormat: 'au', expectExtension: 'au' },

  // --- ISO-BMFF（偏移 4 处 ftyp）---
  { name: 'M4A', fileName: 'a.m4a', bytes: head(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('M4A ')), expectFormat: 'm4a', expectExtension: 'm4a' },
  { name: 'M4B', fileName: 'a.m4b', bytes: head(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('M4B ')), expectFormat: 'm4b', expectExtension: 'm4b' },
  { name: '3GP', fileName: 'a.3gp', bytes: head(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('3gp4')), expectFormat: '3gp', expectExtension: '3gp' },
  { name: 'MP4 无扩展名', fileName: 'recording', bytes: head(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('isom')), expectFormat: 'm4a', expectExtension: 'm4a' },

  // --- 关键反例：RIFF 容器但不是音频，不能被当成 wav ---
  { name: 'WEBP 图片（RIFF 容器）', fileName: 'photo.webp', bytes: head(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')), expectFormat: 'webp', expectExtension: 'webp' },

  // --- 扩展名兜底 ---
  { name: 'Opus（无已知魔数）', fileName: 'voice.opus', bytes: head(0, 1, 2, 3), expectFormat: 'opus', expectExtension: 'opus' },
  { name: 'GSM（无已知魔数）', fileName: 'old.gsm', bytes: head(9, 9, 9), expectFormat: 'gsm', expectExtension: 'gsm' },
  { name: 'MP4 扩展名（无 ftyp）', fileName: 'clip.mp4', bytes: head(0, 0, 0, 0), expectFormat: 'm4a', expectExtension: 'm4a' },

  // --- 完全认不出：如实标记，不编造 ---
  { name: '未知扩展名', fileName: 'mystery.xyz', bytes: head(0xaa, 0xbb), expectFormat: 'xyz', expectExtension: 'xyz' },
  { name: '无扩展名且无魔数', fileName: 'blob', bytes: head(0xaa, 0xbb), expectFormat: 'unknown', expectExtension: 'bin' },
  { name: '空文件头', fileName: 'empty', bytes: new Uint8Array(0), expectFormat: 'unknown', expectExtension: 'bin' },
  { name: '空文件头 + 已知扩展名', fileName: 'empty.flac', bytes: new Uint8Array(0), expectFormat: 'flac', expectExtension: 'flac' },
];

let failed = 0;

for (const testCase of cases) {
  const actual = detectAudioFormat(testCase.fileName, testCase.bytes);
  const ok = actual.format === testCase.expectFormat && actual.extension === testCase.expectExtension;
  if (!ok) failed += 1;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(
    `${mark} ${testCase.name.padEnd(28)} → format=${actual.format} ext=${actual.extension}` +
      (ok ? '' : `   （期望 format=${testCase.expectFormat} ext=${testCase.expectExtension}）`),
  );
}

console.log('');
console.log(`共 ${cases.length} 项，失败 ${failed} 项。`);

if (failed > 0) {
  console.error('格式探测存在不符合预期的情况。');
  process.exit(1);
}
console.log('格式探测自检通过。');
