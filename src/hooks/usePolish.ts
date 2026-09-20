import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import { clipWorkingText } from '../types';

const FRONTEND_TIMEOUT_SECS = 200;

export function usePolish() {
  const project = useProjectStore((s) => s.project);
  const setPolishedText = useProjectStore((s) => s.setPolishedText);
  const setPolishing = useProjectStore((s) => s.setPolishing);
  const isPolishing = useProjectStore((s) => s.isPolishing);
  const settings = useSettingsStore((s) => s.settings);
  const [tier, setTier] = useState<'faithful' | 'creative'>('faithful');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPolishing) {
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPolishing]);

  const run = async () => {
    if (!project || project.clips.length === 0) return;
    setPolishing(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const rawText = project.clips.map(clipWorkingText).join('\n');
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`整理超时（超过 ${FRONTEND_TIMEOUT_SECS} 秒），已停止`)),
          FRONTEND_TIMEOUT_SECS * 1000
        )
      );
      const result = await Promise.race([
        invoke<string>('ai_polish', { text: rawText, tier, config: settings.llm.polish }),
        timeout,
      ]);
      setPolishedText(result);
    } catch (e: any) {
      alert('AI 整理失败: ' + String(e));
    } finally {
      setPolishing(false);
    }
  };

  return { tier, setTier, isPolishing, elapsed, run };
}
