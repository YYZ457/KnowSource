/**
 * @module core/prompts/logger
 * 职责：LLM 调用日志环形缓冲区，记录每次调用的任务、提示词、响应、耗时与状态
 *
 * 属于 core 层，无外部依赖。供 services 层读取展示给前端。
 */

/** @type {Array<Object>} 环形缓冲区 */
let buffer = [];

/** 最大保留条数 */
const MAX_ENTRIES = 200;

/**
 * 记录一次 LLM 调用
 * @param {Object} entry
 * @param {string} entry.taskId
 * @param {string} entry.taskName
 * @param {string} entry.system
 * @param {string} entry.user
 * @param {string} [entry.response]
 * @param {number} entry.durationMs
 * @param {boolean} entry.success
 * @param {string} [entry.error]
 * @param {string} [entry.fallbackReason]
 * @param {string} entry.timestamp
 * @param {boolean} [entry.disabled]
 * @param {boolean} [entry.overridden]
 */
export function logCall(entry) {
  buffer.push({ ...entry });
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(-MAX_ENTRIES);
  }
}

/**
 * 获取最近的调用记录（按时间倒序）
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
export function getRecent(limit = 50) {
  const n = Math.min(limit, buffer.length);
  // 注意：slice(-0) 等价于 slice(0) 会返回整个数组，因此 n<=0 时必须显式返回空数组
  if (n <= 0) return [];
  return buffer.slice(-n).reverse();
}

/** 清空日志 */
export function clearLog() {
  buffer = [];
}

/** 获取日志总条数 */
export function getLogCount() {
  return buffer.length;
}
