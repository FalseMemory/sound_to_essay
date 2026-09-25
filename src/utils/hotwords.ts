/**
 * 转写热词处理。
 *
 * 用户在设置页里可能用换行、空格、逗号或顿号分隔热词；Python 侧期望的是
 * 空格分隔的单行字符串，所以在 IPC 前统一规范化。
 */
export function normalizeHotwords(input?: string): string | undefined {
  const tokens = (input ?? '')
    .split(/[\s,，、;；\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}
