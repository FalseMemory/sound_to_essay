import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * 可选的第三个选项，用在「既不是确认、也不是取消」的中间动作上。
   * 例：未保存提示里的「放弃修改」——取消=继续编辑，确认=保存并离开。
   * 不传时保持原有的两按钮形态。
   */
  secondaryLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  secondaryLabel,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onSecondary,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 dark:bg-black/60"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{message}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            {cancelLabel}
          </button>
          {secondaryLabel && (
            <button
              onClick={onSecondary}
              className="rounded-lg border border-[var(--error)]/40 px-4 py-2 text-sm font-medium text-[var(--error)] transition hover:bg-[var(--error)]/10"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
              danger
                ? 'bg-[var(--error)] hover:opacity-90'
                : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
