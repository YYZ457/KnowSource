/** @module services/api/handlers/match
 *  职责：POST /match — 四层匹配查询（关键词 + TF-IDF + 语义 + 图结构）
 */
import { match } from '../../../core/matcher/index.js';
import { storage } from '../../storage.js';
import { embed } from '../../embedding-provider.js';
import { getGraph } from './graph-query.js';

export async function matchHandler({ query, strategy, weights, topN } = {}) {
  if (!query) {
    return { success: false, error: '缺少搜索关键词', results: [] };
  }

  // 从共享存储收集文档
  const documents = Array.from(storage.documents.values()).map(d => ({
    meta: { docId: d.docId },
    sections: d.sections,
    rawText: d.rawText
  }));

  // 复用 graph-query handler 的缓存 KnowledgeGraph 实例。
  // 必须使用 KnowledgeGraph 实例（而非普通对象），因为 graph-match 模块的
  // commonNeighbors / personalizedPageRank 依赖 graph.getNeighbors() 方法和
  // graph.nodes (Map) 接口。普通对象会导致 TypeError 使图层级完全失效。
  const graph = (storage.graph && storage.graph.nodes && storage.graph.nodes.length > 0)
    ? getGraph()
    : null;

  const results = await match(query, {
    strategy: strategy || 'hybrid',
    documents,
    graph,
    embedFn: embed,
    weights
  });

  return {
    query,
    strategy: strategy || 'hybrid',
    results: typeof topN === 'number' ? results.slice(0, topN) : results
  };
}
