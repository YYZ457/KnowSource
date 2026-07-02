/** @module core/idea
 *  职责：Idea 数据模型 + 图谱联动 + 自动推荐
 */
export { Idea } from './model.js';
export { linkIdeaToGraph, linkIdeaRelation, unlinkIdeaFromGraph } from './linkage.js';
export { recommendNodes } from './recommend.js';
