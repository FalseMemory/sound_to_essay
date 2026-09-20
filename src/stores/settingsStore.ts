import { create } from 'zustand';
import type { AppSettings } from '../types';

const defaultSettings: AppSettings = {
  hotkey: 'Ctrl+Alt+R',
  whisperModel: 'base',
  whisperLanguage: 'zh',
  llm: {
    polish: {
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      modelName: 'qwen2.5:7b',
      maxTokens: 4096,
    },
    generate: {
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      modelName: 'qwen2.5:14b',
      maxTokens: 8192,
    },
  },
  tempAudioMaxAgeHours: 0,
};

interface SettingsStore {
  settings: AppSettings;
  showSettings: boolean;
  setSettings: (s: Partial<AppSettings>) => void;
  toggleSettings: () => void;
  setShowSettings: (v: boolean) => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  showSettings: false,
  setSettings: (s) =>
    set((state) => ({ settings: { ...state.settings, ...s } })),
  toggleSettings: () =>
    set((state) => ({ showSettings: !state.showSettings })),
  setShowSettings: (v) => set({ showSettings: v }),

  loadSettings: async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const data = await invoke<string>('load_settings');
      const parsed = JSON.parse(data);
      set({ settings: { ...defaultSettings, ...parsed } });
    } catch {
      // Use defaults
    }
  },

  saveSettings: async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_settings', { settings: JSON.stringify(get().settings) });
    } catch (e) {
      console.error('Save settings failed:', e);
    }
  },
}));
