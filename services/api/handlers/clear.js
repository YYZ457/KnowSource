/** @module services/api/handlers/clear
 *  清空所有数据（文档、图谱、Idea）
 */
import { randomUUID } from 'node:crypto';
import { storage } from '../../storage.js';
import { resetStorageWriteError } from '../../storage.js';
import { terminateOcrWorker } from '../../../core/parser/index.js';

// 清空操作的二次确认令牌，存储在内存中。
// 服务端启动时生成，每次成功清空后轮换，防止重放攻击和一键误清空。
let clearConfirmToken = null;

function generateClearToken() {
  return randomUUID();
}

/** 初始化或重新生成确认令牌 */
export function initClearToken() {
  clearConfirmToken = generateClearToken();
  return clearConfirmToken;
}

/** 获取当前确认令牌（供 GET /clear-token 使用） */
export function getClearToken() {
  return clearConfirmToken;
}

/** 轮换确认令牌 */
export function rotateClearToken() {
  clearConfirmToken = generateClearToken();
  return clearConfirmToken;
}

// 模块加载时即初始化令牌（此时 storage 已完成顶层 await 初始化）
initClearToken();

/**
 * 清空全部数据
 * @param {{ confirmToken?: string }} params
 * @returns {{ success: true, newToken: string } | { status: number, error: string }}
 */
export function clearAll({ confirmToken } = {}) {
  // 1. 二次确认令牌校验
  if (confirmToken !== clearConfirmToken) {
    return { status: 403, error: '确认令牌无效或已过期，请重新获取后再试' };
  }

  // 2. 任务运行状态检查（构建中 / 解析中 / 暂停中均禁止清空，避免任务完成后覆盖清空结果）
  if (storage.building) {
    return { status: 409, error: '有任务正在运行，无法清空' };
  }
  if (storage.taskProgress.status === 'running' || storage.taskProgress.status === 'paused') {
    return { status: 409, error: '有任务正在运行，无法清空' };
  }

  // 3. 清空核心数据
  storage.documents.clear();
  storage.ideas.clear();
  // 复用已有的 Proxy watcher，不要直接替换 storage.graph 引用
  const g = storage.graph;
  g.nodes = [];
  g.edges = [];
  g.stats = {};

  // 4. 重置相关运行状态和错误标记
  storage.taskProgress = { taskId: null, status: 'idle', stage: '', percent: 0, log: '' };
  storage.building = false;
  resetStorageWriteError();

  // 5. 清理 OCR worker，避免残留进程占用资源
  try { terminateOcrWorker(); } catch {}

  // 6. 成功清空后轮换令牌，防止重放攻击
  const newToken = rotateClearToken();
  return { success: true, newToken };
}
