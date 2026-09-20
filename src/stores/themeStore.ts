import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sound_to_essay_theme';

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage unavailable — fall back to light */
  }
  return 'light';
}

function applyTheme(theme: Theme) {
  try {
    document.documentElement.dataset.theme = theme;
  } catch {
    /* DOM unavailable */
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* persistence unavailable — non-fatal */
  }
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: getInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    set({ theme: next });
  },
}));
