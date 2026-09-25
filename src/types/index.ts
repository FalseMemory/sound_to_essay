export interface VoiceClip {
  id: string;
  timestamp: string;
  audioPath?: string;
  rawText: string;
  /** User-edited working text; rawText remains the original transcription. */
  editedText?: string;
  durationSecs: number;
  confidence: number;
  /**
   * A1：片段的转写状态。旧版项目文件没有该字段（undefined），
   * 视为"已完成"，不显示任何待办提示。
   */
  transcriptionStatus?: 'pending' | 'processing' | 'success' | 'failed';
  /** A1：转写失败原因，用于在创作区提示并可重试。 */
  transcriptionError?: string;
}

export function clipWorkingText(clip: VoiceClip): string {
  return clip.editedText ?? clip.rawText;
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  clips: VoiceClip[];
  polishedText: string;
  essayText: string;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
}

export interface AppSettings {
  hotkey: string;
  whisperModel: string;
  /** Root directory containing downloaded model subdirectories. */
  whisperModelDir?: string;
  whisperLanguage: 'zh' | 'en' | 'yue';
  /**
   * 自定义转写热词（人名 / 地名 / 专业术语），空格或换行分隔。
   * 会与语言内置热词合并后传给 Whisper，用于减少专有名词的识别错误。
   */
  transcriptionHotwords?: string;
  llm: {
    polish: LLMConfig;
    generate: LLMConfig;
  };
  tempAudioMaxAgeHours: number;
}

export interface EssayStyle {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export type PageView = 'workspace' | 'library' | 'settings' | 'projects';

export interface ProjectListItem {
  id: string;
  name: string;
  updatedAt: string;
  clipCount: number;
}

export interface LibraryProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySummary {
  id: string;
  projectId: string;
  title: string;
  audioRecordedAt?: string;
  eventDateText?: string;
  eventDatePrecision: string;
  eventDateSort?: number;
  location?: string;
  notes?: string;
  status: 'inbox' | 'pending' | 'organized' | 'in_chapter' | string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  audioCount: number;
  versionCount: number;
  tags: string[];
  people: string[];
}

export interface AudioAsset {
  id: string;
  memoryId: string;
  filePath: string;
  durationSecs?: number;
  sampleRate?: number;
  recordedAt?: string;
  createdAt: string;
  /** B1：导入音频的原始文件名（溯源展示）。 */
  originalFilename?: string;
  /** B1：导入音频的实际容器/编码格式。 */
  sourceFormat?: string;
  /** B1：导入音频的文件校验值（hex SHA-256）。 */
  fileChecksum?: string;
}

/** B1：待导入音频的探测结果（供前端预览）。 */
export interface ImportCandidate {
  sourcePath: string;
  fileName: string;
  sizeBytes: number;
  format: string;
  durationSecs?: number;
  sampleRate?: number;
  alreadyImported: boolean;
  error?: string;
}

/** B3：素材包导入预览。 */
export interface PackPreview {
  formatVersion: number;
  packId: string;
  exportedAt: string;
  appVersion: string;
  recordCount: number;
  audioCount: number;
  duplicates: number;
  conflicts: number;
  missingAudio: number;
}

/** B3：素材包导入结果。 */
export interface PackImportOutcome {
  imported: number;
  updated: number;
  skippedDuplicates: number;
  conflictsKeptBoth: number;
  missingAudio: number;
  audioWritten: number;
}

/** B1：导入结果。 */
export interface ImportOutcome {
  memoryId: string;
  audioPath: string;
  playablePath: string;
  durationSecs: number;
  sampleRate?: number;
  sourceFormat: string;
  fileChecksum: string;
  transcribeTaskCreated: boolean;
}

export interface TextVersion {
  id: string;
  memoryId: string;
  parentVersionId?: string;
  content: string;
  versionType: string;
  processingType?: string;
  provider?: string;
  model?: string;
  /** 整理档位：'faithful' 校订保真 / 'creative' 文学化改写（创作性结果）。 */
  tier?: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface MemoryDetail extends MemorySummary {
  audioAssets: AudioAsset[];
  textVersions: TextVersion[];
}


/**
 * A1：转写任务。录音落盘后先登记任务（pending），再执行转写，
 * 状态改为 processing，最终 success 或 failed。失败时记忆与原始音频都保留。
 */
export interface TranscriptionTask {
  id: string;
  memoryId: string;
  audioPath: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | string;
  error?: string;
  model?: string;
  language?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/** A3：备份结果。 */
export interface BackupOutcome {
  archivePath: string;
  audioCount: number;
  databaseBytes: number;
}

/** A3：恢复前校验返回的预览信息。 */
export interface RestorePreview {
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  audioCount: number;
  databaseBytes: number;
  /** 备份里有、但本地已缺失的音频数（恢复后会回来）。 */
  audioMissingLocally: number;
}

/** A3：恢复结果。 */
export interface RestoreOutcome {
  audioRestored: number;
  databaseReplaced: boolean;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ChapterDetail extends Chapter {
  memories: MemorySummary[];
}

/**
 * A2：草稿生成时**实际使用**的一个来源（记忆 + 该记忆当时被采用的文本版本）。
 * 来源只在生成时写入一次，不随记忆改名、版本切换或章节关联变化而改变。
 */
export interface ChapterDraftSource {
  memoryId: string;
  /** 生成时的记忆标题快照。 */
  memoryTitle: string;
  textVersionId?: string;
  /** 生成时该版本的版本类型快照（raw_transcription / user_edit / ...）。 */
  versionType?: string;
  /** 该版本现在是否已不存在。 */
  versionMissing: boolean;
}

export interface ChapterDraft {
  id: string;
  chapterId: string;
  content: string;
  draftType: string;
  processingType?: string;
  provider?: string;
  model?: string;
  /** 整理档位：'faithful' 校订保真 / 'creative' 文学化改写（创作性结果）。 */
  tier?: string;
  /** A2：生成时的写作要求（风格提示词），用于复盘旧草稿的生成条件。 */
  requirement?: string;
  isCurrent: boolean;
  createdAt: string;
  /** A2：生成时记录下来的来源，展示时**必须**读这里，不能用当前章节关联列表代替。 */
  sources: ChapterDraftSource[];
}

export interface ChapterWithDrafts extends Chapter {
  memories: MemorySummary[];
  drafts: ChapterDraft[];
}