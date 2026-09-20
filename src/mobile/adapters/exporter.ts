/**
 * C1/C3：素材包导出适配。
 *
 * 两条路径，优先系统分享，不可用时回退文件下载：
 * - 系统分享（Web Share Level 2，iOS Safari 支持，可直接"存储到文件"或发给文件 App）
 * - 文件下载（`<a download>`，通用兜底）
 *
 * 已知限制：文件下载路径下，浏览器不会告知用户是否真的保存成功，
 * 因此只能如实报告「已发起下载」，不能宣称「已导出成功」或「电脑已接收」。
 */
import type { ExportResult, ExporterAdapter } from './types';

export function isWebShareAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

function downloadBlob(blob: Blob, filename: string): ExportResult {
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 稍后再释放，给浏览器时间读取
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { status: 'downloaded' };
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    const message = (error as { message?: string })?.message;
    return { status: 'failed', error: message ? `下载失败：${message}` : '下载失败：浏览器拒绝了该操作。' };
  }
}

export function createExporterAdapter(): ExporterAdapter {
  return {
    async exportPack(blob, filename): Promise<ExportResult> {
      const file = new File([blob], filename, {
        type: blob.type || 'application/octet-stream',
      });

      const canShareFile =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

      if (canShareFile) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { status: 'shared' };
        } catch (error) {
          const name = (error as { name?: string })?.name ?? '';
          // 用户在分享面板里点了取消：必须如实报告为取消，不能算成功
          if (name === 'AbortError') {
            return { status: 'cancelled' };
          }
          // 其余分享异常（如非用户手势触发）退回下载，不让用户卡死
        }
      }

      return downloadBlob(blob, filename);
    },
  };
}
