/**
 * C2：生成本地唯一 ID。
 *
 * `crypto.randomUUID()` 需要 iOS Safari **15.4+** 与较新的桌面浏览器；
 * 旧设备上它是 undefined，直接调用会抛 "crypto.randomUUID is not a function"，
 * 表现就是"录音能录但保存不了"。这里做逐级回退，避免把浏览器版本差异
 * 变成一个看起来像功能故障的错误。
 */
export function randomId(): string {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    // 按 RFC 4122 设置版本位与变体位
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // 最后兜底：仅用于本机标识，不承担任何安全职责
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
