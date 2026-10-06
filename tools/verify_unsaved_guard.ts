/**
 * 验证未保存守卫的状态机。
 *
 * `unsavedStore` 不依赖 Tauri，可以在 Node 里直接跑——所以「保存并离开 /
 * 放弃修改 / 继续编辑」三条分支的行为是可以实测的，不需要打开应用点按钮。
 *
 * 用法：npx tsx tools/verify_unsaved_guard.ts
 */
import { shouldInterceptLeave, useUnsavedStore } from '../src/stores/unsavedStore';
import type { LeaveInterceptInput } from '../src/stores/unsavedStore';

const store = useUnsavedStore;
let failures = 0;

/** shouldInterceptLeave 的默认情形：有改动、点了编辑区外的按钮。 */
function interceptCase(patch: Partial<LeaveInterceptInput> = {}): LeaveInterceptInput {
  return {
    dirty: true,
    dialogOpen: false,
    eventType: 'click',
    insideEditor: false,
    onInteractive: true,
    ...patch,
  };
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${label}  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

function reset() {
  store.setState({ dirty: false, dialogOpen: false, saving: false, pendingAction: null, saveHandler: null });
}

console.log('=== 1. 无改动时直接放行 ===');
reset();
let ran = 0;
check('requestLeave 返回 true（放行）', store.getState().requestLeave(() => { ran += 1; }), true);
check('未弹对话框', store.getState().dialogOpen, false);
check('pendingAction 不被接管（由调用方执行）', store.getState().pendingAction, null);

console.log('\n=== 2. 有改动时拦下并弹窗 ===');
reset();
store.getState().setDirty(true);
check('requestLeave 返回 false（已拦下）', store.getState().requestLeave(() => { ran += 1; }), false);
check('对话框已打开', store.getState().dialogOpen, true);
check('动作被记为待执行', typeof store.getState().pendingAction, 'function');

console.log('\n=== 3. 选「继续编辑」：什么都不做，编辑保留 ===');
reset();
store.getState().setDirty(true);
store.getState().requestLeave(() => { ran += 1; });
const before = ran;
await store.getState().resolve('cancel');
check('对话框关闭', store.getState().dialogOpen, false);
check('待执行动作被丢弃', store.getState().pendingAction, null);
check('动作没有执行（编辑原样保留）', ran, before);
check('dirty 保持为 true（仍会继续拦截）', store.getState().dirty, true);

console.log('\n=== 4. 选「放弃修改」：执行离开，丢弃改动 ===');
reset();
ran = 0;
store.getState().setDirty(true);
store.getState().requestLeave(() => { ran += 1; });
await store.getState().resolve('discard');
check('离开动作已执行', ran, 1);
check('dirty 被清空', store.getState().dirty, false);
check('对话框关闭', store.getState().dialogOpen, false);

console.log('\n=== 5. 选「保存并离开」且保存成功 ===');
reset();
ran = 0;
let saved = 0;
store.getState().setDirty(true);
store.getState().registerSaveHandler(async () => { saved += 1; return true; });
store.getState().requestLeave(() => { ran += 1; });
await store.getState().resolve('save');
check('保存被调用一次', saved, 1);
check('保存成功后才离开', ran, 1);
check('dirty 被清空', store.getState().dirty, false);
check('saving 已复位', store.getState().saving, false);

console.log('\n=== 6. 选「保存并离开」但保存失败：必须留下，不能丢 ===');
reset();
ran = 0;
store.getState().setDirty(true);
store.getState().registerSaveHandler(async () => false);
store.getState().requestLeave(() => { ran += 1; });
await store.getState().resolve('save');
check('保存失败时不执行离开', ran, 0);
check('对话框关闭（让用户看到错误）', store.getState().dialogOpen, false);
check('dirty 保持为 true（改动仍在守卫下）', store.getState().dirty, true);

console.log('\n=== 7. 保存时抛异常：等同于失败，不离开 ===');
reset();
ran = 0;
store.getState().setDirty(true);
store.getState().registerSaveHandler(async () => { throw new Error('磁盘满'); });
store.getState().requestLeave(() => { ran += 1; });
await store.getState().resolve('save');
check('异常时不执行离开', ran, 0);
check('dirty 保持为 true', store.getState().dirty, true);

console.log('\n=== 8. 没有注册保存函数时不假装成功 ===');
reset();
ran = 0;
store.getState().setDirty(true);
store.getState().requestLeave(() => { ran += 1; });
await store.getState().resolve('save');
check('不执行离开（无法确认已保存）', ran, 0);
check('dirty 保持为 true', store.getState().dirty, true);

console.log('\n=== 9. 拦截判据：对话框打开时必须放行（否则按钮点不动）===');
// 2026-10-06 实测踩到：对话框自己的三个按钮也是编辑区外的 <button>，
// 被守卫一并拦下 → 用户点了完全没反应。这条断言锁住该行为。
check('对话框打开时点击按钮 → 放行', shouldInterceptLeave(interceptCase({ dialogOpen: true })), false);
check('对话框关闭时点击按钮 → 拦截', shouldInterceptLeave(interceptCase({ dialogOpen: false })), true);

console.log('\n=== 10. 拦截判据：其余边界 ===');
check('无改动 → 放行', shouldInterceptLeave(interceptCase({ dirty: false })), false);
check('编辑区内部的操作 → 放行', shouldInterceptLeave(interceptCase({ insideEditor: true })), false);
check('非交互元素（如段落文字）→ 放行', shouldInterceptLeave(interceptCase({ onInteractive: false })), false);
check('键盘 Enter 激活按钮 → 拦截', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: 'Enter' })), true);
check('键盘空格激活按钮 → 拦截', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: ' ' })), true);
check('键盘普通字母 → 放行', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: 'a' })), false);
check('Ctrl+S → 放行（保存快捷键不能被拦）', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: 's', ctrlKey: true })), false);
check('Cmd+S → 放行', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: 's', metaKey: true })), false);
check('Shift+Enter → 放行（带修饰键）', shouldInterceptLeave(interceptCase({ eventType: 'keydown', key: 'Enter', altKey: true })), false);

console.log('\n=== 11. 回归：拦下 → 放弃 → 重放，且不会二次拦截 ===');
reset();
ran = 0;
store.getState().setDirty(true);
{
  const replayAction = () => { ran += 1; };
  // 模拟 hook：先判要不要拦，再请求离开
  const willIntercept = shouldInterceptLeave(interceptCase({ dialogOpen: store.getState().dialogOpen }));
  check('首次点击被拦', willIntercept, true);
  store.getState().requestLeave(replayAction);
  await store.getState().resolve('discard');
  check('重放执行了一次', ran, 1);
  // 重放时 dirty 已清空 → 不会再被拦
  const secondIntercept = shouldInterceptLeave(
    interceptCase({ dirty: store.getState().dirty, dialogOpen: store.getState().dialogOpen })
  );
  check('重放不会再被拦（否则死循环）', secondIntercept, false);
}

console.log('');
if (failures === 0) {
  console.log('>>> 未保存守卫状态机全部通过 ✅');
} else {
  console.log(`>>> 有 ${failures} 项未通过 ❌`);
  process.exit(1);
}
