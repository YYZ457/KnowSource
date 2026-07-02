/** @module core/matcher/keyword
 *  职责：关键词层匹配（Jaccard + 加权重叠）
 */
import { tokenize } from '../extractor/index.js';

/**
 * Jaccard 相似度（基于 token 集合）
 * @param {string} text1
 * @param {string} text2
 * @returns {number}
 */
export function jaccardSimilarity(text1, text2) {
  const tokens1 = new Set(tokenize(text1));
  const tokens2 = new Set(tokenize(text2));
  const intersection = [...tokens1].filter(t => tokens2.has(t));
  const union = new Set([...tokens1, ...tokens2]);
  if (union.size === 0) return 0;
  return intersection.length / union.size;
}

/**
 * 加权关键词重叠度
 * @param {{word:string, count:number}[]} keywords1
 * @param {{word:string, count:number}[]} keywords2
 * @returns {number}
 */
export function weightedKeywordOverlap(keywords1, keywords2) {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;
  const map1 = new Map(keywords1.map(k => [k.word, k.count]));
  const map2 = new Map(keywords2.map(k => [k.word, k.count]));
  let overlapScore = 0;
  let totalScore = 0;
  for (const [word, count] of map1) {
    totalScore += count;
    if (map2.has(word)) overlapScore += Math.min(count, map2.get(word));
  }
  return totalScore > 0 ? overlapScore / totalScore : 0;
}
