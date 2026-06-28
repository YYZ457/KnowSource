/** @module services/vector-store
 *  职责：向量库适配器
 *  - MemoryVectorStore：纯内存，无持久化
 *  - PersistedMemoryVectorStore：内存索引 + JSON 文件持久化，无原生依赖，可打包到 Electron
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

// 内存向量库
class MemoryVectorStore {
  constructor() {
    /** @type {Map<string, {id:string, vec:number[], meta?:Object}>} */
    this.vectors = new Map();
    this.name = 'memory';
  }

  async upsert(id, vec, meta = {}) {
    this.vectors.set(id, { id, vec, meta });
  }

  async query(queryVec, k = 5) {
    const results = [];
    for (const { id, vec, meta } of this.vectors.values()) {
      const sim = cosineSimilarity(queryVec, vec);
      results.push({ id, score: sim, meta });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  async get(id) {
    return this.vectors.get(id) || null;
  }

  async delete(id) {
    return this.vectors.delete(id);
  }

  async clear() {
    this.vectors.clear();
  }

  async size() {
    return this.vectors.size;
  }
}

// 持久化内存向量库：启动时加载到内存，查询走内存索引，写入后异步落盘
class PersistedMemoryVectorStore {
  constructor({ filePath = ':memory:', dbPath } = {}) {
    this.name = 'persistent';
    // 兼容旧的 sqlite 配置字段 dbPath
    this.filePath = filePath === ':memory:' && dbPath ? dbPath : filePath;
    this.vectors = new Map();
    // 串行化磁盘写入，避免并发损坏文件
    this._saveChain = Promise.resolve();
    this._loaded = false;
  }

  async _ensureLoaded() {
    if (this._loaded) return;
    if (this.filePath && this.filePath !== ':memory:' && existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && Array.isArray(data.vectors)) {
          for (const item of data.vectors) {
            if (item && item.id && Array.isArray(item.vec)) {
              this.vectors.set(item.id, { id: item.id, vec: item.vec, meta: item.meta || {} });
            }
          }
        }
      } catch (e) {
        console.warn('[vector-store] 加载持久化向量文件失败，使用空库:', e.message);
        this.vectors.clear();
      }
    }
    this._loaded = true;
  }

  _scheduleSave() {
    if (!this.filePath || this.filePath === ':memory:') return Promise.resolve();
    this._saveChain = this._saveChain.then(async () => {
      const payload = {
        version: 1,
        vectors: Array.from(this.vectors.values()).map(({ id, vec, meta }) => ({ id, vec, meta }))
      };
      await writeFile(this.filePath, JSON.stringify(payload), 'utf-8');
    }).catch((e) => {
      console.warn('[vector-store] 持久化向量文件保存失败:', e.message);
    });
    return this._saveChain;
  }

  async upsert(id, vec, meta = {}) {
    await this._ensureLoaded();
    this.vectors.set(id, { id, vec, meta });
    return this._scheduleSave();
  }

  async query(queryVec, k = 5) {
    await this._ensureLoaded();
    const results = [];
    for (const { id, vec, meta } of this.vectors.values()) {
      const sim = cosineSimilarity(queryVec, vec);
      results.push({ id, score: sim, meta });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  async get(id) {
    await this._ensureLoaded();
    return this.vectors.get(id) || null;
  }

  async delete(id) {
    await this._ensureLoaded();
    const existed = this.vectors.delete(id);
    if (existed) await this._scheduleSave();
    return existed;
  }

  async clear() {
    await this._ensureLoaded();
    this.vectors.clear();
    if (this.filePath && this.filePath !== ':memory:' && existsSync(this.filePath)) {
      try {
        await unlink(this.filePath);
      } catch (e) {
        console.warn('[vector-store] 删除持久化向量文件失败:', e.message);
      }
    }
  }

  async size() {
    await this._ensureLoaded();
    return this.vectors.size;
  }
}

function cosineSimilarity(v1, v2) {
  if (v1.length !== v2.length) return 0;
  let dot = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  // 浮点误差可能导致结果略微超出 [-1, 1]， clamp 到合法区间
  const sim = dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
  if (!Number.isFinite(sim)) return 0;
  return Math.max(-1, Math.min(1, sim));
}

let currentStore = new MemoryVectorStore();

export function setVectorStore(store) {
  currentStore = store;
}

export function getVectorStore() {
  return currentStore;
}

export function createVectorStore(type, options = {}) {
  switch (type) {
    // 保留 'sqlite' 作为别名，实际使用无原生依赖的持久化内存索引
    case 'sqlite':
    case 'persistent':
      return new PersistedMemoryVectorStore(options);
    case 'memory':
    default:
      return new MemoryVectorStore(options);
  }
}

export async function upsert(id, vec, meta) {
  return currentStore.upsert(id, vec, meta);
}

export async function query(vec, k) {
  return currentStore.query(vec, k);
}

export { MemoryVectorStore, PersistedMemoryVectorStore };
