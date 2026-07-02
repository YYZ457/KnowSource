/** @module core/idea/linkage
 *  职责：Idea 与知识图谱的联动（自动创建边）
 */
import { GraphNode, GraphEdge } from '../graph/index.js';

/**
 * 将 Idea 注册到图谱（创建 idea 节点 + belong 边）
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {import('./model.js').Idea} idea
 */
export function linkIdeaToGraph(graph, idea) {
  // 创建 idea 节点
  const ideaNode = graph.addNode({
    id: idea.id,
    type: 'idea',
    content: idea.title,
    source: { docId: null, location: { ideaId: idea.id } },
    weight: 1,
    meta: { content: idea.content }
  });

  // 为每个 relatedNode 创建 belong 边
  for (const nodeId of idea.relatedNodes) {
    if (graph.getNode(nodeId)) {
      graph.addEdge({
        from: idea.id,
        to: nodeId,
        type: 'belong',
        weight: 1,
        evidence: { ideaId: idea.id }
      });
    }
  }

  return ideaNode;
}

/**
 * 为两个 Idea 间的关系创建边
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {string} fromIdeaId
 * @param {string} toIdeaId
 * @param {'derive'|'contrast'|'support'} type
 */
export function linkIdeaRelation(graph, fromIdeaId, toIdeaId, type) {
  if (!graph.getNode(fromIdeaId) || !graph.getNode(toIdeaId)) return null;

  // Idea 间关系用 derive 类型边（contrast/support 暂归为 derive 的子类型，存 evidence）
  return graph.addEdge({
    from: fromIdeaId,
    to: toIdeaId,
    type: type === 'derive' ? 'derive' : 'derive', // 图谱边类型只有 cite/similar/derive/belong
    weight: 1,
    evidence: { relationType: type, fromIdea: fromIdeaId, toIdea: toIdeaId }
  });
}

/**
 * 从图谱移除 Idea 节点及其边
 * @param {import('../graph/graph.js').KnowledgeGraph} graph
 * @param {string} ideaId
 */
export function unlinkIdeaFromGraph(graph, ideaId) {
  graph.removeNode(ideaId);
}
