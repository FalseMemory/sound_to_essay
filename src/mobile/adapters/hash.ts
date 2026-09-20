/**
 * C1：浏览器端的 SHA-256。
 * 使用 Web Crypto（需要安全上下文：https 或 localhost）。
 * 校验值只用于完整性与去重，不作为身份认证。
 */
/** 归一化成 ArrayBuffer，供 crypto.subtle.digest 使用。 */
async function toArrayBuffer(data: Blob | ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
  if (data instanceof Blob) return data.arrayBuffer();
  if (ArrayBuffer.isView(data)) {
    // 视图可能只是底层 buffer 的一段，必须按 byteOffset/byteLength 精确截取
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data;
}

export async function sha256Hex(data: Blob | ArrayBuffer | ArrayBufferView): Promise<string> {
  const buffer = await toArrayBuffer(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 当前环境是否可用 Web Crypto 的摘要能力。 */
export function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}
