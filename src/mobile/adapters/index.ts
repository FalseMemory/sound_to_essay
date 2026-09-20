/**
 * C1：手机端平台适配层入口。
 *
 * 业务代码只从这里拿能力（store / recorder / exporter），
 * 不直接触碰 Tauri、也不直接写 IndexedDB 或 MediaRecorder，
 * 以便将来替换实现或增加新的承载方式。
 */
import { createExporterAdapter, isWebShareAvailable } from './exporter';
import {
  createMediaRecorderAdapter,
  isRecordingSupported,
  isSecureContext,
  pickAudioFormat,
} from './recorder';
import { createIndexedDbStore, isIndexedDbAvailable } from './storage';
import type { PlatformCapabilities } from './types';

export * from './types';
export { sha256Hex, hasWebCrypto } from './hash';
export { randomId } from './id';
export { buildPack } from './packExport';
export type { PackBuildResult } from './packExport';
export {
  logDiagnostic,
  listDiagnostics,
  clearDiagnostics,
  isDiagnosticsAvailable,
  formatDiagnostics,
} from './diagnostics';
export type { DiagnosticEntry, DiagnosticKind } from './diagnostics';
export { importAudioFiles, detectAudioFormat } from './audioImport';
export type {
  ImportSummary,
  ImportedFileResult,
  DetectedFormat,
  ImportOptions,
} from './audioImport';
export { diagnoseRecording } from './recorder';
export type { RecordingDiagnosis } from './recorder';

/** 本地素材存储（IndexedDB）。 */
export const store = createIndexedDbStore();

/** 录音能力。做成模块级单例：组件重建时不会丢失正在进行的录音。 */
export const recorder = createMediaRecorderAdapter();

/** 素材包导出（系统分享 / 文件下载）。 */
export const exporter = createExporterAdapter();

/** 一次性探测当前浏览器能力，供设置页如实展示（不夸大）。 */
export function detectCapabilities(): PlatformCapabilities {
  return {
    hasMediaRecorder: isRecordingSupported(),
    hasGetUserMedia: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    hasIndexedDb: isIndexedDbAvailable(),
    hasWebShare: isWebShareAvailable(),
    audioFormat: pickAudioFormat(),
  };
}

/**
 * 是否运行在安全上下文（https 或 localhost）。
 * 不满足时录音与 Web Crypto 的摘要能力都会不可用。
 */
export const isSecureContextAvailable = isSecureContext;
