/**
 * D2：手机端诊断日志。
 *
 * 计划要求「记录中断原因及诊断信息，但**日志不包含口述正文**」。
 *
 * 两个刻意的设计选择：
 *
 * 1. **用 localStorage 而不是 IndexedDB。**
 *    诊断日志是辅助信息，不需要事务保证；而 IndexedDB 的 schema 变更（加仓库/升版本）
 *    在 Safari 上存在阻塞与迁移风险。为一份日志去动主存储的版本，风险不成比例。
 *
 * 2. **只记结构化元数据，绝不记正文。**
 *    调用方只传计数、字节数、错误类别这类信息；本模块另外做一次长度截断与换行折叠，
 *    避免有人图省事把整段文字塞进 detail。
 *
 * 日志上限 100 条，超出丢弃最旧的。
 */

const STORAGE_KEY = 'sound_to_essay_diagnostics';
const MAX_ENTRIES = 100;
/** detail 的长度上限，超出截断——正文往往很长，截断本身也是一道防线。 */
const MAX_DETAIL_CHARS = 200;

export type DiagnosticKind =
  | 'recording-start'
  | 'recording-interrupted'
  | 'recording-saved'
  | 'recording-failed'
  | 'recording-discarded'
  | 'chunk-write-failed'
  | 'recovery'
  | 'import'
  | 'export'
  | 'storage'
  | 'error';

export interface DiagnosticEntry {
  /** ISO 时间 */
  at: string;
  kind: DiagnosticKind;
  /** 结构化摘要，**不得包含口述正文** */
  detail: string;
}

function storage(): Storage | null {
  try {
    // 无痕模式或存储被禁用时访问会抛错
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** 折叠换行并截断，防止意外写入长文本（尤其是正文）。 */
function sanitize(detail: string): string {
  const flat = detail.replace(/[\r\n\t]+/g, ' ').trim();
  return flat.length > MAX_DETAIL_CHARS ? `${flat.slice(0, MAX_DETAIL_CHARS)}…` : flat;
}

function readAll(): DiagnosticEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DiagnosticEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as DiagnosticEntry).at === 'string' &&
        typeof (item as DiagnosticEntry).detail === 'string',
    );
  } catch {
    // 日志本身坏了不该影响功能
    return [];
  }
}

function writeAll(entries: DiagnosticEntry[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // 配额满或被禁用，静默放弃——诊断日志不能反过来影响主流程
  }
}

/**
 * 记一条诊断信息。**同步、永不抛错**——它是旁路，不该影响录音主流程。
 *
 * detail 只放元数据，例如 `分片 12 个 / 480 KB`、`NotAllowedError`，**不要放口述内容**。
 */
export function logDiagnostic(kind: DiagnosticKind, detail = ''): void {
  try {
    const entries = readAll();
    entries.push({ at: new Date().toISOString(), kind, detail: sanitize(detail) });
    writeAll(entries);
  } catch {
    // 永不抛出
  }
}

/** 读取最近的诊断记录（默认全部，新的在后）。 */
export function listDiagnostics(limit = MAX_ENTRIES): DiagnosticEntry[] {
  const all = readAll();
  return limit >= all.length ? all : all.slice(-limit);
}

/** 清空诊断记录。 */
export function clearDiagnostics(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

/** 是否可用（无痕模式下可能不可用），供设置页如实展示。 */
export function isDiagnosticsAvailable(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const probe = '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** 导出为可读文本，便于用户提供给开发者排查。 */
export function formatDiagnostics(entries: DiagnosticEntry[]): string {
  if (entries.length === 0) return '（暂无诊断记录）';
  return entries
    .map((e) => `${e.at}  [${e.kind}]  ${e.detail}`)
    .join('\n');
}
