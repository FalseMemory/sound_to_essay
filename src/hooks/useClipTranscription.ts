import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { VoiceClip } from '../types';

export interface TranscribeOutcome {
  ok: boolean;
  message: string;
}

/**
 * A1：创作区片段的转写（首次与重新转写共用同一入口）。
 *
 * 关键约定：
 * - 片段在调用前就已经被登记进项目（音频被引用），所以转写失败不会被
 *   「清理未引用录音」当成孤儿文件删除。
 * - 状态 pending / processing / success / failed 写入片段并随项目持久化，
 *   因此重启后仍能看到「转写失败」并重新转写。
 */
export function useClipTranscription() {
  const settings = useSettingsStore((s) => s.settings);
  const setClipRawText = useProjectStore((s) => s.setClipRawText);
  const setClipTranscriptionState = useProjectStore((s) => s.setClipTranscriptionState);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);

  const transcribeClip = useCallback(
    async (clip: VoiceClip): Promise<TranscribeOutcome> => {
      if (!clip.audioPath) {
        const message = '该片段没有关联音频文件，无法转写。';
        setClipTranscriptionState(clip.id, 'failed', message);
        return { ok: false, message };
      }

      setBusyClipId(clip.id);
      setClipTranscriptionState(clip.id, 'processing');
      try {
        const result = await invoke<{ text: string; confidence: number }>('transcribe_audio', {
          audioPath: clip.audioPath,
          modelSize: settings.whisperModel,
          language: settings.whisperLanguage,
          modelDir: settings.whisperModelDir || undefined,
        });
        const text = (result?.text ?? '').trim();
        if (!text) {
          const message = '未识别到文字。音频已保留，可重新转写。';
          setClipTranscriptionState(clip.id, 'failed', message);
          return { ok: false, message };
        }
        // 只覆盖机器转写（rawText）；用户的人工校订（editedText）不受影响。
        setClipRawText(clip.id, result.text);
        setClipTranscriptionState(clip.id, 'success');
        return { ok: true, message: `已识别 ${result.text.length} 字` };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setClipTranscriptionState(clip.id, 'failed', message);
        return { ok: false, message };
      } finally {
        setBusyClipId(null);
      }
    },
    [settings, setClipRawText, setClipTranscriptionState]
  );

  return { transcribeClip, busyClipId };
}
