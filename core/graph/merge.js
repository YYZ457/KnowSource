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

  // 修复：合并 concept 和 entity 类型节点（LLM 提取的实体类型为 entity）
  // 但只合并同一文档内的 entity，跨文档 entity 保留独立以承接 cross-link 边
  const concepts = Array.from(graph.nodes.values()).filter(n => n.type === 'concept' || n.type === 'entity');

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
        // 完全相同内容直接合并（优先判断，避免相似度计算误差）
        if (primary.content === secondary.content) {
          shouldMerge = true;
        } else {
          // 用 textSimilarity 做简单相似度（基于字符重叠）
          const sim = textSimilarity(primary.content, secondary.content);
          shouldMerge = sim >= threshold;
        }
      }

      if (shouldMerge) {
        // 修复：跨文档的 entity 不合并，保留独立节点以承接 cross-link 边
        // concept 类型可以跨文档合并（概念本就跨文档通用）
        if (primary.type === 'entity' && secondary.type === 'entity') {
          const docA = primary.source?.docId || primary.source?.sectionId?.split('_')[0];
          const docB = secondary.source?.docId || secondary.source?.sectionId?.split('_')[0];
          if (docA && docB && docA !== docB) {
            // 跨文档 entity 不合并，保留独立节点
            continue;
          }
        }
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
      evidence: edge.evidence,
      source: edge.source // 保留来源溯源信息
    };
    // 避免自环
    if (newEdge.from !== newEdge.to) {
      graph.addEdge(newEdge);
    }
  }
}
