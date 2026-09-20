import { create } from 'zustand';
import type { VoiceClip, ProjectData, PageView, ProjectListItem } from '../types';

interface ProjectStore {
  project: ProjectData | null;
  recentProjects: ProjectListItem[];
  currentView: PageView;
  isRecording: boolean;
  isTranscribing: boolean;
  isPolishing: boolean;
  isGenerating: boolean;
  previousRawText: string;

  setView: (view: PageView) => void;
  setRecentProjects: (list: ProjectListItem[]) => void;
  setProject: (p: ProjectData | null) => void;
  addClip: (clip: VoiceClip) => void;
  updateClipText: (id: string, text: string) => void;
  /** A1：先用空文本登记片段，转写成功后再写入原始转写，避免音频变成无引用文件。 */
  setClipRawText: (id: string, text: string) => void;
  /** A1：更新片段转写状态（待转写/转写中/成功/失败）与失败原因。 */
  setClipTranscriptionState: (
    id: string,
    status: VoiceClip['transcriptionStatus'],
    error?: string
  ) => void;
  removeClip: (id: string) => void;
  setPolishedText: (text: string) => void;
  setEssayText: (text: string) => void;
  setRecording: (v: boolean) => void;
  setTranscribing: (v: boolean) => void;
  setPolishing: (v: boolean) => void;
  setGenerating: (v: boolean) => void;
  setPreviousRawText: (text: string) => void;
}

export const useProjectStore = create<ProjectStore>((set, _get) => ({
  project: null,
  recentProjects: [],
  currentView: 'library',
  isRecording: false,
  isTranscribing: false,
  isPolishing: false,
  isGenerating: false,
  previousRawText: '',

  setView: (view) => set({ currentView: view }),
  setRecentProjects: (list) => set({ recentProjects: list }),
  setProject: (p) => set({ project: p }),

  addClip: (clip) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          clips: [...state.project.clips, clip],
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  updateClipText: (id, text) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.id === id ? { ...c, editedText: text } : c
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  setClipRawText: (id, text) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.id === id ? { ...c, rawText: text } : c
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  setClipTranscriptionState: (id, status, error) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          clips: state.project.clips.map((c) =>
            c.id === id ? { ...c, transcriptionStatus: status, transcriptionError: error } : c
          ),
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  removeClip: (id) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          clips: state.project.clips.filter((c) => c.id !== id),
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  setPolishedText: (text) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: { ...state.project, polishedText: text, updatedAt: new Date().toISOString() },
      };
    }),

  setEssayText: (text) =>
    set((state) => {
      if (!state.project) return state;
      return {
        project: { ...state.project, essayText: text, updatedAt: new Date().toISOString() },
      };
    }),

  setRecording: (v) => set({ isRecording: v }),
  setTranscribing: (v) => set({ isTranscribing: v }),
  setPolishing: (v) => set({ isPolishing: v }),
  setGenerating: (v) => set({ isGenerating: v }),
  setPreviousRawText: (text) => set({ previousRawText: text }),
}));

