import { useEffect } from 'react';
import { shouldInterceptLeave, useUnsavedStore } from '../stores/unsavedStore';

/**
 * 未保存改动时的离开拦截。
 *
 * 用**事件委托**在 document 捕获阶段拦截，因此不必在每个按钮上单独接线：
 * 顶部导航（资料库 / 创作区）、设置、项目下拉、记忆与章节切换、浏览模式切换
 * 都被同一处覆盖，将来新增入口也不容易漏。
 *
 * 但事件委托有个必须小心的副作用：**确认对话框自己也是 DOM 里的一组 `<button>`**。
 * 若不放行对话框自身的操作，三个选项会被自己拦下、全部点不动
 * （2026-10-06 实测踩到）。这里统一委托给 `shouldInterceptLeave` 判断。
 *
 * 拦下后交给 `unsavedStore` 弹出三选项对话框；用户选「放弃修改」或
 * 「保存并离开」时**重放**被拦下的那次操作，让原动作自然发生——
 * 这样拦截点不需要预先知道"离开之后会去哪"。
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
      const state = useUnsavedStore.getState();
      const target = event.target;
      const element = target instanceof Element ? target : null;

      const intercepted = shouldInterceptLeave({
        dirty: state.dirty,
        dialogOpen: state.dialogOpen,
        eventType: event.type === 'keydown' ? 'keydown' : 'click',
        key: event instanceof KeyboardEvent ? event.key : undefined,
        ctrlKey: event instanceof KeyboardEvent ? event.ctrlKey : false,
        metaKey: event instanceof KeyboardEvent ? event.metaKey : false,
        altKey: event instanceof KeyboardEvent ? event.altKey : false,
        insideEditor: !!element?.closest(editorSelector),
        onInteractive: !!element?.closest('button,a,select,input'),
      });
      if (!intercepted) return;

      // 先同步阻断这次操作，再由用户在对话框里决定。
      event.preventDefault();
      event.stopImmediatePropagation();

      const replay = () => {
        if (!(element instanceof HTMLElement)) return;
        if (event.type === 'click') {
          element.click();
        } else {
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: (event as KeyboardEvent).key,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      };

      state.requestLeave(replay);
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
