/**
 * services/api/handlers/prompts 单元测试
 *
 * 覆盖：提示词自定义 / 任务禁用 / LLM 调用日志 的 API handler
 * - getPromptsHandler / setPromptHandler / resetPromptHandler
 * - setDisabledHandler / getLLMLogHandler / testPromptHandler
 *
 * 注意：handler 通过 prompt-store 写盘，故在导入前将 KNOWLEDGE_IDE_DATA_DIR 指向临时目录，
 * 避免污染用户真实数据；测试结束后清理。
 */
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

let handlers;
let registry;
let logger;
let llmProvider;
let tmpDir;

before(async () => {
  // 在导入 storage 依赖模块前，把数据目录指向临时目录
  tmpDir = mkdtempSync(join(tmpdir(), 'prompts-handler-test-'));
  process.env.KNOWLEDGE_IDE_DATA_DIR = tmpDir;
  process.env.KNOWLEDGE_IDE_NO_PERSIST = '1';

  handlers = await import('../services/api/handlers/prompts.js');
  registry = await import('../core/prompts/registry.js');
  logger = await import('../core/prompts/logger.js');
  llmProvider = await import('../services/llm-provider.js');
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  registry.resetAllOverrides();
  registry.setDisabledTasks([]);
  logger.clearLog();
});

describe('getPromptsHandler', () => {
  test('返回任务列表 + 默认/覆盖/禁用状态', () => {
    const result = handlers.getPromptsHandler();
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.tasks), 'tasks 应为数组');
    assert.ok(result.tasks.length > 0, '应至少有一个任务');
    assert.ok(typeof result.defaults === 'object', 'defaults 应为对象');
    assert.ok(typeof result.overrides === 'object', 'overrides 应为对象');
    assert.ok(Array.isArray(result.disabled), 'disabled 应为数组');
  });

  test('tasks 每项包含 id/name/variables 等字段', () => {
    const { tasks } = handlers.getPromptsHandler();
    const t = tasks[0];
    assert.ok(t.id);
    assert.ok(t.name);
    assert.ok(t.category);
    assert.ok(Array.isArray(t.variables));
  });

  test('设置覆盖后 getPromptsHandler 反映覆盖', () => {
    handlers.setPromptHandler({ taskId: 'doc-type-detect', user: '自定义用户提示词' });
    const result = handlers.getPromptsHandler();
    assert.ok(result.overrides['doc-type-detect'], '应包含刚设置的覆盖');
    assert.equal(result.overrides['doc-type-detect'].user, '自定义用户提示词');
  });

  test('设置禁用后 getPromptsHandler 反映禁用列表', () => {
    handlers.setDisabledHandler({ ids: ['doc-type-detect', 'cloud-term-extract'] });
    const result = handlers.getPromptsHandler();
    assert.ok(result.disabled.includes('doc-type-detect'));
    assert.ok(result.disabled.includes('cloud-term-extract'));
  });
});

describe('setPromptHandler', () => {
  test('设置 user 覆盖成功', () => {
    const result = handlers.setPromptHandler({ taskId: 'doc-type-detect', user: '新 user' });
    assert.equal(result.success, true);
    assert.equal(result.taskId, 'doc-type-detect');
    assert.ok(registry.hasUserOverride('doc-type-detect'));
  });

  test('设置 system 覆盖成功', () => {
    const result = handlers.setPromptHandler({ taskId: 'cloud-term-extract', system: '新 system' });
    assert.equal(result.success, true);
  });

  test('同时设置 system + user 成功', () => {
    const result = handlers.setPromptHandler({
      taskId: 'term-refine',
      system: 'S',
      user: 'U'
    });
    assert.equal(result.success, true);
  });

  test('未知 taskId 返回错误', () => {
    const result = handlers.setPromptHandler({ taskId: 'not-a-task', user: 'x' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not-a-task'));
  });

  test('缺少 taskId 返回错误', () => {
    const result = handlers.setPromptHandler({ user: 'x' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  test('未提供 system 与 user 返回错误', () => {
    const result = handlers.setPromptHandler({ taskId: 'doc-type-detect' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('system 或 user'));
  });

  test('system/user 非字符串时被忽略，导致无有效字段返回错误', () => {
    const result = handlers.setPromptHandler({ taskId: 'doc-type-detect', system: 123, user: null });
    assert.equal(result.success, false);
  });
});

describe('resetPromptHandler', () => {
  test('重置单个任务覆盖', () => {
    handlers.setPromptHandler({ taskId: 'doc-type-detect', user: 'x' });
    assert.ok(registry.hasUserOverride('doc-type-detect'));
    const result = handlers.resetPromptHandler({ taskId: 'doc-type-detect' });
    assert.equal(result.success, true);
    assert.ok(!registry.hasUserOverride('doc-type-detect'));
  });

  test('不传 taskId 重置全部覆盖', () => {
    handlers.setPromptHandler({ taskId: 'doc-type-detect', user: 'x' });
    handlers.setPromptHandler({ taskId: 'cloud-term-extract', user: 'y' });
    const result = handlers.resetPromptHandler({});
    assert.equal(result.success, true);
    assert.equal(Object.keys(registry.getUserOverrides()).length, 0);
  });

  test('重置未知 taskId 返回错误', () => {
    const result = handlers.resetPromptHandler({ taskId: 'not-a-task' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not-a-task'));
  });
});

describe('setDisabledHandler', () => {
  test('设置禁用列表成功', () => {
    const result = handlers.setDisabledHandler({ ids: ['doc-type-detect'] });
    assert.equal(result.success, true);
    assert.deepEqual(result.disabled, ['doc-type-detect']);
    assert.ok(registry.isDisabled('doc-type-detect'));
  });

  test('空数组清空禁用列表', () => {
    handlers.setDisabledHandler({ ids: ['doc-type-detect'] });
    handlers.setDisabledHandler({ ids: [] });
    assert.equal(registry.getDisabledTaskIds().length, 0);
  });

  test('ids 非数组返回错误', () => {
    const result = handlers.setDisabledHandler({ ids: 'not-array' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('ids'));
  });

  test('缺少 ids 返回错误', () => {
    const result = handlers.setDisabledHandler({});
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

describe('getLLMLogHandler', () => {
  test('默认返回空日志', () => {
    const result = handlers.getLLMLogHandler();
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.entries));
    assert.equal(result.entries.length, 0);
    assert.equal(result.total, 0);
  });

  test('limit 限制返回条数并按倒序', () => {
    // 通过 logger 直接写入若干条
    for (let i = 0; i < 5; i++) {
      logger.logCall({
        taskId: `t-${i}`, taskName: `T${i}`, system: '', user: `u-${i}`,
        response: `r-${i}`, durationMs: i, success: true,
        timestamp: new Date(1700000000000 + i).toISOString()
      });
    }
    const result = handlers.getLLMLogHandler({ limit: 3 });
    assert.equal(result.total, 5);
    assert.equal(result.entries.length, 3);
    assert.equal(result.entries[0].taskId, 't-4', '最新应在首位');
  });

  test('limit 超过 200 被截断为 200', () => {
    const result = handlers.getLLMLogHandler({ limit: 99999 });
    assert.ok(result.entries.length <= 200);
  });

  test('limit 非法时回退默认 50', () => {
    for (let i = 0; i < 60; i++) {
      logger.logCall({
        taskId: `t-${i}`, taskName: 'T', system: '', user: 'u',
        response: '', durationMs: 0, success: true,
        timestamp: new Date().toISOString()
      });
    }
    const result = handlers.getLLMLogHandler({ limit: 'abc' });
    assert.equal(result.entries.length, 50, '非法 limit 应回退为 50');
  });
});

describe('testPromptHandler', () => {
  let originalKGProvider;

  before(() => {
    // 在 before 钩子中捕获原始 provider，此时 llmProvider 模块已完成导入
    originalKGProvider = llmProvider.getKGProvider();
  });

  after(() => {
    llmProvider.setKGProvider(originalKGProvider);
  });

  test('未知 taskId 返回错误', async () => {
    const result = await handlers.testPromptHandler({ taskId: 'not-a-task' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not-a-task'));
  });

  test('stub provider 模式返回不可测试错误', async () => {
    // 默认 KG provider 为 stub
    llmProvider.setKGProvider(llmProvider.createLLMProvider('stub'));
    const result = await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('stub') || result.error.includes('配置'));
  });

  test('配置真实 mock provider 后返回响应', async () => {
    const mockProvider = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      complete: async () => 'LLM 测试响应内容'
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({
      taskId: 'doc-type-detect',
      vars: { sample: '测试文本' }
    });
    assert.equal(result.success, true);
    assert.equal(result.response, 'LLM 测试响应内容');
    assert.ok(result.durationMs >= 0);
    assert.equal(result.provider, 'openai-compatible');
    assert.equal(result.model, 'gpt-4o-mini');
  });

  test('provider 抛错时返回失败但不抛出', async () => {
    const mockProvider = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      complete: async () => { throw new Error('provider 超时'); }
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    assert.equal(result.success, false);
    assert.equal(result.error, 'provider 超时');
    assert.ok(result.durationMs >= 0);
    assert.equal(result.provider, 'openai-compatible');
  });

  test('vars 填充任务变量并渲染模板', async () => {
    let capturedPrompt = '';
    const mockProvider = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      complete: async (prompt) => { capturedPrompt = prompt; return 'ok'; }
    };
    llmProvider.setKGProvider(mockProvider);
    // doc-type-detect 的 variables 为 ['sample']，模板含 {{sample}} 占位符
    const result = await handlers.testPromptHandler({
      taskId: 'doc-type-detect',
      vars: { sample: '这是样本文本' }
    });
    assert.equal(result.success, true);
    assert.ok(capturedPrompt.includes('这是样本文本'), 'vars.sample 应被渲染到 prompt 中');
    assert.ok(!capturedPrompt.includes('{{sample}}'), '占位符应被替换');
  });

  test('成功时返回渲染后的 system/user 提示词', async () => {
    const mockProvider = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      complete: async () => 'ok'
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({
      taskId: 'doc-type-detect',
      vars: { sample: '样例内容XYZ' }
    });
    assert.equal(result.success, true);
    assert.ok(typeof result.renderedUser === 'string', '应返回 renderedUser');
    assert.ok(result.renderedUser.includes('样例内容XYZ'), 'renderedUser 应含渲染后的变量值');
    assert.ok(!result.renderedUser.includes('{{sample}}'), 'renderedUser 不应残留占位符');
  });

  test('失败时仍返回渲染后的提示词', async () => {
    const mockProvider = {
      name: 'openai-compatible',
      model: 'm',
      complete: async () => { throw new Error('boom'); }
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({
      taskId: 'doc-type-detect',
      vars: { sample: '失败场景文本' }
    });
    assert.equal(result.success, false);
    assert.ok(result.renderedUser, '失败时也应返回 renderedUser');
    assert.ok(result.renderedUser.includes('失败场景文本'));
  });

  test('成功调用写入日志', async () => {
    logger.clearLog();
    const mockProvider = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      complete: async () => '日志测试响应'
    };
    llmProvider.setKGProvider(mockProvider);
    await handlers.testPromptHandler({
      taskId: 'doc-type-detect',
      vars: { sample: '日志测试' }
    });
    const entries = logger.getRecent(10);
    assert.equal(entries.length, 1, '应写入一条日志');
    assert.equal(entries[0].taskId, 'doc-type-detect');
    assert.equal(entries[0].success, true);
    assert.equal(entries[0].response, '日志测试响应');
    assert.ok(entries[0].user.includes('日志测试'), '日志中的 user 应为渲染后的提示词');
  });

  test('失败调用也写入日志', async () => {
    logger.clearLog();
    const mockProvider = {
      name: 'openai-compatible',
      model: 'm',
      complete: async () => { throw new Error('网络错误'); }
    };
    llmProvider.setKGProvider(mockProvider);
    await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    const entries = logger.getRecent(10);
    assert.equal(entries.length, 1, '失败也应写入一条日志');
    assert.equal(entries[0].success, false);
    assert.equal(entries[0].error, '网络错误');
  });

  test('stub provider 模式也写入日志', async () => {
    logger.clearLog();
    llmProvider.setKGProvider(llmProvider.createLLMProvider('stub'));
    await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    const entries = logger.getRecent(10);
    assert.equal(entries.length, 1, 'stub 模式也应写入日志');
    assert.equal(entries[0].success, false);
    assert.ok(entries[0].error.includes('stub') || entries[0].error.includes('provider'));
  });

  test('响应超 8000 字符被截断', async () => {
    const longResp = 'A'.repeat(10000);
    const mockProvider = {
      name: 'openai-compatible',
      model: 'm',
      complete: async () => longResp
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    assert.equal(result.success, true);
    assert.equal(result.response.length, 8000, '响应应截断为 8000 字符');
  });

  test('非字符串响应被 String() 归一化', async () => {
    const mockProvider = {
      name: 'openai-compatible',
      model: 'm',
      complete: async () => 42
    };
    llmProvider.setKGProvider(mockProvider);
    const result = await handlers.testPromptHandler({ taskId: 'doc-type-detect', vars: {} });
    assert.equal(result.success, true);
    assert.equal(result.response, '42');
  });
});
