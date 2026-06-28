/** @module core/types
 *  职责：定义全系统共享的数据契约（JSDoc 类型声明）
 *  说明：这些类型用 JSDoc @typedef 定义，供 IDE 智能提示与文档生成
 */

/**
 * 文档类型枚举
 * @typedef {'pdf'|'markdown'|'text'|'code'} DocumentType
 */

/**
 * 文档元数据
 * @typedef {Object} DocumentMeta
 * @property {string} docId — 全局唯一文档 ID（如 'doc-7f3a'）
 * @property {DocumentType} type — 文档类型
 * @property {string} name — 文件名
 * @property {string} path — 来源路径
 * @property {number} size — 文件大小（字节）
 * @property {number} mtime — 修改时间戳
 * @property {number} parsedAt — 解析时间戳
 * @property {number} [totalPages] — PDF 页数
 * @property {boolean} [isScanned] — 是否扫描版 PDF
 */

/**
 * 文档章节
 * @typedef {Object} Section
 * @property {string} id — 章节 ID（如 'ch1-1'）
 * @property {string} title — 章节标题
 * @property {string} content — 章节正文
 * @property {{word:string, count:number, isTerm?:boolean}[]} keywords — 关键词列表
 * @property {{page:number, offset?:number}} [location] — 在原文档中的位置
 */

/**
 * 文档（解析后）
 * @typedef {Object} Document
 * @property {DocumentMeta} meta — 元数据
 * @property {Section[]} sections — 章节列表
 * @property {string} rawText — 原始全文
 * @property {{page:number, dataUrl:string, width:number, height:number}[]} [images] — 提取的图片
 */

/**
 * 抽取的实体/概念
 * @typedef {Object} Entity
 * @property {string} term — 术语
 * @property {number} score — 权重/重要性分数
 * @property {'tfidf'|'textrank'|'llm'|'manual'} source — 抽取来源
 * @property {string} [docId] — 来源文档
 * @property {string} [sectionId] — 来源章节
 */

/**
 * 图谱节点
 * @typedef {Object} GraphNode
 * @property {string} id — 节点 ID
 * @property {'concept'|'document'|'idea'} type — 节点类型
 * @property {string} content — 节点内容（术语/标题/Idea 标题）
 * @property {{docId:string, sectionId?:string, location?:Object}} source — 来源
 * @property {number[]} [embedding] — 向量表示
 * @property {number} weight — 权重（重要性）
 * @property {string[]} [aliases] — 别名（概念合并后）
 * @property {Object} [meta] — 扩展元数据
 */

/**
 * 图谱边
 * @typedef {Object} GraphEdge
 * @property {string} from — 起点节点 ID
 * @property {string} to — 终点节点 ID
 * @property {'cite'|'similar'|'derive'|'belong'} type — 边类型（引用/相似/推导/属于）
 * @property {number} weight — 权重（0-1）
 * @property {{docId?:string, sectionId?:string, score?:number}} [evidence] — 证据
 */

/**
 * Idea（思路/想法）
 * @typedef {Object} Idea
 * @property {string} id — Idea ID
 * @property {string} title — 标题
 * @property {string} content — 内容
 * @property {string[]} relatedNodes — 关联的图谱节点 ID
 * @property {{docId:string, location?:Object}[]} references — 文献引用
 * @property {{toIdeaId:string, type:'derive'|'contrast'|'support'}[]} relations — 与其他 Idea 的关系
 * @property {number} createdAt — 创建时间戳
 * @property {number} updatedAt — 更新时间戳
 */

/**
 * 匹配结果
 * @typedef {Object} MatchResult
 * @property {string} docId — 命中文档
 * @property {string} sectionId — 命中章节
 * @property {number} score — 总分（0-1）
 * @property {{tfidf?:number, semantic?:number, graph?:number}} breakdown — 各层分数
 * @property {string[]} [matchedKeywords] — 命中关键词
 */

/**
 * 管线阶段
 * @typedef {'import'|'parse'|'extract'|'buildGraph'|'crossLink'|'queryable'} PipelineStage
 */

/**
 * 管线进度
 * @typedef {Object} PipelineProgress
 * @property {PipelineStage} stage — 当前阶段
 * @property {number} percent — 进度百分比（0-100）
 * @property {string} log — 日志消息
 */

export default {};
