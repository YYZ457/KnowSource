/** @module core/graph/edge
 *  职责：图谱边数据模型
 */

// 无向边类型集合：单一数据源，供 graph.js / unsupervised.js 等复用，避免多处定义导致不一致
export const UNDIRECTED_TYPES = new Set(['similar', 'related', 'cross-link', 'co-occurrence', 'semantic', 'relates', 'also-known-as']);

export class GraphEdge {
  /**
   * @param {Object} opts
   * @param {string} opts.from
   * @param {string} opts.to
   * @param {'cite'|'similar'|'derive'|'belong'} opts.type
   * @param {number} [opts.weight=1]
   * @param {{docId?:string, sectionId?:string, score?:number}} [opts.evidence]
   * @param {string} [opts.source] — 边来源标记（如 'full-extract'、'kg'、'doc-tree'），用于审计/调试
   */
  constructor({ from, to, type, weight = 1, evidence, source }) {
    this.from = from;
    this.to = to;
    this.type = type;
    this.weight = weight;
    this.evidence = evidence || {};
    this.source = source || null;
  }

  /** 边的唯一键（用于去重） */
  key() {
    // 无向边类型：from/to 排序以保证双向去重；有向边保持顺序
    if (UNDIRECTED_TYPES.has(this.type)) {
      const [a, b] = [this.from, this.to].sort();
      return `${a}|${b}|${this.type}`;
    }
    return `${this.from}|${this.to}|${this.type}`;
  }

  toJSON() {
    const result = { from: this.from, to: this.to, type: this.type, weight: this.weight, evidence: this.evidence };
    if (this.source) result.source = this.source;
    return result;
  }

  static fromJSON(obj) {
    return new GraphEdge(obj);
  }
}
