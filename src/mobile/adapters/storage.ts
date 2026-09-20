/**
 * C1：基于 IndexedDB 的本地存储实现。
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 * 录音是二进制且体积大，localStorage 只能存字符串、容量约 5MB，完全不够用。
 *
 * 三个对象仓库：
 * - memories：素材元数据（按 recordId）
 * - audio   ：成品音频（按 assetId）
 * - chunks  ：录制过程中的音频分块（按 recordingId + seq），用于中断恢复
 */
import type { LocalMemory, MemoryStore, PendingRecording } from './types';

const DB_NAME = 'sound_to_essay_mobile';
const DB_VERSION = 2; // v2：新增 pending 仓库（未完成录音，用于中断恢复）
const STORE_MEMORIES = 'memories';
const STORE_AUDIO = 'audio';
const STORE_CHUNKS = 'chunks';
const STORE_PENDING = 'pending';
/** 同一时刻只允许一条未完成录音，用固定键存放。 */
const PENDING_KEY = 'current';

interface AudioRecord {
  assetId: string;
  blob: Blob;
}

interface ChunkRecord {
  recordingId: string;
  seq: number;
  blob: Blob;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务被中断'));
  });
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function createIndexedDbStore(): MemoryStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (!isIndexedDbAvailable()) {
      return Promise.reject(new Error('此浏览器不支持 IndexedDB，无法在本机保存素材'));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
          db.createObjectStore(STORE_MEMORIES, { keyPath: 'recordId' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO, { keyPath: 'assetId' });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          // 复合主键：同一次录制的分块按 seq 排序取出
          db.createObjectStore(STORE_CHUNKS, { keyPath: ['recordingId', 'seq'] });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          // v2 新增：保存"正在录制"的元信息，供中断恢复使用。
          // 老库升级时走到这里，既有 memories/audio/chunks 数据不受影响。
          db.createObjectStore(STORE_PENDING, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
        resolve(request.result);
      };
      request.onerror = () => { dbPromise = null; reject(request.error ?? new Error('无法打开本地数据库')); };
    });
    return dbPromise;
  };

  const store = async (name: string, mode: IDBTransactionMode) => {
    const db = await open();
    const transaction = db.transaction(name, mode);
    return { transaction, objectStore: transaction.objectStore(name) };
  };

  /** 删除某次录制的全部分片。 */
  const clearChunksOf = async (recordingId: string) => {
    const { transaction, objectStore } = await store(STORE_CHUNKS, 'readwrite');
    const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
    objectStore.delete(range);
    await txDone(transaction);
  };

  return {
    async commitRecording(memory, blob, recordingId) {
      if (!memory.audio) throw new Error('录音缺少资产信息');
      const db = await open();
      const tx = db.transaction([STORE_MEMORIES, STORE_AUDIO, STORE_CHUNKS, STORE_PENDING], 'readwrite');
      const done = txDone(tx);
      tx.objectStore(STORE_MEMORIES).put(memory);
      tx.objectStore(STORE_AUDIO).put({ assetId: memory.audio.assetId, blob });
      // 手动导入的音频没有分片与未完成标记，跳过这两步即可
      if (recordingId) {
        tx.objectStore(STORE_CHUNKS).delete(
          IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]),
        );
        const request = tx.objectStore(STORE_PENDING).get(PENDING_KEY);
        request.onsuccess = () => {
          if (request.result?.recording.recordingId === recordingId) {
            tx.objectStore(STORE_PENDING).delete(PENDING_KEY);
          }
        };
      }
      await done;
    },
    async init() {
      await open();
    },

    async list() {
      const { transaction, objectStore } = await store(STORE_MEMORIES, 'readonly');
      const all = await promisify<LocalMemory[]>(objectStore.getAll() as IDBRequest<LocalMemory[]>);
      await txDone(transaction);
      // 最近更新的排在前面
      return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    async get(recordId) {
      const { transaction, objectStore } = await store(STORE_MEMORIES, 'readonly');
      const found = await promisify<LocalMemory | undefined>(
        objectStore.get(recordId) as IDBRequest<LocalMemory | undefined>,
      );
      await txDone(transaction);
      return found ?? null;
    },

    async put(memory) {
      const { transaction, objectStore } = await store(STORE_MEMORIES, 'readwrite');
      objectStore.put(memory);
      await txDone(transaction);
    },

    async remove(recordId) {
      const { transaction, objectStore } = await store(STORE_MEMORIES, 'readwrite');
      objectStore.delete(recordId);
      await txDone(transaction);
    },

    async appendChunk(recordingId, seq, blob) {
      const { transaction, objectStore } = await store(STORE_CHUNKS, 'readwrite');
      const record: ChunkRecord = { recordingId, seq, blob };
      objectStore.put(record);
      await txDone(transaction);
    },

    async listChunks(recordingId) {
      const { transaction, objectStore } = await store(STORE_CHUNKS, 'readonly');
      const range = IDBKeyRange.bound(
        [recordingId, 0],
        [recordingId, Number.MAX_SAFE_INTEGER],
      );
      const rows = await promisify<ChunkRecord[]>(
        objectStore.getAll(range) as IDBRequest<ChunkRecord[]>,
      );
      await txDone(transaction);
      return rows.sort((a, b) => a.seq - b.seq).map((row) => ({ seq: row.seq, blob: row.blob }));
    },

    async clearChunks(recordingId) {
      await clearChunksOf(recordingId);
    },

    async getPendingRecording() {
      const { transaction, objectStore } = await store(STORE_PENDING, 'readonly');
      const found = await promisify<{ key: string; recording: PendingRecording } | undefined>(
        objectStore.get(PENDING_KEY) as IDBRequest<
          { key: string; recording: PendingRecording } | undefined
        >,
      );
      await txDone(transaction);
      return found?.recording ?? null;
    },

    async savePendingRecording(recording) {
      const { transaction, objectStore } = await store(STORE_PENDING, 'readwrite');
      const done = txDone(transaction);
      const request = objectStore.get(PENDING_KEY);
      request.onsuccess = () => {
        if (request.result && request.result.recording.recordingId !== recording.recordingId) {
          transaction.abort();
        } else objectStore.put({ key: PENDING_KEY, recording });
      };
      await done;
    },

    async clearPendingRecording(recordingId) {
      const db = await open();
      const tx = db.transaction([STORE_CHUNKS, STORE_PENDING], 'readwrite');
      const done = txDone(tx);
      tx.objectStore(STORE_CHUNKS).delete(IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]));
      const request = tx.objectStore(STORE_PENDING).get(PENDING_KEY);
      request.onsuccess = () => {
        if (request.result?.recording.recordingId === recordingId) tx.objectStore(STORE_PENDING).delete(PENDING_KEY);
      };
      await done;
    },

    async putAudio(assetId, blob) {
      const { transaction, objectStore } = await store(STORE_AUDIO, 'readwrite');
      const record: AudioRecord = { assetId, blob };
      objectStore.put(record);
      await txDone(transaction);
    },

    async getAudio(assetId) {
      const { transaction, objectStore } = await store(STORE_AUDIO, 'readonly');
      const found = await promisify<AudioRecord | undefined>(
        objectStore.get(assetId) as IDBRequest<AudioRecord | undefined>,
      );
      await txDone(transaction);
      return found?.blob ?? null;
    },

    async removeAudio(assetId) {
      const { transaction, objectStore } = await store(STORE_AUDIO, 'readwrite');
      objectStore.delete(assetId);
      await txDone(transaction);
    },

    async usage() {
      if (!navigator.storage?.estimate) {
        return { usedBytes: 0, quotaBytes: undefined };
      }
      const estimate = await navigator.storage.estimate();
      return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota };
    },
  };
}
