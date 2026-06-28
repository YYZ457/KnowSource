/** @module core/graph/merge
 *  职责：概念合并（同义概念节点合并为单一节点 + 别名）
 */
import { textSimilarity } from '../matcher/index.js';

/**
 * 合并语义相似的概念节点
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {{threshold?:number, aliasTable?:Map<string,string[]>}} options
 * @returns {{mergedCount:number, mergedPairs:string[][]}}
 */
export function mergeConcepts(graph, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const aliasTable = options.aliasTable || new Map();
  const result = { mergedCount: 0, mergedPairs: [] };

  // 收集所有 concept 节点
  const concepts = Array.from(graph.nodes.values()).filter(n => n.type === 'concept');

  // 标记已合并的节点
  const merged = new Set();

  for (let i = 0; i < concepts.length; i++) {
    if (merged.has(concepts[i].id)) continue;
    const primary = concepts[i];

    // 检查别名表
    const aliases = aliasTable.get(primary.content) || [];

    for (let j = i + 1; j < concepts.length; j++) {
      if (merged.has(concepts[j].id)) continue;
      const secondary = concepts[j];

      // 判断是否应合并：别名表命中 或 语义相似度超阈值
      let shouldMerge = aliases.includes(secondary.content);
      if (!shouldMerge) {
        // 用 textSimilarity 做简单相似度（基于字符重叠）
        const sim = textSimilarity(primary.content, secondary.content);
        shouldMerge = sim >= threshold;
      }
      // 完全相同内容直接合并
      if (primary.content === secondary.content) shouldMerge = true;

      if (shouldMerge) {
        // 合并：primary 吸收 secondary
        primary.mergeAlias(secondary);
        // 迁移 secondary 的所有边到 primary
        migrateEdges(graph, secondary.id, primary.id);
        // 删除 secondary
        graph.removeNode(secondary.id);
        merged.add(secondary.id);
        result.mergedCount++;
        result.mergedPairs.push([secondary.id, primary.id]);
      }
    }
  }

  return result;
}

/** 将 fromId 的所有边迁移到 toId */
function migrateEdges(graph, fromId, toId) {
  const edgesToMigrate = [];
  for (const [key, edge] of graph.edges) {
    if (edge.from === fromId || edge.to === fromId) {
      edgesToMigrate.push({ key, edge });
    }
  }
  for (const { key, edge } of edgesToMigrate) {
    graph.edges.delete(key);
    const newEdge = {
      from: edge.from === fromId ? toId : edge.from,
      to: edge.to === fromId ? toId : edge.to,
      type: edge.type,
      weight: edge.weight,
      evidence: edge.evidence
    };
    // 避免自环
    if (newEdge.from !== newEdge.to) {
      graph.addEdge(newEdge);
    }
  }
}
