/** @module core/matcher/tfidf
 *  职责：TF-IDF 向量化与余弦相似度
 */
import { tokenize } from '../extractor/index.js';

/**
 * 计算 TF-IDF 向量
 * @param {string[]} documents — 文档语料（每篇文档的文本）
 * @returns {{vectors:Map<string,number>[], idf:Map<string,number>, vocab:string[]}}
 */
export function computeTfIdf(documents) {
  // 1. 分词
  const tokenizedDocs = documents.map(doc => tokenize(doc));

  // 2. 构建词汇表
  const vocabSet = new Set();
  for (const tokens of tokenizedDocs) {
    for (const t of tokens) vocabSet.add(t);
  }
  const vocab = Array.from(vocabSet);

  // 3. 计算 IDF
  const docCount = documents.length;
  // 预先将每篇文档的 tokens 转为 Set，避免 O(V*D*T) 的线性查找
  const tokenizedDocSets = tokenizedDocs.map(tokens => new Set(tokens));
  const idf = new Map();
  for (const term of vocab) {
    let docFreq = 0;
    for (const tokenSet of tokenizedDocSets) {
      if (tokenSet.has(term)) docFreq++;
    }
    idf.set(term, Math.log((docCount + 1) / (docFreq + 1)) + 1);
  }

  // 4. 计算每篇文档的 TF-IDF 向量
  const vectors = tokenizedDocs.map(tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const len = tokens.length || 1;
    const vec = new Map();
    for (const [term, count] of tf) {
      vec.set(term, (count / len) * (idf.get(term) || 0));
    }
    return vec;
  });

  return { vectors, idf, vocab };
}

/**
 * 将查询文本转为 TF-IDF 向量
 * @param {string} query
 * @param {Map<string,number>} idf
 * @returns {Map<string,number>}
 */
export function queryToVector(query, idf) {
  const tokens = tokenize(query);
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const len = tokens.length || 1;
  const vec = new Map();
  for (const [term, count] of tf) {
    vec.set(term, (count / len) * (idf.get(term) || 0));
  }
  return vec;
}

/**
 * 余弦相似度
 * @param {Map<string,number>} v1
 * @param {Map<string,number>} v2
 * @returns {number}
 */
export function cosineSimilarity(v1, v2) {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (const [term, val] of v1) {
    norm1 += val * val;
    if (v2.has(term)) dot += val * v2.get(term);
  }
  for (const val of v2.values()) norm2 += val * val;

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}
