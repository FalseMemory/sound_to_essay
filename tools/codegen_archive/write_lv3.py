import os
path = r'F:\AI\sound_to_essay\src\components\LibraryView.tsx'

content = '''
function LazyAudioPlayer({ audio }: { audio: { id: string; filePath: string; durationSecs?: number } }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const base64 = await invoke<string>('read_audio_file', { filePath: audio.filePath });
        if (!cancelled) {
          setSrc(`data:audio/wav;base64,${base64}`);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(`加载音频失败: ${String(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [audio.filePath]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{audio.filePath.split("\\\\").pop()}</div>
          {audio.durationSecs !== undefined && <div className="text-[10px] text-[var(--text-secondary)]">{audio.durationSecs.toFixed(1)} 秒</div>}
        </div>
      </div>
      {loading && <p className="mt-3 text-xs text-[var(--text-secondary)]">加载中...</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {src && <audio className="mt-3 w-full" controls src={src} />}
    </div>
  );
}

function AIProcessor({ memoryId, versionId, onDone }: { memoryId: string; versionId?: string; onDone: () => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const [processingType, setProcessingType] = useState<'correct' | 'summarize' | 'extract' | 'polish' | 'rewrite'>('polish');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const config = settings.llm?.polish;
  const isConfigured = !!(config?.baseUrl && config?.modelName);

  useEffect(() => {
    if (isProcessing) {
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [isProcessing]);

  const handleProcess = async () => {
    if (!isConfigured) { setNotice('LLM 未配置，请先在设置中填写 API 信息。'); return; }
    setIsProcessing(true); setNotice('');
    try {
      await invoke('ai_process_memory', {
        memoryId,
        versionId: versionId || null,
        processingType,
        config,
      });
      setNotice('AI 整理完成，已保存为新版本。');
      onDone();
    } catch (e) {
      setNotice(`整理失败：${String(e)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const providerLabel = config?.baseUrl?.includes('localhost') || config?.baseUrl?.includes('127.0.0.1') ? '本地 Ollama' : '远程 API';

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <select className="control text-xs" value={processingType} onChange={(event) => setProcessingType(event.target.value as typeof processingType)} disabled={isProcessing}>
        <option value="correct">只修正口语和错字</option>
        <option value="summarize">压缩成摘要</option>
        <option value="extract">提炼人物/时间/地点/事件</option>
        <option value="polish">事实整理（分段+去冗余）</option>
        <option value="rewrite">文学化改写（创作性）</option>
      </select>
      <button onClick={() => void handleProcess()} disabled={isProcessing || !isConfigured} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition flex items-center gap-2 ${isProcessing || !isConfigured ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}>
        {isProcessing && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
        {isProcessing ? `整理中（${elapsed}s）` : '开始整理'}
      </button>
    </div>
    {isProcessing && <div className="text-xs text-[var(--text-secondary)]">正在连接模型并等待响应，请勿关闭应用...</div>}
    {config?.modelName && !isProcessing && <div className="text-[10px] text-[var(--text-secondary)]">当前模型：{config.modelName} · {providerLabel}</div>}
    {!isConfigured && <div className="text-xs text-amber-400">⚠️ 请在「设置」中配置 LLM API 地址和模型名称后再使用 AI 整理。</div>}
    {notice && <div className={`text-xs ${notice.includes('失败') ? 'text-red-400' : 'text-emerald-400'}`}>{notice}</div>}
  </div>;
}
'''

with open(path, 'a', encoding='utf-8') as f:
    f.write(content)
print('OK part3')
