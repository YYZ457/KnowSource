/** @module core/graph
 *  职责：知识图谱构建与查询（Node/Edge/Graph + 合并 + 跨链 + 查询）
 */
export { GraphNode } from './node.js';
export { GraphEdge } from './edge.js';
export { KnowledgeGraph } from './graph.js';
export { mergeConcepts } from './merge.js';
export { buildCrossLinks, buildCrossLinksLLM } from './crosslink.js';
export { getNeighbors, findPath, searchByContent } from './query.js';
export { generateKnowledgeGraph } from './builder.js';
