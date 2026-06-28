/** @module utils/validation
 *  职责：前端通用校验逻辑，避免在前后端重复定义相同规则。
 *  后端（services/api/handlers/projects.js）保留各自的校验实现，
 *  因为后端不能导入前端模块；前端统一从此模块导入使用。
 */

/**
 * 校验项目名称
 * 规则：
 * 1. 不能为空（仅空白也算空）
 * 2. 长度不能超过 50 个字符
 * 3. 不能包含文件系统特殊字符 < > : " / \ | ? *
 * @param {string} name - 项目名称
 * @returns {string|null} 错误消息，null 表示校验通过
 */
export function validateProjectName(name) {
  if (!name || !name.trim()) return '名称不能为空';
  if (name.length > 50) return '名称不能超过50个字符';
  if (/[<>:"/\\|?*]/.test(name)) return '名称不能包含特殊字符 < > : " / \\ | ? *';
  return null;
}
