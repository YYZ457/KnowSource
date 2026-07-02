/** @module core/idea/recommend
 *  职责：基于 Idea 内容推荐相关知识节点 / 文档片段
 */
import { match } from '../matcher/index.js';

function toNodeList(nodes) {
  if (!nodes) return [];
  if (Array.isArray(nodes)) return nodes;
  if (nodes instanceof Map) return Array.from(nodes);
  if (typeof nodes === 'object') return Object.values(nodes);
  return [];
}

/**
 * 为 Idea 推荐相关节点或文档片段
 * @param {import('./model.js').Idea} idea
 * @param {{documents?:Object[], graph?:Object, embedFn?:function, topN?:number}} options
 * @returns {Promise<{nodeId:string, score:number, breakdown:Object, content:string, source:{docId:string, docName?:string, sectionId?:string}}[]>}
 */
export async function recommendNodes(idea, options = {}) {
  const { documents = [], graph, embedFn, topN = 5 } = options;

  // 用 Idea 的 title + content 作为查询
  const query = `${idea.title} ${idea.content}`.trim();
  if (!query || documents.length === 0) return [];

  // 调用 hybrid 匹配，得到文档/片段级别的匹配结果
  const matchResults = await match(query, {
    strategy: 'hybrid',
    documents,
    graph,
    embedFn
  });

  // 排除已关联的节点
  // 注意：存储层（handlers/idea.js）使用 relatedNodeIds 字段，
  // 而 Idea 类（core/idea/model.js）使用 relatedNodes 字段。
  // 此处同时兼容两种字段名，确保已关联节点被正确排除。
  const seen = new Set(idea.relatedNodeIds || idea.relatedNodes || []);
  const recommendations = [];

  // 文档名称缓存
  const docNameMap = new Map(documents.map(d => [d.meta?.docId || d.docId, d.meta?.name || d.name || '未命名文档']));

  for (const result of matchResults) {
    if (result.score <= 0) continue;

    // 如果存在知识图谱，优先返回图谱节点
    if (graph) {
      const nodeList = toNodeList(graph.nodes);
      const nodes = nodeList.filter(n =>
        n.source?.docId === result.docId &&
        (n.source?.sectionId === result.sectionId || !result.sectionId)
      );
      for (const node of nodes) {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          recommendations.push({
            nodeId: node.id,
            score: result.score,
            breakdown: result.breakdown,
            content: node.content || result.matchedKeywords?.join(', ') || '',
            source: {
              docId: result.docId,
              docName: docNameMap.get(result.docId),
              sectionId: result.sectionId
            }
          });
        }
      }
    }

    // 无论有没有图谱，都把命中的文档片段作为推荐返回
    if (!graph || recommendations.length === 0) {
      const key = `${result.docId}:${result.sectionId || 'full'}`;
      if (!seen.has(key)) {
        seen.add(key);
        const doc = documents.find(d => (d.meta?.docId || d.docId) === result.docId);
        const section = doc?.sections?.find(s => s.id === result.sectionId);
        const content = section?.content || doc?.rawText || '';
        recommendations.push({
          nodeId: key,
          score: result.score,
          breakdown: result.breakdown,
          content: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
          source: {
            docId: result.docId,
            docName: docNameMap.get(result.docId),
            sectionId: result.sectionId
          }
        });
      }
    }
  }

  // 按分数排序，取 Top-N
  recommendations.sort((a, b) => b.score - a.score);
  return recommendations.slice(0, topN);
}
