import { useEffect, useRef, useState } from 'react';
import type { EssayStyle } from '../types';
import { clipWorkingText } from '../types';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
const BUILTIN_STYLES: EssayStyle[] = [
  { id: 'zhu-ziqing', name: '朱自清散文', description: '细腻白描，情景交融，语言清新', prompt: '以朱自清散文风格写作，注重景物描写与情感的交融，语言清新自然，多用比喻和细腻的白描手法' },
  { id: 'lu-xun', name: '鲁迅杂文', description: '冷峻犀利，夹叙夹议，一针见血', prompt: '以鲁迅杂文风格写作，语言冷峻犀利，夹叙夹议，对社会现象有深刻洞察，一针见血' },
  { id: 'wang-zengqi', name: '汪曾祺散文', description: '平淡质朴，生活气息，娓娓道来', prompt: '以汪曾祺散文风格写作，语言平淡质朴，充满生活气息，对日常事物有独特的观察和感悟' },
  { id: 'diary', name: '简洁日记体', description: '干净利落，时间线叙事', prompt: '以简洁日记体写作，干净利落，按时间线叙事，第一人称，语言直接不修饰' },
  { id: 'essay', name: '知性随笔', description: '带有书卷气，思辨与叙述结合', prompt: '以知性随笔风格写作，带有书卷气，将思辨与叙事结合，有独到的见解和感悟' },
  { id: 'warm', name: '温暖治愈', description: '柔和细腻，情感充沛', prompt: '以温暖治愈风格写作，柔和细腻，情感充沛，传递积极向上的力量' },
  { id: 'classical', name: '古文雅韵', description: '半文半白，词句凝练，意境古典', prompt: '以古文雅韵风格写作，半文半白，词句凝练，追求古典意境和韵律美' },
  { id: 'modern-novel', name: '现代小说叙事', description: '第三人称，场景化描写', prompt: '以现代小说叙事风格写作，第三人称，注重场景化描写和氛围营造，有故事感' },
];

export function StyleSelector() {
  const [show, setShow] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [wordCount, setWordCount] = useState(800);
  const isGenerating = useProjectStore((s) => s.isGenerating);
  const setGenerating = useProjectStore((s) => s.setGenerating);
  const project = useProjectStore((s) => s.project);
  const setEssayText = useProjectStore((s) => s.setEssayText);
  const settings = useSettingsStore((s) => s.settings);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Front-end timeout slightly longer than the backend (180s) to let the
  // backend surface its own timeout message first.
  const FRONTEND_TIMEOUT_SECS = 200;

  useEffect(() => {
    if (isGenerating) {
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isGenerating]);

  if (!project || project.clips.length === 0) return null;

  const handleGenerate = async () => {
    if (!selectedStyle && !customPrompt.trim()) return;
    setGenerating(true);

    const style = BUILTIN_STYLES.find((s) => s.id === selectedStyle);
    const stylePrompt = style
      ? `风格：${style.name}\n要求：${style.prompt}`
      : `风格：自定义\n要求：${customPrompt}`;

    const rawText = project.clips.map(clipWorkingText).join('\n');

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`生成超时（超过 ${FRONTEND_TIMEOUT_SECS} 秒），已停止`)), FRONTEND_TIMEOUT_SECS * 1000)
      );
      const result = await Promise.race([
        invoke<string>('generate_essay', {
          text: rawText,
          stylePrompt: stylePrompt,
          wordCount: wordCount,
          config: settings.llm.generate,
        }),
        timeout,
      ]);
      if (!result.trim()) {
        throw new Error('模型返回了空内容');
      }
      setEssayText(result);
      setShow(false);
    } catch (err) {
      console.error('Generate failed:', err);
      alert(`生成失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition disabled:opacity-50 flex items-center gap-2"
        disabled={isGenerating}
      >
        {isGenerating ? (
          <>
            <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            <span>生成中 {elapsed}s</span>
          </>
        ) : (
          '✨ 生成散文'
        )}
      </button>

      {show && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 dark:bg-black/60" onClick={() => setShow(false)}>
          <div
            className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-6 w-[520px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4">选择散文风格</h3>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {BUILTIN_STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => { setSelectedStyle(style.id); setCustomPrompt(''); }}
                  className={`p-3 rounded-lg text-left border transition ${
                    selectedStyle === style.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--bg-tertiary)] hover:border-[var(--text-secondary)]'
                  }`}
                >
                  <div className="text-sm font-medium">{style.name}</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">{style.description}</div>
                </button>
              ))}
            </div>

            <div className="mb-4">
              <label className="text-xs text-[var(--text-secondary)] block mb-1">自定义风格描述</label>
              <input
                type="text"
                className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="如：像村上春树那样写..."
                value={customPrompt}
                onChange={(e) => { setCustomPrompt(e.target.value); setSelectedStyle(null); }}
              />
            </div>

            <div className="mb-6">
              <label className="text-xs text-[var(--text-secondary)] block mb-1">
                字数: {wordCount}
              </label>
              <input
                type="range"
                min={300}
                max={2000}
                step={100}
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div className="flex gap-2 justify-end items-center">
              {isGenerating && (
                <span className="mr-auto flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="w-3 h-3 rounded-full border-2 border-[var(--accent)]/40 border-t-[var(--accent)] animate-spin" />
                  正在生成，已用 {elapsed}s（最长等待 {FRONTEND_TIMEOUT_SECS}s）
                </span>
              )}
              <button
                onClick={() => setShow(false)}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm hover:bg-[var(--border)] transition disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleGenerate}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition disabled:opacity-50"
                disabled={isGenerating || (!selectedStyle && !customPrompt.trim())}
              >
                {isGenerating ? '生成中...' : '生成散文'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
