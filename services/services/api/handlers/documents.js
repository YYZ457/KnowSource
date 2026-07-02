/** @module services/api/handlers/documents
 *  职责：文档排序 — POST /documents/reorder
 *  通过重建 documentsMap 的插入顺序来持久化文档排列顺序
 */
import { storage, isProjectSwitching } from '../../storage.js';

/**
 * POST /documents/reorder — 重新排序文档
 * 接收完整的文档 ID 有序列表，按该顺序重建内存中的 Map（Map 保留插入顺序），
 * 持久化时 Array.from(map.values()) 即按新顺序写入 JSON。
 * @param {{ docIds?: string[] }} params - 按期望顺序排列的文档 ID 数组
 * @returns {{ success?: boolean, docIds?: string[], error?: string }}
 */
export function reorderDocuments({ docIds } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!Array.isArray(docIds) || docIds.length === 0) {
    return { success: false, error: '缺少文档 ID 列表' };
  }

  // 获取当前所有文档（保留 rawBase64 等内存字段）
  const allDocs = Array.from(storage.documents.values());
  const docMap = new Map(allDocs.map(d => [(d.docId || d.id), d]));

  // 按传入顺序构建有序列表
  const ordered = [];
  const seen = new Set();
  for (const id of docIds) {
    const doc = docMap.get(id);
    if (doc && !seen.has(id)) {
      ordered.push(doc);
      seen.add(id);
    }
  }
  // 追加未在 docIds 中出现的文档（容错，正常不会发生）
  for (const doc of allDocs) {
    const id = doc.docId || doc.id;
    if (!seen.has(id)) {
      ordered.push(doc);
      seen.add(id);
    }
  }

  // 重建 Map：clear + 逐条 set（Proxy 包装的 mutator 会触发防抖保存）
  storage.documents.clear();
  for (const doc of ordered) {
    storage.documents.set(doc.docId || doc.id, doc);
  }

  return { success: true, docIds: ordered.map(d => d.docId || d.id) };
}
