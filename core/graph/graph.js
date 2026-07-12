/** @module core/graph/graph
 *  职责：KnowledgeGraph 容器类，管理节点与边
 */
import { GraphNode } from './node.js';
import { GraphEdge, UNDIRECTED_TYPES } from './edge.js';

export class KnowledgeGraph {
  constructor() {
    /** @type {Map<string, GraphNode>} */
    this.nodes = new Map();
    /** @type {Map<string, GraphEdge>} */
    this.edges = new Map(); // key -> edge
    /**
     * 邻接表缓存：nodeId -> Array<{node, edge, direction}>
     * 懒构建：首次调用 getNeighbors 时构建，任何节点/边变更后置空。
     * 将 getNeighbors 从 O(E)（遍历全量边）降为 O(度数)（仅遍历该节点邻居）。
     * 对 PPR / BFS / 路径搜索等高频调用场景显著提升性能。
     * @type {Map<string, Array<{node:GraphNode, edge:GraphEdge, direction:string}>|null>}
     */
    this._adjacency = null;
  }

  /** 使邻接表缓存失效（在节点/边变更后调用） */
  _invalidateAdjacency() {
    this._adjacency = null;
  }

  /** 懒构建邻接表缓存：一次 O(V+E) 遍历，后续所有 getNeighbors 复用 */
  _buildAdjacency() {
    const adj = new Map();
    for (const id of this.nodes.keys()) adj.set(id, []);
    for (const edge of this.edges.values()) {
      const isUndirected = UNDIRECTED_TYPES.has(edge.type);
      // 出边：from -> to
      let list = adj.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      if (!list) {
        list = [];
        adj.set(edge.from, list);
      }
      if (toNode) list.push({ node: toNode, edge, direction: 'out' });
      // 无向边：同时把 to -> from 也加入邻接表
      if (isUndirected) {
        let list2 = adj.get(edge.to);
        const fromNode = this.nodes.get(edge.from);
        if (!list2) {
          list2 = [];
          adj.set(edge.to, list2);
        }
        if (fromNode) list2.push({ node: fromNode, edge, direction: 'in' });
      }
    }
    this._adjacency = adj;
  }

  addNode(node) {
    if (!(node instanceof GraphNode)) node = new GraphNode(node);
    this.nodes.set(node.id, node);
    this._invalidateAdjacency();
    return node;
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  removeNode(id) {
    this.nodes.delete(id);
    // 删除关联的边
    for (const [key, edge] of this.edges) {
      if (edge.from === id || edge.to === id) this.edges.delete(key);
    }
    this._invalidateAdjacency();
  }

  addEdge(edge) {
    if (!(edge instanceof GraphEdge)) edge = new GraphEdge(edge);
    const key = edge.key();
    // 去重：相同 key 的边累加权重
    const existing = this.edges.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, edge.weight);
      // 合并 evidence（过滤 undefined 值，避免覆盖已有数据）
      if (edge.evidence) {
        const cleanEvidence = Object.fromEntries(
          Object.entries(edge.evidence).filter(([, v]) => v !== undefined)
        );
        existing.evidence = { ...existing.evidence, ...cleanEvidence };
      }
      // 边在原地更新，邻接表缓存的引用仍指向同一对象，无需失效
      return existing;
    } else {
      this.edges.set(key, edge);
      this._invalidateAdjacency();
      return edge;
    }
  }

  removeEdge(from, to, type) {
    const tmp = new GraphEdge({ from, to, type });
    this.edges.delete(tmp.key());
    this._invalidateAdjacency();
  }

  /** 获取节点的所有邻居（含边信息） */
  getNeighbors(nodeId) {
    // 懒构建 / 复用邻接表缓存，将 O(E) 遍历降为 O(度数) 查找
    if (!this._adjacency) this._buildAdjacency();
    return this._adjacency.get(nodeId) || [];
  }

  /** 序列化为 JSON */
  serialize() {
    return {
      nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
      edges: Array.from(this.edges.values()).map(e => e.toJSON())
    };
  }

  /** 从 JSON 反序列化 */
  static deserialize(data) {
    const g = new KnowledgeGraph();
    for (const n of data.nodes || []) g.addNode(GraphNode.fromJSON(n));
    for (const e of data.edges || []) g.addEdge(GraphEdge.fromJSON(e));
    return g;
  }

  /** 统计信息 */
  stats() {
    return { nodeCount: this.nodes.size, edgeCount: this.edges.size };
  }
}
