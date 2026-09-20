/**
 * C1：设置页。如实展示本机能力与保存位置，不夸大。
 * 计划要求：页面必须真实说明素材存在「此设备浏览器内」。
 */
import { useEffect, useState } from 'react';
import { detectCapabilities, diagnoseRecording, isSecureContextAvailable, store } from '../adapters';
import type { PlatformCapabilities, RecordingDiagnosis } from '../adapters';

const THEME_KEY = 'sound_to_essay_theme';

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs text-[var(--text-secondary)]">{label}</span>
      <span
        className={`wrap-anywhere text-right text-xs font-medium ${
          ok === undefined ? 'text-[var(--text-primary)]' : ok ? 'text-[var(--success)]' : 'text-[var(--warning)]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function SettingsView() {
  const [persistence, setPersistence] = useState('');
  const [caps, setCaps] = useState<PlatformCapabilities | null>(null);
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes?: number } | null>(null);
  const [diagnosis] = useState<RecordingDiagnosis>(() => diagnoseRecording());
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (document.documentElement.dataset.theme as 'light' | 'dark') || 'light',
  );

  useEffect(() => {
    setCaps(detectCapabilities());
    void store
      .usage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // 隐私模式下写入失败可忽略，不影响本次会话
    }
  };

  const secure = isSecureContextAvailable();

  return (
    <div className="px-5 pb-8 pt-6">
      <section className="mb-5 rounded-2xl border border-[var(--border)] p-4 text-sm">
        <p>iPhone：用 Safari 打开固定的 HTTPS 地址，点分享 → 添加到主屏幕。首次联网加载完成后，请试一次飞行模式打开、录音和播放。</p>
        <p className="mt-2">录音适合短片段。长时间口述可以用系统「语音备忘录」录，再回到「我的素材」→「导入音频」把它导进来一起管理。网站数据不是永久备份；更换域名或清除数据前先导出。</p>
        <button className="touch-target mt-3 rounded-lg border px-3 py-2" onClick={() => {
          if (!navigator.storage?.persist) { setPersistence('此浏览器不提供持久存储申请，仍请定期导出。'); return; }
          void navigator.storage.persist().then(ok => setPersistence(ok ? '已获持久存储许可，仍不能代替导出备份。' : '浏览器未批准持久存储，请定期导出。')).catch(() => setPersistence('申请失败，请定期导出。'));
        }}>申请保留本机资料</button>
        <p role="status">{persistence}</p>
      </section>
      <h2 className="text-lg font-bold text-[var(--text-primary)]">设置</h2>

      {/* 保存位置：必须如实说明 */}
      <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">素材保存在哪里</h3>
        <p className="wrap-anywhere mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          本应用的录音与文字都保存在 <b className="text-[var(--text-primary)]">此设备浏览器内</b>
          （浏览器的 IndexedDB 存储）。不会自动上传到任何服务器。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          注意：清除浏览器数据、卸载浏览器或更换访问域名都可能<b className="text-[var(--warning)]">导致素材丢失</b>。
          重要内容请及时导出素材包并导入电脑。
        </p>
      </section>

      {/* 本机能力：如实呈现 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">本机能力</h3>
        <div className="mt-1 divide-y divide-[var(--border)]">
          <Row label="安全上下文（https / localhost）" value={secure ? '正常' : '不满足'} ok={secure} />
          <Row
            label="录音接口"
            value={caps ? (caps.hasMediaRecorder ? '可用' : '不可用') : '检测中…'}
            ok={caps?.hasMediaRecorder}
          />
          <Row
            label="麦克风接口"
            value={caps ? (caps.hasGetUserMedia ? '可用' : '不可用') : '检测中…'}
            ok={caps?.hasGetUserMedia}
          />
          <Row
            label="本机数据库"
            value={caps ? (caps.hasIndexedDb ? '可用' : '不可用') : '检测中…'}
            ok={caps?.hasIndexedDb}
          />
          <Row
            label="系统分享"
            value={caps ? (caps.hasWebShare ? '可用' : '不可用，将回退为下载') : '检测中…'}
            ok={caps?.hasWebShare}
          />
          <Row
            label="录音格式"
            value={caps?.audioFormat ? `${caps.audioFormat.mimeType}（.${caps.audioFormat.extension}）` : '未探测到'}
          />
          <Row
            label="已用存储"
            value={usage ? `${formatBytes(usage.usedBytes)}${usage.quotaBytes ? ` / ${formatBytes(usage.quotaBytes)}` : ''}` : '读取中…'}
          />
        </div>
        {!diagnosis.ok && (
          <div className="mt-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2">
            <p className="text-xs font-semibold text-[var(--warning)]">{diagnosis.reason}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-primary)]">{diagnosis.hint}</p>
          </div>
        )}
      </section>

      {/* 外观 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">外观</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">当前：{theme === 'dark' ? '深色' : '浅色'}</p>
          </div>
          <button
            onClick={toggleTheme}
            className="touch-target rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
          >
            切换主题
          </button>
        </div>
      </section>

      {/* 使用流程 */}
      <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">怎么把素材带到电脑</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          <li>在「记录」页录下口述，或写文字记录。</li>
          <li>到「我的素材」检查内容与音频是否正常。</li>
          <li>导出素材包（系统分享或下载到「文件」App）。</li>
          <li>在电脑上的声文里用「导入素材包」接收。</li>
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          导出成功后手机上的原始素材<b className="text-[var(--text-primary)]">不会被自动删除</b>，可以放心多次导出。
        </p>
      </section>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-[var(--text-secondary)]">
        声文 · 手机记录端 · 素材仅存于本机浏览器
      </p>
    </div>
  );
}
