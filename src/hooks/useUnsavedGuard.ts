import { useEffect } from 'react';

// Block navigation at the document boundary, including menus outside the editor.
// Editor-local save/edit actions remain usable. Form fields outside are guarded too.
export function useUnsavedGuard(dirty: boolean, selector: string) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const leave = (event: Event) => {
      if (event instanceof KeyboardEvent && !['Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(selector)) return;
      if (!target.closest('button,a,select,input')) return;
      if (!window.confirm('当前编辑尚未保存。放弃修改并继续吗？')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', leave, true);
    document.addEventListener('keydown', leave, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('click', leave, true);
      document.removeEventListener('keydown', leave, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, selector]);
}
