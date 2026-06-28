/** @module core/matcher/graph-match
 *  职责：图结构层匹配（共同邻居 + Personalized PageRank）
 */

/**
 * 共同邻居数
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {string} node1Id
 * @param {string} node2Id
 * @returns {number}
 */
export function commonNeighbors(graph, node1Id, node2Id) {
  const n1 = new Set(graph.getNeighbors(node1Id).map(n => n.node.id));
  const n2 = graph.getNeighbors(node2Id).map(n => n.node.id);
  let count = 0;
  for (const id of n2) {
    if (n1.has(id)) count++;
  }
  return count;
}

/**
 * Personalized PageRank（简化版）
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {string} seedNode — 种子节点
 * @param {{alpha?:number, iterations?:number}} options
 * @returns {Map<string, number>} — 节点 id -> 分数
 */
export function personalizedPageRank(graph, seedNode, options = {}) {
  const alpha = options.alpha ?? 0.85;
  const iterations = options.iterations ?? 20;
  const nodeIds = Array.from(graph.nodes.keys());
  const n = nodeIds.length;
  if (n === 0) return new Map();

  // 初始化分数
  let scores = new Map();
  for (const id of nodeIds) scores.set(id, 0);
  scores.set(seedNode, 1);

  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map();
    for (const id of nodeIds) newScores.set(id, 0);

    for (const id of nodeIds) {
      const neighbors = graph.getNeighbors(id);
      if (neighbors.length === 0) {
        // 悬空节点：分数均匀分配（乘以alpha保持概率分布守恒）
        const share = (scores.get(id) * alpha) / n;
        for (const otherId of nodeIds) {
          newScores.set(otherId, newScores.get(otherId) + share);
        }
        continue;
      }
      const share = (scores.get(id) * alpha) / neighbors.length;
      for (const { node } of neighbors) {
        newScores.set(node.id, newScores.get(node.id) + share);
      }
      // 种子节点注入
      if (id === seedNode) {
        newScores.set(id, newScores.get(id) + (1 - alpha));
      }
    }

    // 收敛检测：如果分数变化小于阈值则提前终止
    let delta = 0;
    for (const id of nodeIds) {
      delta += Math.abs(newScores.get(id) - (scores.get(id) || 0));
    }
    scores = newScores;
    if (delta < 1e-6) break;
  }

  return scores;
}

/**
 * 图结构匹配分数
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {string} queryNodeId — 查询节点
 * @param {string} candidateNodeId — 候选节点
 * @param {Map<string,number>|null} [pprScores=null] — 预计算的 PPR 分数（避免对每个候选节点重复计算）
 * @returns {number} — 0-1 分数
 */
export function graphMatchScore(graph, queryNodeId, candidateNodeId, pprScores = null) {
  if (queryNodeId === candidateNodeId) return 1;

  // 共同邻居归一化
  const common = commonNeighbors(graph, queryNodeId, candidateNodeId);
  const n1 = graph.getNeighbors(queryNodeId).length;
  const n2 = graph.getNeighbors(candidateNodeId).length;
  const jaccard = (n1 + n2) > 0 ? common / (n1 + n2 - common) : 0;

  // PageRank 分数：优先使用预计算结果，避免对每个候选节点都执行完整 PPR 迭代
  const ppr = pprScores || personalizedPageRank(graph, queryNodeId, { iterations: 10 });
  const pprScore = ppr.get(candidateNodeId) || 0;

  // 加权组合
  return jaccard * 0.5 + Math.min(pprScore * 10, 0.5);
}
