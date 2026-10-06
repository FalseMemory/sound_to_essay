import { useUnsavedStore } from '../stores/unsavedStore';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * 未保存改动的离开确认。
 *
 * 由 `unsavedStore` 驱动，挂在顶层（App）——因为触发离开的动作分散在
 * 顶部导航（切页面）和资料库内部（切记忆 / 章节），需要一个统一的拦截点。
 *
 * 三个选项的语义：
 *   继续编辑   —— 什么都不做，编辑内容原样保留
 *   放弃修改   —— 丢弃改动并执行离开
 *   保存并离开 —— 先保存，成功后才离开；失败则留在原地让用户看到错误
 */
export function UnsavedChangesDialog() {
  const open = useUnsavedStore((s) => s.dialogOpen);
  const saving = useUnsavedStore((s) => s.saving);
  const resolve = useUnsavedStore((s) => s.resolve);

  return (
    <ConfirmDialog
      open={open}
      title="有未保存的修改"
      message={
        <>
          元数据或工作文本的改动尚未保存，离开后会丢失。
          <br />
          <span className="text-[var(--text-secondary)]">
            也可以选「继续编辑」，回去按 <b>Ctrl+S</b> 保存。
          </span>
        </>
      }
      confirmLabel={saving ? '保存中…' : '保存并离开'}
      confirmDisabled={saving}
      secondaryLabel="放弃修改"
      cancelLabel="继续编辑"
      onConfirm={() => void resolve('save')}
      onSecondary={() => void resolve('discard')}
      onCancel={() => void resolve('cancel')}
    />
  );
}
