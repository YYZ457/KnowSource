/** @module core/matcher/semantic
 *  职责：语义层匹配（embedding 余弦相似度）
 */
import { createHash } from 'node:crypto';
import { cosineSimilarity } from './tfidf.js';

// 缓存 embedding 避免重复计算，使用 LRU 策略限制大小，避免长期运行内存泄漏
const MAX_EMBEDDING_CACHE = 1000;
const embeddingCache = new Map();

function getCacheKey(text) {
  return createHash('sha256').update(text).digest('hex');
}

function getCached(key) {
  if (!embeddingCache.has(key)) return undefined;
  // 访问时移动到末尾表示最近使用
  const value = embeddingCache.get(key);
  embeddingCache.delete(key);
  embeddingCache.set(key, value);
  return value;
}

function setCached(key, value) {
  if (embeddingCache.has(key)) {
    embeddingCache.delete(key);
  } else if (embeddingCache.size >= MAX_EMBEDDING_CACHE) {
    // 淘汰最久未使用的条目（Map 第一个）
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }
  embeddingCache.set(key, value);
}

/**
 * 获取文本的 embedding（带缓存）
 * @param {string} text
 * @param {function} embedFn — embedding 提供函数
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text, embedFn) {
  const cacheKey = getCacheKey(text);
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;
  const vec = await embedFn(text);
  setCached(cacheKey, vec);
  return vec;
}

/**
 * 语义相似度
 * @param {string} text1
 * @param {string} text2
 * @param {function} embedFn — embedding 提供函数
 * @returns {Promise<number>}
 */
export async function semanticSimilarity(text1, text2, embedFn) {
  const [v1, v2] = await Promise.all([
    getEmbedding(text1, embedFn),
    getEmbedding(text2, embedFn)
  ]);
  // 转为 Map 以复用 cosineSimilarity
  const m1 = new Map(v1.map((v, i) => [String(i), v]));
  const m2 = new Map(v2.map((v, i) => [String(i), v]));
  return cosineSimilarity(m1, m2);
}

/** 清除 embedding 缓存 */
export function clearEmbeddingCache() {
  embeddingCache.clear();
}
