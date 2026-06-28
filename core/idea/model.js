/** @module core/idea/model
 *  职责：Idea 数据模型
 */

let ideaIdCounter = 0;

export class Idea {
  /**
   * @param {Object} opts
   * @param {string} [opts.id] — Idea ID（不传则自动生成）
   * @param {string} opts.title — 标题
   * @param {string} opts.content — 内容
   * @param {string[]} [opts.relatedNodes=[]] — 关联图谱节点 ID
   * @param {{docId:string, location?:Object}[]} [opts.references=[]] — 文献引用
   * @param {{toIdeaId:string, type:'derive'|'contrast'|'support'}[]} [opts.relations=[]] — 与其他 Idea 的关系
   * @param {string} [opts.folder=''] — 所属文件夹路径，如 "数学/概率论"
   * @param {boolean} [opts.includeInGraph=true] — 是否加入知识图谱构图
   * @param {string} [opts.color] — 节点颜色（留空则自动分配）
   * @param {number} [opts.createdAt] — 创建时间戳
   * @param {number} [opts.updatedAt] — 更新时间戳
   */
  constructor({ id, title, content, relatedNodes = [], references = [], relations = [], folder = '', includeInGraph = true, color, createdAt, updatedAt } = {}) {
    this.id = id || `idea-${Date.now().toString(36)}-${(ideaIdCounter++).toString(36)}`;
    this.title = title || '';
    this.content = content || '';
    this.relatedNodes = relatedNodes;
    this.references = references;
    this.relations = relations;
    this.folder = folder || '';
    this.includeInGraph = includeInGraph !== false;
    this.color = color || '';
    this.createdAt = createdAt || Date.now();
    this.updatedAt = updatedAt || Date.now();
  }

  /** 添加关联节点 */
  addRelatedNode(nodeId) {
    if (!this.relatedNodes.includes(nodeId)) {
      this.relatedNodes.push(nodeId);
      this.updatedAt = Date.now();
    }
  }

  /** 移除关联节点 */
  removeRelatedNode(nodeId) {
    this.relatedNodes = this.relatedNodes.filter(id => id !== nodeId);
    this.updatedAt = Date.now();
  }

  /** 添加文献引用 */
  addReference(docId, location = null) {
    this.references.push({ docId, location });
    this.updatedAt = Date.now();
  }

  /** 添加与其他 Idea 的关系 */
  addRelation(toIdeaId, type) {
    // 移除已存在的同向关系
    this.relations = this.relations.filter(r => !(r.toIdeaId === toIdeaId && r.type === type));
    this.relations.push({ toIdeaId, type });
    this.updatedAt = Date.now();
  }

  /** 更新内容 */
  update({ title, content, folder, includeInGraph, color } = {}) {
    if (title !== undefined) this.title = title;
    if (content !== undefined) this.content = content;
    if (folder !== undefined) this.folder = folder;
    if (includeInGraph !== undefined) this.includeInGraph = includeInGraph;
    if (color !== undefined) this.color = color;
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      content: this.content,
      relatedNodes: this.relatedNodes,
      references: this.references,
      relations: this.relations,
      folder: this.folder,
      includeInGraph: this.includeInGraph,
      color: this.color,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromJSON(obj) {
    return new Idea(obj);
  }
}
