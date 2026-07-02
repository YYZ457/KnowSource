/**
 * @module services/api/handlers/prompts
 * 职责：提示词自定义与 LLM 调用日志的 API handler
 */
import { getTaskList, getTask, getDefaultPrompts, getUserOverrides, getDisabledTaskIds, resolvePrompt, hasUserOverride } from '../../../core/prompts/registry.js';
import { getRecent, getLogCount, logCall } from '../../../core/prompts/logger.js';
import { applyOverride, applyReset, applyResetAll, applyDisabledTasks, loadPromptOverrides } from '../../prompt-store.js';
import { getKGProvider } from '../../llm-provider.js';

/**
 * GET /settings/prompts
 * 返回全部任务元数据 + 已捕获的默认提示词 + 用户覆盖 + 禁用列表
 */
export function getPromptsHandler() {
  return {
    success: true,
    tasks: getTaskList(),
    defaults: getDefaultPrompts(),
    overrides: getUserOverrides(),
    disabled: getDisabledTaskIds()
  };
}

/**
 * POST /settings/prompts
 * 设置单个任务的提示词覆盖
 * body: { taskId, system?, user? }
 */
export function setPromptHandler({ taskId, system, user } = {}) {
  if (!taskId || !getTask(taskId)) {
    return { success: false, error: `未知的任务标识: ${taskId}` };
  }
  const override = {};
  if (typeof system === 'string') override.system = system;
  if (typeof user === 'string') override.user = user;
  if (Object.keys(override).length === 0) {
    return { success: false, error: '必须提供 system 或 user 字段' };
  }
  applyOverride(taskId, override);
  return { success: true, taskId };
}

/**
 * POST /settings/prompts/reset
 * 重置单个或全部任务的提示词覆盖
 * body: { taskId? }  不传 taskId 则重置全部
 */
export function resetPromptHandler({ taskId } = {}) {
  if (taskId) {
    if (!getTask(taskId)) {
      return { success: false, error: `未知的任务标识: ${taskId}` };
    }
    applyReset(taskId);
  } else {
    applyResetAll();
  }
  return { success: true };
}

/**
 * POST /settings/prompts/disabled
 * 设置被禁用的任务列表
 * body: { ids: string[] }
 */
export function setDisabledHandler({ ids } = {}) {
  if (!Array.isArray(ids)) {
    return { success: false, error: 'ids 必须是字符串数组' };
  }
  applyDisabledTasks(ids);
  return { success: true, disabled: ids };
}

/**
 * GET /settings/llm-log
 * 返回最近的 LLM 调用日志
 * query: limit
 */
export function getLLMLogHandler({ limit } = {}) {
  const n = Math.min(parseInt(limit, 10) || 50, 200);
  return {
    success: true,
    entries: getRecent(n),
    total: getLogCount()
  };
}

/**
 * POST /settings/prompts/test
 * 用当前有效模板（用户自定义优先，否则内置）渲染变量后调用 LLM
 * body: { taskId, vars }
 * 返回：渲染后的 system/user 提示词 + LLM 响应；同时写入调用日志，便于在日志区查看
 */
export async function testPromptHandler({ taskId, vars } = {}) {
  if (!taskId || !getTask(taskId)) {
    return { success: false, error: `未知的任务标识: ${taskId}` };
  }

  const taskMeta = getTask(taskId);
  const taskName = taskMeta?.name || taskId;
  const overridden = hasUserOverride(taskId);

  // 从注册表解析提示词：取有效模板（用户自定义优先），用 vars 渲染占位符
  const { system: renderedSystem, user: renderedUser } = resolvePrompt(taskId, { vars: vars || {} });

  // 使用当前已配置的 KG provider 进行测试
  const provider = getKGProvider();
  if (!provider || provider.name === 'stub') {
    // 记录一条"未配置 provider"的失败日志，便于用户理解为何测试未执行
    logCall({
      taskId,
      taskName,
      system: renderedSystem,
      user: renderedUser,
      response: '',
      durationMs: 0,
      success: false,
      error: '未配置可用的 LLM provider（stub 模式）',
      overridden,
      timestamp: new Date().toISOString()
    });
    return {
      success: false,
      error: '当前未配置可用的 LLM provider（stub 模式无法测试）。请先在"图谱配置"中配置模型。',
      renderedSystem,
      renderedUser
    };
  }

  const start = Date.now();
  try {
    const response = await provider.complete(renderedUser, {
      system: renderedSystem || undefined,
      timeoutMs: 60000,
      maxTokens: 2048
    });
    const responseStr = typeof response === 'string' ? response.slice(0, 8000) : String(response);
    const durationMs = Date.now() - start;
    // 写入日志：测试调用同样需要留痕，用户可在"调用日志"区看到渲染后的提示词
    logCall({
      taskId,
      taskName,
      system: renderedSystem,
      user: renderedUser,
      response: responseStr,
      durationMs,
      success: true,
      overridden,
      timestamp: new Date().toISOString()
    });
    return {
      success: true,
      response: responseStr,
      durationMs,
      provider: provider.name,
      model: provider.model || '',
      renderedSystem,
      renderedUser
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    logCall({
      taskId,
      taskName,
      system: renderedSystem,
      user: renderedUser,
      response: '',
      durationMs,
      success: false,
      error: e.message,
      overridden,
      timestamp: new Date().toISOString()
    });
    return {
      success: false,
      error: e.message,
      durationMs,
      provider: provider.name,
      renderedSystem,
      renderedUser
    };
  }
}

/** 启动时加载持久化的提示词覆盖 */
export function initPromptStore() {
  loadPromptOverrides();
}
