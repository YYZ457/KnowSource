/**
 * @module core/prompts/run-task
 * 职责：统一的 LLM 任务执行入口，封装模板渲染 + 任务禁用判断 + 调用日志记录
 *
 * 用法：将各 core 模块中的 provider.complete(prompt, opts) 替换为
 *       runLLMTask(provider, taskId, opts)
 * opts 中通过 _vars 传入模板变量字典，用于渲染 {{var}} 占位符。
 * 模板定义在 templates.js 中，用户可在 PromptLab 中直接编辑。
 */
import { resolvePrompt, isDisabled, getTask, hasUserOverride } from './registry.js';
import { logCall } from './logger.js';

/**
 * 执行一次 LLM 任务
 * @param {Object} provider - LLM provider 实例（需有 complete 方法）
 * @param {string} taskId - 任务标识（对应 registry TASKS 中的 id）
 * @param {Object} [options={}] - provider 选项，额外支持 _vars
 * @param {Object} [options._vars] - 模板变量字典，用于渲染 {{var}} 占位符
 * @returns {Promise<string>} LLM 响应文本
 * @throws {{code: 'TASK_DISABLED', taskId: string, message: string}}
 *   当任务被用户禁用时抛出，调用方应 catch 并走回退逻辑。
 * @throws {Error} 当 provider.complete 调用失败时透传原始错误。
 */
export async function runLLMTask(provider, taskId, options = {}) {
  const task = getTask(taskId);
  const taskName = task?.name || taskId;
  const vars = options._vars || {};

  // 任务被用户禁用：抛出特殊错误，由调用方的 catch 块走回退逻辑
  if (isDisabled(taskId)) {
    const err = new Error(`任务「${taskName}」已被禁用，跳过 LLM 调用`);
    err.code = 'TASK_DISABLED';
    err.taskId = taskId;
    logCall({
      taskId, taskName, system: '', user: '',
      response: '', durationMs: 0, success: false,
      error: err.message, disabled: true, overridden: false,
      timestamp: new Date().toISOString()
    });
    throw err;
  }

  // 从注册表解析提示词（用户自定义模板优先，否则内置模板），用 vars 渲染占位符
  const { system: resolvedSystem, user: resolvedUser } = resolvePrompt(taskId, { vars });
  const hasOverride = hasUserOverride(taskId);

  // 剥离内部使用的字段，不传给 provider
  const providerOpts = { ...options };
  delete providerOpts._vars;
  if (resolvedSystem) providerOpts.system = resolvedSystem;
  else delete providerOpts.system;

  const start = Date.now();
  const entry = {
    taskId, taskName,
    system: resolvedSystem || '',
    user: resolvedUser,
    response: '',
    durationMs: 0,
    success: false,
    overridden: hasOverride,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await provider.complete(resolvedUser, providerOpts);
    entry.response = typeof response === 'string' ? response.slice(0, 4000) : String(response ?? '');
    entry.success = true;
    return response;
  } catch (e) {
    entry.error = e.message;
    throw e;
  } finally {
    entry.durationMs = Date.now() - start;
    logCall(entry);
  }
}
