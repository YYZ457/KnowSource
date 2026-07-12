/**
 * @module services/prompt-store
 * 职责：用户提示词覆盖与任务禁用列表的持久化（全局，不按项目隔离）
 *
 * 存储位置：DATA_DIR/prompt-overrides.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './storage.js';
import {
  setUserOverrides, getUserOverrides, setUserOverride, resetUserOverride, resetAllOverrides,
  setDisabledTasks, getDisabledTaskIds
} from '../core/prompts/registry.js';

const PROMPTS_FILE = join(DATA_DIR, 'prompt-overrides.json');

/**
 * 从磁盘加载用户覆盖与禁用列表，并应用到注册表
 */
export function loadPromptOverrides() {
  try {
    if (!existsSync(PROMPTS_FILE)) return;
    const raw = readFileSync(PROMPTS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // 修复：校验 overrides 类型，防止非对象类型写入注册表
    if (data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)) {
      setUserOverrides(data.overrides);
    }
    if (Array.isArray(data.disabled)) setDisabledTasks(data.disabled);
    console.log(`[prompt-store] 已加载提示词覆盖: ${Object.keys(data.overrides || {}).length} 项, 禁用任务: ${(data.disabled || []).length} 项`);
  } catch (e) {
    console.warn('[prompt-store] 加载提示词覆盖失败:', e.message);
    // 修复：备份损坏文件，避免每次启动都尝试解析失败
    try {
      if (existsSync(PROMPTS_FILE)) {
        const bakPath = `${PROMPTS_FILE}.bak`;
        copyFileSync(PROMPTS_FILE, bakPath);
        console.warn(`[prompt-store] 已备份损坏文件至 ${bakPath}`);
      }
    } catch {}
  }
}

/**
 * 将当前注册表中的覆盖与禁用列表持久化到磁盘
 * 修复：改用原子写入（临时文件 + rename），避免写入中途崩溃导致文件损坏
 */
export function savePromptOverrides() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      overrides: getUserOverrides(),
      disabled: getDisabledTaskIds(),
      updatedAt: new Date().toISOString()
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const tmpFile = `${PROMPTS_FILE}.tmp.${Date.now()}`;
    writeFileSync(tmpFile, jsonStr, 'utf-8');
    renameSync(tmpFile, PROMPTS_FILE); // 原子重命名
  } catch (e) {
    console.warn('[prompt-store] 保存提示词覆盖失败:', e.message);
  }
}

/**
 * 设置单个任务覆盖并持久化
 * @param {string} taskId
 * @param {{system?:string, user?:string}} override
 */
export function applyOverride(taskId, override) {
  setUserOverride(taskId, override);
  savePromptOverrides();
}

/**
 * 重置单个任务覆盖并持久化
 */
export function applyReset(taskId) {
  resetUserOverride(taskId);
  savePromptOverrides();
}

/**
 * 重置全部覆盖并持久化
 */
export function applyResetAll() {
  resetAllOverrides();
  savePromptOverrides();
}

/**
 * 设置禁用任务列表并持久化
 * @param {string[]} ids
 */
export function applyDisabledTasks(ids) {
  setDisabledTasks(ids);
  savePromptOverrides();
}
