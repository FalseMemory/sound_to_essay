import { create } from 'zustand';

/**
 * 未保存编辑的守卫。
 *
 * 背景（2026-10-06 实测踩到）：记忆编辑区的元数据与工作文本需要**手动点按钮**保存。
 * 用户按 Ctrl+S 误以为已经保存，直接切换到别的页面，改动就静默消失了——
 * 数据没丢在数据库里，是根本没写进去，而且全程没有任何提示。
 *
 * 机制：
 * - 编辑区在有未保存改动时调用 `setDirty(true)`，并注册 `saveHandler`。
 * - 任何会让编辑区卸载或丢弃改动的操作，先经过 `requestLeave(action)`：
 *     无改动 → 放行，调用方执行 action；
 *     有改动 → 拦下并弹对话框，由用户选择「保存并离开 / 放弃修改 / 继续编辑」。
 * - 「继续编辑」时**不做任何改动**，编辑内容原样保留（这是 E3 验收第 3 条的要求）。
 */

export type UnsavedChoice = 'cancel' | 'discard' | 'save';

/** 判断一次点击 / 按键是否应该被未保存守卫拦下。纯函数，便于直接测试。 */
export interface LeaveInterceptInput {
  /** 当前是否有未保存改动。 */
  dirty: boolean;
  /** 确认对话框是否正开着——**必须放行**，否则对话框自己的按钮会被自己拦下。 */
  dialogOpen: boolean;
  eventType: 'click' | 'keydown';
  /** keydown 时的按键名。 */
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** 事件目标是否位于编辑区内（编辑区内部的操作一律放行）。 */
  insideEditor: boolean;
  /** 事件目标是否是可交互元素（按钮 / 链接 / 表单控件）。 */
  onInteractive: boolean;
}

export function shouldInterceptLeave(input: LeaveInterceptInput): boolean {
  if (!input.dirty) return false;
  // 对话框已经打开时，用户此刻的操作就是在回答对话框本身，不能再拦。
  // （2026-10-06 实测踩到：漏了这个条件，三个按钮全部点不动。）
  if (input.dialogOpen) return false;
  if (!input.onInteractive) return false;
  if (input.insideEditor) return false;
  if (input.eventType === 'keydown') {
    // 只拦「会激活按钮」的按键，且不带修饰键（Ctrl+S 等必须放行）。
    if (!['Enter', ' '].includes(input.key ?? '')) return false;
    if (input.ctrlKey || input.metaKey || input.altKey) return false;
  }
  return true;
}

interface UnsavedState {
  /** 当前是否存在未保存的改动。 */
  dirty: boolean;
  /** 对话框是否展开。 */
  dialogOpen: boolean;
  /** 正在保存（避免重复提交）。 */
  saving: boolean;
  /** 用户确认离开后要补执行的动作（例如"切换到创作区"）。 */
  pendingAction: (() => void) | null;
  /** 由编辑区注册：保存当前改动，返回是否成功。 */
  saveHandler: (() => Promise<boolean>) | null;

  setDirty: (dirty: boolean) => void;
  registerSaveHandler: (handler: (() => Promise<boolean>) | null) => void;
  /**
   * 尝试离开。
   * @returns true 表示可以直接离开（调用方自行执行 action）；
   *          false 表示已拦下并弹出对话框（调用方不要执行 action）。
   */
  requestLeave: (action: (() => void) | null) => boolean;
  /** 处理对话框选择。 */
  resolve: (choice: UnsavedChoice) => Promise<void>;
}

export const useUnsavedStore = create<UnsavedState>((set, get) => ({
  dirty: false,
  dialogOpen: false,
  saving: false,
  pendingAction: null,
  saveHandler: null,

  setDirty: (dirty) => set({ dirty }),

  registerSaveHandler: (handler) => set({ saveHandler: handler }),

  requestLeave: (action) => {
    if (!get().dirty) return true;
    set({ dialogOpen: true, pendingAction: action });
    return false;
  },

  resolve: async (choice) => {
    const { pendingAction, saveHandler } = get();

    if (choice === 'cancel') {
      set({ dialogOpen: false, pendingAction: null });
      return;
    }

    if (choice === 'discard') {
      // 先清掉 dirty，否则编辑区卸载前可能再次触发拦截。
      set({ dirty: false, dialogOpen: false, pendingAction: null });
      pendingAction?.();
      return;
    }

    // choice === 'save'
    if (!saveHandler) {
      // 没有可用的保存函数时，不要假装保存成功——直接让用户自己决定。
      set({ dialogOpen: false, pendingAction: null });
      return;
    }
    set({ saving: true });
    let ok: boolean;
    try {
      ok = await saveHandler();
    } catch {
      ok = false;
    }
    set({ saving: false });

    if (!ok) {
      // 保存失败：留在原地，让用户看到错误，不要静默丢弃。
      set({ dialogOpen: false, pendingAction: null });
      return;
    }
    set({ dirty: false, dialogOpen: false, pendingAction: null });
    pendingAction?.();
  },
}));

/**
 * 便捷入口：不关心 pendingAction，只想知道"能不能走"。
 * 用于窗口关闭等无法延后执行的动作。
 */
export function canLeaveWithoutPrompt(): boolean {
  const { dirty, setDirty } = useUnsavedStore.getState();
  if (!dirty) return true;
  const ok = window.confirm(
    '有未保存的修改，关闭后将会丢失。\n\n确定要关闭吗？\n（选择「取消」后可回到编辑区按 Ctrl+S 保存）'
  );
  if (ok) setDirty(false);
  return ok;
}
