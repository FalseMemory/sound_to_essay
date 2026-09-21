import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../stores/settingsStore';
import type { LLMConfig } from '../types';

type VoiceLanguage = 'zh' | 'en' | 'yue';

type WhisperModelInfo = {
  id: string;
  name: string;
  description: string;
  sizeMb: number;
  installed: boolean;
  downloading: boolean;
  partialSize: number;
  path: string;
};

type WhisperDownloadProgress = {
  modelId: string;
  downloaded: number;
  total: number;
  percentage: number;
  currentFile: string;
  status: 'connecting' | 'downloading' | 'completed';
};

const voiceLanguages: { value: VoiceLanguage; label: string; detail: string }[] = [
  { value: 'zh', label: '普通话', detail: '简体中文输出' },
  { value: 'en', label: 'English', detail: 'English speech' },
  { value: 'yue', label: '粤语', detail: '简体中文输出' },
];

const modelIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const aiIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  </svg>
);

const micIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
  </svg>
);

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const [modelDir, setModelDir] = useState(settings.whisperModelDir ?? '');
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, WhisperDownloadProgress>>({});
  const [modelError, setModelError] = useState('');
  const savedSettingsRef = useRef(structuredClone(settings));

  const effectiveModelDir = useMemo(() => modelDir.trim(), [modelDir]);

  const loadModels = async (directory = effectiveModelDir) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<WhisperModelInfo[]>('list_whisper_models', {
        modelDir: directory || undefined,
      });
      setModels(result);
      setModelError('');
    } catch (error) {
      setModelError(String(error));
    }
  };

  useEffect(() => {
    let disposed = false;
    const initialize = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const directory = settings.whisperModelDir?.trim()
          || await invoke<string>('get_default_whisper_model_dir');
        const result = await invoke<WhisperModelInfo[]>('list_whisper_models', {
          modelDir: directory,
        });
        if (!disposed) {
          setModelDir(directory);
          setModels(result);
        }
      } catch (error) {
        if (!disposed) setModelError(String(error));
      }
    };
    void initialize();
    return () => {
      disposed = true;
    };
  }, [settings.whisperModelDir]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        const cleanup = await listen<WhisperDownloadProgress>(
          'whisper-model-download-progress',
          (event) => {
            if (!disposed) {
              setProgress((current) => ({ ...current, [event.payload.modelId]: event.payload }));
            }
          },
        );
        if (disposed) cleanup();
        else unlisten = cleanup;
      } catch {
        // The settings page can also render in a normal browser preview.
      }
    };
    void setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const chooseModelDirectory = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择 Whisper 模型存放位置',
    });
    if (typeof selected !== 'string') return;
    setModelDir(selected);
    setSettings({ whisperModelDir: selected });
    setModelError('');
    await loadModels(selected);
  };

  const handleDownload = (modelId: string) => {
    setModelError('');
    const model = models.find((item) => item.id === modelId);
    setModels((current) => current.map((item) => item.id === modelId ? { ...item, downloading: true } : item));
    setProgress((current) => ({
      ...current,
      [modelId]: {
        modelId,
        downloaded: model?.partialSize ?? 0,
        total: (model?.sizeMb ?? 0) * 1024 * 1024,
        percentage: 0,
        currentFile: '',
        status: 'connecting',
      },
    }));
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('download_whisper_model', {
          modelId,
          modelDir: effectiveModelDir || undefined,
        });
      } catch (error) {
        const message = String(error);
        if (!message.includes('已取消')) setModelError(message);
      } finally {
        setProgress((current) => {
          const next = { ...current };
          delete next[modelId];
          return next;
        });
        await loadModels();
      }
    })();
  };

  const handleCancel = async (modelId: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_whisper_model_download', { modelId });
    } catch (error) {
      setModelError(String(error));
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!window.confirm('删除这个模型及其未完成下载文件吗？')) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_whisper_model', {
        modelId,
        modelDir: effectiveModelDir || undefined,
      });
      await loadModels();
    } catch (error) {
      setModelError(String(error));
    }
  };

  const handleSave = async (showConfirmation = true) => {
    setSettings({ whisperModelDir: effectiveModelDir || undefined });
    await saveSettings();
    savedSettingsRef.current = structuredClone({ ...settings, whisperModelDir: effectiveModelDir || undefined });
    if (showConfirmation) alert('设置已保存');
  };

  const closeSettings = async () => {
    if (JSON.stringify(settings) !== JSON.stringify(savedSettingsRef.current)) {
      const shouldSave = window.confirm('设置尚未保存。是否保存后退出设置？');
      if (shouldSave) {
        await handleSave(false);
      } else {
        setSettings(savedSettingsRef.current);
        setModelDir(savedSettingsRef.current.whisperModelDir ?? '');
      }
    }
    onClose();
  };

  useEffect(() => {
    const requestClose = () => { void closeSettings(); };
    window.addEventListener('settings-close-request', requestClose);
    return () => window.removeEventListener('settings-close-request', requestClose);
  });

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Preferences</div>
            <h2 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">设置</h2>
          </div>
          <button
            onClick={() => void handleSave()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition hover:bg-[var(--accent-hover)]"
          >
            保存设置
          </button>
        </div>

        <div className="mt-8 space-y-6">
          {/* ===== Module 1: 语音模型（下载与管理） ===== */}
          <Module title="语音模型" icon={modelIcon} description="管理本地识别模型的下载与存放位置，并选择当前使用的 Whisper 模型。">
            <SettingRow label="当前使用模型" detail="仅已下载的模型可用于录音转写。">
              <select
                value={settings.whisperModel}
                onChange={(e) => setSettings({ whisperModel: e.target.value })}
                className="control w-full"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id} disabled={!model.installed}>
                    {model.name}{model.installed ? '' : '（未下载）'}
                  </option>
                ))}
                {!models.some((model) => model.id === settings.whisperModel) && (
                  <option value={settings.whisperModel}>{settings.whisperModel}</option>
                )}
              </select>
            </SettingRow>

            {/* 当前模型未下载时必须明说：否则用户点了转写才失败，且不知道原因。
                默认值是 base，而很多人只下载了 tiny —— 没有这段提示就会卡在这里。 */}
            {!models.some((model) => model.id === settings.whisperModel && model.installed) && (
              <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                当前选择的「{settings.whisperModel}」尚未下载，<b>录音转写无法进行</b>。
                请在下方「Whisper 模型库」下载它，或改选一个已下载的模型
                {models.some((model) => model.installed) && (
                  <>
                    （已下载可用：
                    {models.filter((model) => model.installed).map((model) => model.id).join('、')}
                    ）
                  </>
                )}
                。
              </div>
            )}

            <SettingRow label="模型存放位置" detail="每个模型保存为独立文件夹，建议选择空间充足的本地磁盘。">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]">
                  {effectiveModelDir || '默认应用数据目录'}
                </div>
                <button
                  onClick={chooseModelDirectory}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                >
                  选择文件夹
                </button>
              </div>
            </SettingRow>

            <div className="border-t border-[var(--border)] pt-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-[var(--text-primary)]">Whisper 模型库</div>
                <span className="text-xs text-[var(--text-secondary)]">下载完成后自动安装</span>
              </div>
              {modelError && (
                <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{modelError}</div>
              )}
              <div className="space-y-3">
                {models.map((model) => {
                  const itemProgress = progress[model.id];
                  const isCurrent = settings.whisperModel === model.id;
                  const isDownloading = model.downloading || Boolean(itemProgress);
                  return (
                    <div key={model.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">{model.name}</span>
                            {isCurrent && (
                              <span className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-[10px] text-[var(--accent)]">当前使用</span>
                            )}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                              model.installed
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
                                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                            }`}>
                              {model.installed ? '已安装' : model.partialSize > 0 ? '可继续下载' : '未下载'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{model.description}</p>
                          <div className="mt-2 text-[11px] text-[var(--text-secondary)]">预计占用约 {model.sizeMb} MB</div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {isDownloading ? (
                            <button
                              onClick={() => handleCancel(model.id)}
                              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
                            >
                              取消
                            </button>
                          ) : model.installed ? (
                            <>
                              {!isCurrent && (
                                <button
                                  onClick={() => setSettings({ whisperModel: model.id })}
                                  className="rounded-md border border-[var(--accent)]/50 px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10"
                                >
                                  使用
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(model.id)}
                                className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
                              >
                                删除
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleDownload(model.id)}
                              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white hover:bg-[var(--accent-hover)]"
                            >
                              下载
                            </button>
                          )}
                        </div>
                      </div>
                      {isDownloading && (
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-[11px] text-[var(--text-secondary)]">
                            <span>
                              {itemProgress?.status === 'connecting'
                                ? '正在连接下载源...'
                                : itemProgress?.currentFile
                                ? `正在下载 ${itemProgress.currentFile}`
                                : '正在准备下载...'}
                            </span>
                            <span>
                              {formatBytes(itemProgress?.downloaded ?? model.partialSize)}
                              {itemProgress?.total
                                ? ` / ${formatBytes(itemProgress.total)} (${Math.round(itemProgress.percentage)}%)`
                                : ''}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                            <div
                              className="h-full rounded-full bg-[var(--accent)] transition-all"
                              style={{ width: `${Math.min(100, itemProgress?.percentage ?? 0)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Module>

          {/* ===== Module 2: AI 大模型（API Key） ===== */}
          <Module title="AI 大模型" icon={aiIcon} description="配置用于「初步整理」与「散文生成」的 OpenAI 兼容接口与 API Key。">
            <LLMConfigSection
              label="AI 初步整理模型"
              caption="轻量模型即可，负责清理语音稿。"
              config={settings.llm.polish}
              onChange={(config) => setSettings({ llm: { ...settings.llm, polish: config } })}
            />
            <LLMConfigSection
              label="散文生成模型"
              caption="建议使用更强模型，负责长文创作。"
              config={settings.llm.generate}
              onChange={(config) => setSettings({ llm: { ...settings.llm, generate: config } })}
            />
            <p className="rounded-md bg-[var(--bg-tertiary)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              两个模型共用同一服务地址，可填写不同模型名称以分别承担「整理」与「创作」任务。点击「测试连接」可验证接口与 Key 是否有效。
            </p>
          </Module>

          {/* ===== Group: 语音识别（偏好） ===== */}
          <Module title="语音识别" icon={micIcon} description="选择默认识别语言与录音快捷键。">
            <div>
              <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">默认识别语言</div>
              <div className="grid grid-cols-3 gap-2">
                {voiceLanguages.map((item) => {
                  const active = settings.whisperLanguage === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setSettings({ whisperLanguage: item.value })}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)] shadow-sm shadow-blue-500/20'
                          : 'border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-75">{item.detail}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <SettingRow label="录音快捷键">
              <input
                type="text"
                value={settings.hotkey}
                onChange={(e) => setSettings({ hotkey: e.target.value })}
                className="control w-full text-center font-mono"
              />
            </SettingRow>
          </Module>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Module({ title, description, icon, children }: { title: string; description?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>}
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <div className="space-y-5">{children}</div>
      </div>
    </section>
  );
}

function SettingRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        {detail && <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function LLMConfigSection({ label, caption, config, onChange }: { label: string; caption: string; config: LLMConfig; onChange: (config: LLMConfig) => void }) {
  const testConnection = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<string>('test_llm_connection', { config });
      alert(`连接成功: ${result}`);
    } catch (error) {
      alert(`连接失败: ${String(error)}`);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]/50 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">{label}</div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{caption}</div>
        </div>
        <button
          onClick={testConnection}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          测试连接
        </button>
      </div>
      <div className="grid gap-3">
        <Field label="API 地址">
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="control w-full"
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
            placeholder="sk-..."
            className="control w-full"
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-[1fr_140px]">
          <Field label="模型名称">
            <input
              type="text"
              value={config.modelName}
              onChange={(e) => onChange({ ...config, modelName: e.target.value })}
              placeholder="qwen2.5:7b"
              className="control w-full"
            />
          </Field>
          <Field label="Max Tokens">
            <input
              type="number"
              value={config.maxTokens}
              onChange={(e) => onChange({ ...config, maxTokens: Number(e.target.value) })}
              min={256}
              max={32768}
              step={256}
              className="control w-full"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}
