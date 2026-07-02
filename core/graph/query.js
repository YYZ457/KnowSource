/** @module core/graph/query
 *  职责：图查询（邻居/路径/内容搜索）
 */

/**
 * 获取节点的 N 跳邻居
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {string} nodeId
 * @param {number} depth — 跳数（默认 1）
 * @returns {{node:import('./node.js').GraphNode, depth:number, path:string[]}[]}
 */
export function getNeighbors(graph, nodeId, depth = 1) {
  const visited = new Set([nodeId]);
  const result = [];
  const queue = [{ id: nodeId, depth: 0, path: [nodeId] }];

  while (queue.length > 0) {
    const { id, depth: curDepth, path } = queue.shift();
    if (curDepth >= depth) continue;

    const neighbors = graph.getNeighbors(id);
    for (const { node } of neighbors) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const newPath = [...path, node.id];
      result.push({ node, depth: curDepth + 1, path: newPath });
      queue.push({ id: node.id, depth: curDepth + 1, path: newPath });
    }
  }

  return result;
}

/**
 * 查找两节点间的最短路径（BFS）
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {string} fromId
 * @param {string} toId
 * @returns {{path:string[], edges:import('./edge.js').GraphEdge[]} | null}
 */
export function findPath(graph, fromId, toId) {
  if (!graph.getNode(fromId) || !graph.getNode(toId)) return null;
  if (fromId === toId) return { path: [fromId], edges: [] };

  const visited = new Set([fromId]);
  const queue = [{ id: fromId, path: [fromId], edges: [] }];

  while (queue.length > 0) {
    const { id, path, edges } = queue.shift();
    const neighbors = graph.getNeighbors(id);

    for (const { node, edge } of neighbors) {
      if (visited.has(node.id)) continue;
      const newPath = [...path, node.id];
      const newEdges = [...edges, edge];

      if (node.id === toId) {
        return { path: newPath, edges: newEdges };
      }

      visited.add(node.id);
      queue.push({ id: node.id, path: newPath, edges: newEdges });
    }
  }

  return null; // 无路径
}

/**
 * 按内容搜索节点（简单子串匹配）
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {string} query
 * @param {{type?:string, limit?:number}} options
 * @returns {import('./node.js').GraphNode[]}
 */
export function searchByContent(graph, query, options = {}) {
  const limit = options.limit ?? 20;
  const typeFilter = options.type;
  const q = query.toLowerCase();

  const results = [];
  const nodeList = Array.isArray(graph.nodes)
    ? graph.nodes
    : (graph.nodes instanceof Map ? Array.from(graph.nodes.values()) : Object.values(graph.nodes));
  for (const node of nodeList) {
    if (typeFilter && node.type !== typeFilter) continue;

    let matched = false;
    let score = 0;

    // 主内容匹配
    if (node.content && node.content.toLowerCase().includes(q)) {
      matched = true;
      score = 1;
    }
    // 别名匹配
    if (!matched && node.aliases) {
      for (const alias of node.aliases) {
        if (alias.toLowerCase().includes(q)) {
          matched = true;
          score = 0.8;
          break;
        }
      }
    }

    if (matched) {
      results.push({ ...node, _score: score });
    }
  }

  results.sort((a, b) => b._score - a._score || b.weight - a.weight);
  return results.slice(0, limit);
}
