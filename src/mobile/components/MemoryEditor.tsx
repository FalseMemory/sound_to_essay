/**
 * C2/C3：素材编辑器。同时承担两件事：
 * - **新建纯文字记忆**（无音频）——C2 要求
 * - **编辑已有素材的元数据**（标题、正文、时间、人物、地点、标签、备注）——C3 要求
 *
 * 两条约定：
 * - 编辑时**保留 recordId、只递增 revision**（协议要求：改内容不换 ID），
 *   否则跨设备去重与更新会失配。
 * - 模糊事件时间以「原文 + 精度」保存，**不强行解析成精确时间戳**。
 */
import { useState } from 'react';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { randomId, store } from '../adapters';
import type { EventDatePrecision, LocalMemory } from '../adapters';

export interface MemoryEditorProps {
  /** null 表示新建文字记录 */
  memory: LocalMemory | null;
  onSaved: () => void;
  onCancel: () => void;
}

const PRECISION_OPTIONS: { value: EventDatePrecision; label: string }[] = [
  { value: 'unknown', label: '未标注' },
  { value: 'day', label: '某天' },
  { value: 'month', label: '某月' },
  { value: 'year', label: '某年' },
  { value: 'decade', label: '某个年代' },
];

/** ISO 字符串 → `datetime-local` 输入框需要的本地时间格式。 */
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` 的本地时间 → 带时区的 ISO 字符串。 */
function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** 逗号 / 顿号 / 空格分隔 → 去重后的数组。 */
function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，、\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

const labelClass = 'block text-xs font-semibold text-[var(--text-secondary)]';
const inputClass = 'control mt-1.5 w-full';

export function MemoryEditor({ memory, onSaved, onCancel }: MemoryEditorProps) {
  const isNew = !memory;
  const [title, setTitle] = useState(memory?.title ?? '');
  const [body, setBody] = useState(memory?.body ?? '');
  const [recordedAt, setRecordedAt] = useState(toLocalInput(memory?.recordedAt));
  const [eventDateText, setEventDateText] = useState(memory?.eventDateText ?? '');
  const [precision, setPrecision] = useState<EventDatePrecision>(
    memory?.eventDatePrecision ?? 'unknown',
  );
  const [people, setPeople] = useState((memory?.people ?? []).join('、'));
  const [location, setLocation] = useState(memory?.location ?? '');
  const [tags, setTags] = useState((memory?.tags ?? []).join('、'));
  const [notes, setNotes] = useState(memory?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify([title,body,recordedAt,eventDateText,precision,people,location,tags,notes]) !==
    JSON.stringify([memory?.title ?? '',memory?.body ?? '',toLocalInput(memory?.recordedAt),memory?.eventDateText ?? '',memory?.eventDatePrecision ?? 'unknown',(memory?.people ?? []).join('、'),memory?.location ?? '',(memory?.tags ?? []).join('、'),memory?.notes ?? '']);
  useUnsavedGuard(dirty && !saving, '[data-mobile-editor]');

  const handleSave = async () => {
    if (saving) return;
    if (!dirty && memory) { onSaved(); return; }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('标题不能为空。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const next: LocalMemory = {
        recordId: memory?.recordId ?? randomId(),
        // 改动内容递增 revision，但**不换 ID**
        revision: memory ? memory.revision + 1 : 1,
        title: trimmedTitle,
        body,
        recordedAt: fromLocalInput(recordedAt),
        eventDateText: eventDateText.trim() || undefined,
        eventDatePrecision: precision,
        people: splitList(people),
        location: location.trim() || undefined,
        tags: splitList(tags),
        notes: notes.trim() || undefined,
        // 音频与导出状态原样保留
        audio: memory?.audio,
        lastExportedAt: undefined,
        createdAt: memory?.createdAt ?? now,
        updatedAt: now,
      };
      await store.put(next);
      onSaved();
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div data-mobile-editor className="px-5 pb-10 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {isNew ? '写一条文字记录' : '编辑素材'}
        </h2>
        <button
          disabled={saving}
          onClick={() => { if (!dirty || window.confirm('修改尚未保存，放弃吗？')) onCancel(); }}
          className="touch-target rounded-lg px-3 text-sm text-[var(--text-secondary)]"
        >
          取消
        </button>
      </div>

      {isNew && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          文字记录不需要音频，适合写一句提醒或一段回忆。
        </p>
      )}

      <div className="mt-5 space-y-4">
        <div>
          <label className={labelClass} htmlFor="memory-title">
            标题 <span className="text-[var(--error)]">*</span>
          </label>
          <input
            id="memory-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：小时候的院子"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-body">
            正文
          </label>
          <textarea
            id="memory-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            placeholder="想记下什么都可以"
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-recorded-at">
            录音 / 记录时间
          </label>
          <input
            id="memory-recorded-at"
            type="datetime-local"
            value={recordedAt}
            onChange={(event) => setRecordedAt(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">留空表示未记录时间。</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-event-date">
            回忆发生的时间（可以模糊）
          </label>
          <input
            id="memory-event-date"
            value={eventDateText}
            onChange={(event) => setEventDateText(event.target.value)}
            placeholder="例如：大约 1995 年夏天"
            className={inputClass}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRECISION_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setPrecision(option.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  precision === option.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            模糊时间会按原文保存，不会被强行换算成精确日期。
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-people">
            人物
          </label>
          <input
            id="memory-people"
            value={people}
            onChange={(event) => setPeople(event.target.value)}
            placeholder="用逗号分隔，例如：母亲、姐姐"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-location">
            地点
          </label>
          <input
            id="memory-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="例如：北京"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-tags">
            标签
          </label>
          <input
            id="memory-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="用逗号分隔，例如：童年、家庭"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="memory-notes">
            备注
          </label>
          <textarea
            id="memory-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="给自己的说明，例如录音质量、待补充的内容"
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </div>
      </div>

      {error && (
        <p className="wrap-anywhere mt-4 rounded-xl border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3 text-xs text-[var(--error)]">
          {error}
        </p>
      )}

      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="touch-target mt-6 w-full rounded-xl bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {saving ? '保存中…' : isNew ? '保存文字记录' : '保存修改'}
      </button>

      {!isNew && (
        <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--text-secondary)]">
          修改会作为新修订保存（修订号 +1），记录标识保持不变，导入电脑后仍能正确对应。
        </p>
      )}
    </div>
  );
}
