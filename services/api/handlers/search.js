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
  // 类型校验：非字符串 keyword 返回空结果而非 500 错误
  if (typeof keyword !== 'string' || keyword.trim().length < 1) return { success: true, results: [], total: 0 };
  // 关键词长度限制，防止超长输入导致性能问题
  if (keyword.length > 500) return { success: false, error: '关键词过长（最多 500 字符）' };

  const results = [];
  const documents = storage.documents || new Map();
  const lowerKeyword = keyword.toLowerCase();

  for (const [id, doc] of documents) {
    // 达到 50 条上限后提前退出文档循环
    if (results.length >= 50) break;

    if (docId && id !== docId) continue;

    // 文档文本存放于 rawText 字段（兼容 text / content）
    const text = doc.rawText || doc.text || doc.content || '';
    if (!text) continue;

    // 按页搜索（文本中有 --- 第N页 --- 或 --- 第N页(OCR) --- 标记）
    const pages = text.split(/\n--- 第\d+页(?:\(OCR\))? ---\n/);
    const pageMarkers = text.match(/\n--- 第(\d+)页(?:\(OCR\))? ---\n/g) || [];

    // 预计算 sections 的字符范围，用于在结果中关联 sectionTitle
    const sections = doc.sections || [];
    const sectionRanges = [];
    let secStart = 0;
    for (const sec of sections) {
      const secContent = sec.content || '';
      sectionRanges.push({ start: secStart, end: secStart + secContent.length, title: sec.title || '' });
      secStart += secContent.length + 1; // +1 for separator
    }

    // 查找匹配位置属于哪个 section
    function findSectionTitle(absOffset) {
      for (const sr of sectionRanges) {
        if (absOffset >= sr.start && absOffset < sr.end) return sr.title;
      }
      return '';
    }

    let charOffset = 0;
    for (let p = 0; p < pages.length; p++) {
      // 达到上限后提前退出页循环
      if (results.length >= 50) break;

      const pageText = pages[p];
      const pageNum = p === 0 ? 1 : (parseInt(pageMarkers[p - 1]?.match(/\d+/)?.[0] || '1', 10));

      // 先统计该页所有匹配位置，用于计算基于匹配次数的 score
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
        // 提取上下文片段，使用 lowerKeyword.length 避免 Unicode 大小写转换长度不一致
        const start = Math.max(0, matchIdx - 40);
        const end = Math.min(pageText.length, matchIdx + lowerKeyword.length + 40);
        const snippet = (start > 0 ? '...' : '') + pageText.substring(start, end) + (end < pageText.length ? '...' : '');

        results.push({
          docId: id,
          docName: doc.name || doc.meta?.name || doc.title || id,
          page: pageNum,
          sectionTitle: findSectionTitle(charOffset + matchIdx),
          snippet,
          score: matchCount,
          matchIndex: charOffset + matchIdx
        });

        if (results.length >= 50) break; // 最多50条结果
      }

      charOffset += pageText.length + (pageMarkers[p]?.length || 0);
    }
  }

  // 按相关度排序（匹配次数降序）
  results.sort((a, b) => b.score - a.score);

  // 修复：对同文档同章节的匹配去重，只保留 score 最高的那条
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = r.docId + '|' + (r.sectionTitle || '');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  return { success: true, results: deduped, total: deduped.length };
}
