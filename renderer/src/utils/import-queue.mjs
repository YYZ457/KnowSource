/** @module utils/import-queue
 *  导入任务队列工具：支持去重指纹、Deferred Promise、任务对象创建
 *  不依赖 Vue/Pinia，可在 Node 测试环境中直接运行。
 */

/** 计算字符串的快速哈希（djb2 变体） */
export function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/** 生成唯一任务 ID */
export function generateTaskId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 计算文件指纹，用于去重。
 * 组合文件名、内容长度与内容哈希，兼顾精度与性能。
 * @param {string} name 文件名
 * @param {string} content 文件内容（文本或 base64）
 * @param {string} [type] 文件类型
 * @returns {string}
 */
export function computeFingerprint(name, content, type = '') {
  const str = String(content || '');
  return `${name}:${str.length}:${quickHash(str)}:${type}`;
}

/** 创建一个 Deferred Promise */
export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 创建一个新的导入任务对象。
 * @param {string} name 文件名
 * @param {string} content 文件内容
 * @param {string} type 文件类型
 * @returns {object}
 */
export function createImportTask(name, content, type) {
  return {
    id: generateTaskId(),
    name,
    content,
    size: String(content || '').length,
    type: type || 'text',
    fingerprint: computeFingerprint(name, content, type),
    status: 'queued', // queued | parsing | done | error | cancelled
    progress: {
      status: 'idle',
      stage: '',
      percent: 0,
      log: '',
      currentPage: 0,
      totalPages: 0,
      previewText: ''
    },
    error: null,
    retryable: false,
    result: null
  };
}

/**
 * 判断任务是否处于可去重状态（queued / parsing / done 视为同一文件正在处理）。
 * @param {object} task
 * @returns {boolean}
 */
export function isTaskDeduplicable(task) {
  return ['queued', 'parsing', 'done'].includes(task.status);
}

/**
 * 根据指纹查找当前队列中的可去重任务。
 * @param {object[]} tasks 任务列表
 * @param {string} fingerprint
 * @returns {object|undefined}
 */
export function findDuplicateTask(tasks, fingerprint) {
  return tasks.find(t => t.fingerprint === fingerprint && isTaskDeduplicable(t));
}
