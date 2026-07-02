/** @module core/graph/node
 *  职责：图谱节点数据模型
 */
export class GraphNode {
  /**
   * @param {Object} opts
   * @param {string} opts.id
   * @param {'concept'|'document'|'idea'} opts.type
   * @param {string} opts.content
   * @param {{docId:string, sectionId?:string, location?:Object}} [opts.source]
   * @param {number[]} [opts.embedding]
   * @param {number} [opts.weight=1]
   * @param {string[]} [opts.aliases=[]]
   * @param {Object} [opts.meta={}]
   */
  constructor({ id, type, content, source, embedding, weight = 1, aliases = [], meta = {}, ...rest }) {
    this.id = id;
    this.type = type;
    this.content = content;
    this.source = source || {};
    this.embedding = embedding || null;
    this.weight = weight;
    this.aliases = aliases;
    this.meta = meta;
    // 保留所有自定义字段（label, color, shape, x, y, radius, level 等），
    // 避免序列化/反序列化往返时丢失前端或 Idea 同步写入的扩展属性
    Object.assign(this, rest);
  }

  /** 合并另一个节点的别名与权重 */
  mergeAlias(other) {
    if (other.content && !this.aliases.includes(other.content)) {
      this.aliases.push(other.content);
    }
    for (const alias of other.aliases || []) {
      if (!this.aliases.includes(alias)) this.aliases.push(alias);
    }
    this.weight = Math.max(this.weight, other.weight);
    // 合并 embedding（取平均）
    if (this.embedding && other.embedding && this.embedding.length === other.embedding.length) {
      this.embedding = this.embedding.map((v, i) => (v + other.embedding[i]) / 2);
    } else if (!this.embedding && other.embedding) {
      this.embedding = other.embedding;
    }
  }

  toJSON() {
    // 使用展开运算符保留所有字段（含 label, color, shape, x, y 等自定义字段），
    // 避免 graph-build.js 跨文档关联阶段序列化时丢失扩展属性
    return { ...this };
  }

  static fromJSON(obj) {
    return new GraphNode(obj);
  }
}
