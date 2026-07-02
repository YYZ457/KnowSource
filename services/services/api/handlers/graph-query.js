/** @module services/api/handlers/graph-query
 *  职责：GET /graph/query — 图查询
 */
import { getNeighbors, findPath, searchByContent, KnowledgeGraph } from '../../../core/graph/index.js';
import { storage } from '../../storage.js';

// 缓存 KnowledgeGraph 对象，避免每次查询都重建。
// 通过比较 storage.graphVersion 版本号判断是否失效：
// 每次修改 graph（替换、修改 nodes/edges/stats）时 storage 模块会递增版本号，
// 版本号变化即代表数据已更新，需重建缓存。
let cachedGraph = null;
let cachedVersion = -1;

/**
 * 强制失效缓存（供外部在 graph 变更后调用）
 */
export function invalidateGraphCache() {
  cachedGraph = null;
  cachedVersion = -1;
}

function getGraph() {
  const version = storage.graphVersion;

  // 版本号未变化时直接返回缓存
  if (cachedGraph && cachedVersion === version) {
    return cachedGraph;
  }

  // 重建缓存
  const g = new KnowledgeGraph();
  const nodes = storage.graph?.nodes;
  const edges = storage.graph?.edges;
  if (nodes && edges) {
    for (const node of nodes) g.addNode(node);
    for (const edge of edges) g.addEdge(edge);
  }
  cachedGraph = g;
  cachedVersion = version;
  return g;
}

/**
 * 获取当前项目的 KnowledgeGraph 实例（带缓存，与 graph-query handler 共享同一缓存）
 * 供 match handler 等其他模块复用，避免重复构建图谱对象。
 * @returns {KnowledgeGraph}
 */
export { getGraph };

export async function graphQueryHandler({ action, nodeId, from, to, query, depth, type, limit } = {}) {
  const graph = getGraph();

  switch (action) {
    case 'neighbors':
      if (!nodeId) return { success: false, error: '缺少节点 ID' };
      return { success: true, neighbors: getNeighbors(graph, nodeId, parseInt(depth) || 1) };

    case 'path':
      if (!from || !to) return { success: false, error: '缺少起点或终点节点' };
      return { success: true, path: findPath(graph, from, to) };

    case 'search':
      if (!query) return { success: false, error: '缺少搜索关键词' };
      return { success: true, results: searchByContent(graph, query, { type, limit: parseInt(limit) || 20 }) };

    case 'stats': {
      // 直接返回 storage.graph 的原始节点/边数组，避免 serialize() 丢失 label/color/shape 等字段
      const nodes = (storage.graph && storage.graph.nodes) || [];
      const edges = (storage.graph && storage.graph.edges) || [];
      return { success: true, stats: { nodeCount: nodes.length, edgeCount: edges.length }, nodes, edges };
    }

    default:
      return { success: false, error: '未知的查询操作，请使用：neighbors、path、search 或 stats' };
  }
}
