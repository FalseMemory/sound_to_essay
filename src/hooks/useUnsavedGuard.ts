import { useEffect } from 'react';
import { useUnsavedStore } from '../stores/unsavedStore';

/**
 * 未保存改动时的离开拦截。
 *
 * 用**事件委托**在 document 捕获阶段拦截，因此不必在每个按钮上单独接线：
 * 顶部导航（资料库 / 创作区）、设置、项目下拉、记忆与章节切换、浏览模式切换
 * 都被同一处覆盖，将来新增入口也不容易漏。
 *
 * 拦下后交给 `unsavedStore` 弹出三选项对话框；用户选「放弃修改」或
 * 「保存并离开」时**重放**被拦下的那次操作，让原动作自然发生——
 * 这样拦截点不需要预先知道"离开之后会去哪"。
 *
 * 是否生效一律以 `unsavedStore.dirty` 为准（而不是靠 effect 依赖参数重建监听器）：
 * 「保存并离开」会先把 dirty 置否再重放，此时必须放行，否则会陷入死循环。
 * `dirty` 参数只用来把编辑区的状态**上报**给 store。
 *
 * 刷新 / 关闭窗口由 `beforeunload` 兜底（浏览器原生提示，文案不可自定义）。
 */
export function useUnsavedGuard(dirty: boolean, editorSelector: string) {
  // 脏状态统一由本 hook 上报给全局守卫；卸载时清掉，避免编辑区关闭后
  // 仍然拦着别处的操作。
  useEffect(() => {
    useUnsavedStore.getState().setDirty(dirty);
    return () => useUnsavedStore.getState().setDirty(false);
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!useUnsavedStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const leave = (event: Event) => {
      if (!useUnsavedStore.getState().dirty) return;

      if (event instanceof KeyboardEvent) {
        // 只拦「会激活按钮」的按键，且不带修饰键（Ctrl+S 等必须放行）。
        if (!['Enter', ' '].includes(event.key)) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
      }

      const target = event.target;
      if (!(target instanceof Element) || target.closest(editorSelector)) return;
      if (!target.closest('button,a,select,input')) return;

      // 先同步阻断这次操作，再由用户在对话框里决定。
      event.preventDefault();
      event.stopImmediatePropagation();

      const replay = () => {
        if (!(target instanceof HTMLElement)) return;
        if (event.type === 'click') {
          target.click();
        } else {
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: (event as KeyboardEvent).key,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      };

      useUnsavedStore.getState().requestLeave(replay);
    };

    document.addEventListener('click', leave, true);
    document.addEventListener('keydown', leave, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('click', leave, true);
      document.removeEventListener('keydown', leave, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [editorSelector]);
}
