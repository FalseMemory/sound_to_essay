/**
 * 验证未保存守卫的状态机。
 *
 * `unsavedStore` 不依赖 Tauri，可以在 Node 里直接跑——所以「保存并离开 /
 * 放弃修改 / 继续编辑」三条分支的行为是可以实测的，不需要打开应用点按钮。
 *
 * 用法：npx tsx tools/verify_unsaved_guard.ts
 */
import { useUnsavedStore } from '../src/stores/unsavedStore';

const store = useUnsavedStore;
let failures = 0;

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

console.log('');
if (failures === 0) {
  console.log('>>> 未保存守卫状态机全部通过 ✅');
} else {
  console.log(`>>> 有 ${failures} 项未通过 ❌`);
  process.exit(1);
}
