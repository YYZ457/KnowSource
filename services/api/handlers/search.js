/** @module services/api/handlers/search
 *  职责：POST /search — 文档内容搜索（按页定位 + 上下文片段）
 */
import { storage } from '../../storage.js';

/**
 * 文档内容搜索
 * @param {{keyword: string, docId?: string}} body
 * @returns {Promise<{results: Array, total: number}>}
 */
export async function searchHandler(body = {}) {
  const { keyword, docId } = body;
  if (!keyword || keyword.length < 1) return { success: true, results: [], total: 0 };

  const results = [];
  const documents = storage.documents || new Map();
  const lowerKeyword = keyword.toLowerCase();

  for (const [id, doc] of documents) {
    if (docId && id !== docId) continue;

    // 文档文本存放于 rawText 字段（兼容 text / content）
    const text = doc.rawText || doc.text || doc.content || '';
    if (!text) continue;

    // 按页搜索（文本中有 --- 第N页 --- 或 --- 第N页(OCR) --- 标记）
    const pages = text.split(/\n--- 第\d+页(?:\(OCR\))? ---\n/);
    const pageMarkers = text.match(/\n--- 第(\d+)页(?:\(OCR\))? ---\n/g) || [];

    let charOffset = 0;
    for (let p = 0; p < pages.length; p++) {
      const pageText = pages[p];
      const pageNum = p === 0 ? 1 : (parseInt(pageMarkers[p - 1]?.match(/\d+/)?.[0] || '1', 10));

      // 先统计该页所有匹配位置，用于计算基于匹配次数的 score
      // 将 toLowerCase() 提取到循环外，避免每次 indexOf 都重新执行
      const matchPositions = [];
      const lowerPageText = pageText.toLowerCase();
      let idx = lowerPageText.indexOf(lowerKeyword);
      while (idx !== -1) {
        matchPositions.push(idx);
        idx = lowerPageText.indexOf(lowerKeyword, idx + 1);
      }

      // score 基于该页的匹配次数：匹配越多相关度越高
      const matchCount = matchPositions.length;

      for (const matchIdx of matchPositions) {
        // 提取上下文片段
        const start = Math.max(0, matchIdx - 40);
        const end = Math.min(pageText.length, matchIdx + keyword.length + 40);
        const snippet = (start > 0 ? '...' : '') + pageText.substring(start, end) + (end < pageText.length ? '...' : '');

        results.push({
          docId: id,
          docName: doc.name || doc.meta?.name || doc.title || id,
          page: pageNum,
          snippet,
          score: matchCount, // 基于匹配次数计算相关度
          matchIndex: charOffset + matchIdx
        });

        if (results.length >= 50) break; // 最多50条结果
      }

      charOffset += pageText.length + (pageMarkers[p]?.length || 0);
      if (results.length >= 50) break;
    }
  }

  // 按相关度排序（匹配次数降序）
  results.sort((a, b) => b.score - a.score);

  return { success: true, results, total: results.length };
}
