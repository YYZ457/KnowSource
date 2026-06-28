/**
 * core/prompts/run-task 单元测试
 *
 * 覆盖关键路径：
 * - 正常调用：prompt 始终从注册表内置模板渲染，返回 provider 响应
 * - TASK_DISABLED 抛出特殊错误并记录禁用日志（核心回退入口）
 * - 用户覆盖应用（system / user / 部分 / vars 渲染）
 * - _vars 剥离（不传给 provider）但用于模板渲染
 * - system 来自注册表模板（不再接受 options.system）
 * - provider 异常时重抛并记录失败日志
 * - 响应超长截断、非字符串响应归一化
 * - 日志 overridden 标志、durationMs 记录
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { runLLMTask } from '../core/prompts/run-task.js';
import {
  setUserOverride,
  resetAllOverrides,
  setDisabledTasks
} from '../core/prompts/registry.js';
import { getRecent, getLogCount, clearLog } from '../core/prompts/logger.js';

beforeEach(() => {
  resetAllOverrides();
  setDisabledTasks([]);
  clearLog();
});

/** 构造一个记录调用参数的 mock provider */
function mockProvider(impl) {
  const calls = [];
  const provider = {
    name: 'mock',
    complete: async (prompt, opts) => {
      calls.push({ prompt, opts });
      if (impl) return impl(prompt, opts);
      return 'mock-response';
    }
  };
  return { provider, calls };
}

describe('runLLMTask 正常调用', () => {
  test('从内置模板渲染 prompt 给 provider 并返回响应', async () => {
    const { provider, calls } = mockProvider();
    const result = await runLLMTask(provider, 'doc-type-detect');
    assert.equal(result, 'mock-response');
    assert.equal(calls.length, 1, 'provider.complete 应被调用一次');
    // calls[0].prompt 是 doc-type-detect 的内置模板（无 vars 时 {{sample}} 保持原样）
    assert.ok(calls[0].prompt.includes('文档分类专家'), '应包含内置模板文本');
    assert.ok(calls[0].prompt.includes('{{sample}}'), '无 vars 时占位符保持原样');
  });

  test('内置模板用 _vars 渲染占位符', async () => {
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'doc-type-detect', {
      _vars: { sample: '这是一段测试文本' }
    });
    assert.ok(calls[0].prompt.includes('这是一段测试文本'), '应使用 vars 渲染 sample');
    assert.ok(!calls[0].prompt.includes('{{sample}}'), '占位符应被替换');
  });

  test('记录成功日志条目', async () => {
    const { provider } = mockProvider(() => 'ok');
    await runLLMTask(provider, 'doc-type-detect');
    assert.equal(getLogCount(), 1, '应记录一条日志');
    const [entry] = getRecent(1);
    assert.equal(entry.taskId, 'doc-type-detect');
    assert.equal(entry.taskName, '文档类型识别');
    assert.equal(entry.success, true);
    assert.equal(entry.response, 'ok');
    assert.equal(entry.system, '', 'doc-type-detect 内置 system 为空');
    assert.ok(entry.user.includes('文档分类专家'), '应记录渲染后的内置 user 模板');
    assert.ok(entry.user.includes('{{sample}}'), '无 vars 时占位符保持原样');
    assert.equal(entry.overridden, false, '无覆盖时 overridden=false');
    assert.ok(entry.durationMs >= 0);
    assert.ok(entry.timestamp);
  });

  test('system 来自注册表内置模板', async () => {
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'specificity-scoring', { temperature: 0.1 });
    assert.equal(
      calls[0].opts.system,
      'You output valid JSON only. No markdown, no reasoning text.',
      'system 应来自内置模板'
    );
    assert.equal(calls[0].opts.temperature, 0.1, '其他选项应保留');
  });

  test('无 system 时 providerOpts.system 不被设置', async () => {
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'doc-type-detect');
    assert.ok(!('system' in calls[0].opts), '内置 system 为空时不应传入 system 字段');
  });

  test('未知 taskId 时 taskName 回退为 taskId', async () => {
    const { provider } = mockProvider();
    await runLLMTask(provider, 'unknown-task-id');
    const [entry] = getRecent(1);
    assert.equal(entry.taskName, 'unknown-task-id');
  });
});

describe('runLLMTask _vars 剥离', () => {
  test('_vars 不传给 provider 但用于渲染模板', async () => {
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'cloud-term-extract', {
      _vars: { domainHint: '物理领域', batchText: '正文内容' },
      temperature: 0.2
    });
    assert.ok(!('_vars' in calls[0].opts), '_vars 应被剥离');
    assert.equal(calls[0].opts.temperature, 0.2, '其他选项应保留');
    assert.ok(calls[0].prompt.includes('物理领域'), '应使用 vars 渲染 domainHint');
    assert.ok(calls[0].prompt.includes('正文内容'), '应使用 vars 渲染 batchText');
    assert.ok(!calls[0].prompt.includes('{{domainHint}}'), '占位符应被替换');
    assert.ok(!calls[0].prompt.includes('{{batchText}}'), '占位符应被替换');
  });
});

describe('runLLMTask 用户覆盖', () => {
  test('完整覆盖：system 与 user 均替换', async () => {
    setUserOverride('doc-type-detect', { system: '覆盖 system', user: '覆盖 user' });
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'doc-type-detect');
    assert.equal(calls[0].prompt, '覆盖 user', '应使用覆盖后的 user');
    assert.equal(calls[0].opts.system, '覆盖 system', '应使用覆盖后的 system');
    const [entry] = getRecent(1);
    assert.equal(entry.overridden, true, '有覆盖时 overridden=true');
    assert.equal(entry.system, '覆盖 system');
    assert.equal(entry.user, '覆盖 user');
  });

  test('部分覆盖：仅覆盖 user，system 保留内置', async () => {
    setUserOverride('specificity-scoring', { user: '新 user' });
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'specificity-scoring');
    assert.equal(calls[0].prompt, '新 user');
    assert.equal(
      calls[0].opts.system,
      'You output valid JSON only. No markdown, no reasoning text.',
      'system 未覆盖应保留内置'
    );
  });

  test('部分覆盖：仅覆盖 system，user 保留内置', async () => {
    setUserOverride('specificity-scoring', { system: '新 system' });
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'specificity-scoring');
    assert.ok(calls[0].prompt.includes('候选术语'), 'user 未覆盖应保留内置模板文本');
    assert.equal(calls[0].opts.system, '新 system');
  });

  test('覆盖模板用 _vars 渲染', async () => {
    setUserOverride('cloud-term-extract', { user: '类型={{docType}} 提示={{domainHint}}' });
    const { provider, calls } = mockProvider();
    await runLLMTask(provider, 'cloud-term-extract', {
      _vars: { docType: '教材', domainHint: '物理' }
    });
    assert.equal(calls[0].prompt, '类型=教材 提示=物理');
  });
});

describe('runLLMTask TASK_DISABLED 禁用回退入口', () => {
  test('禁用任务抛出 code=TASK_DISABLED 错误', async () => {
    setDisabledTasks(['doc-type-detect']);
    const { provider, calls } = mockProvider();
    await assert.rejects(
      runLLMTask(provider, 'doc-type-detect'),
      (err) => {
        assert.equal(err.code, 'TASK_DISABLED');
        assert.equal(err.taskId, 'doc-type-detect');
        assert.ok(err.message.includes('已被禁用'));
        return true;
      }
    );
    assert.equal(calls.length, 0, '禁用任务不应调用 provider');
  });

  test('禁用任务记录 disabled 日志条目', async () => {
    setDisabledTasks(['doc-type-detect']);
    const { provider } = mockProvider();
    await assert.rejects(runLLMTask(provider, 'doc-type-detect'));
    assert.equal(getLogCount(), 1, '禁用也应记录一条日志');
    const [entry] = getRecent(1);
    assert.equal(entry.taskId, 'doc-type-detect');
    assert.equal(entry.success, false);
    assert.equal(entry.disabled, true);
    assert.equal(entry.overridden, false);
    assert.equal(entry.durationMs, 0, '禁用任务 durationMs 应为 0');
    assert.equal(entry.response, '', '禁用任务 response 应为空');
    assert.equal(entry.system, '', '禁用任务 system 为空');
    assert.equal(entry.user, '', '禁用任务 user 为空');
    assert.ok(entry.error.includes('已被禁用'));
  });

  test('未禁用任务正常执行', async () => {
    setDisabledTasks(['cloud-term-extract']); // 禁用另一个任务
    const { provider, calls } = mockProvider(() => 'ok');
    const result = await runLLMTask(provider, 'doc-type-detect');
    assert.equal(result, 'ok');
    assert.equal(calls.length, 1);
  });
});

describe('runLLMTask provider 异常路径', () => {
  test('provider 抛错时重抛并记录失败日志', async () => {
    const provider = {
      name: 'mock',
      complete: async () => { throw new Error('provider 网络超时'); }
    };
    await assert.rejects(
      runLLMTask(provider, 'doc-type-detect'),
      /provider 网络超时/
    );
    assert.equal(getLogCount(), 1);
    const [entry] = getRecent(1);
    assert.equal(entry.success, false);
    assert.equal(entry.error, 'provider 网络超时');
    assert.ok(entry.durationMs >= 0, '失败也应记录耗时');
    assert.equal(entry.response, '', '失败时 response 应为空');
  });

  test('provider 抛非 Error 对象时仍记录 message', async () => {
    const provider = {
      name: 'mock',
      complete: async () => { throw 'string-error'; } // 非 Error
    };
    await assert.rejects(
      runLLMTask(provider, 'doc-type-detect'),
      (err) => err === 'string-error'
    );
    const [entry] = getRecent(1);
    assert.equal(entry.success, false);
  });

  test('provider 成功后即使返回值特殊也记录成功', async () => {
    const { provider } = mockProvider(() => '');
    const result = await runLLMTask(provider, 'doc-type-detect');
    assert.equal(result, '');
    const [entry] = getRecent(1);
    assert.equal(entry.success, true);
    assert.equal(entry.response, '');
  });
});

describe('runLLMTask 响应归一化与截断', () => {
  test('超长响应在日志中截断为 4000 字符，但返回值保留完整', async () => {
    const longResp = 'A'.repeat(5000);
    const { provider } = mockProvider(() => longResp);
    const result = await runLLMTask(provider, 'doc-type-detect');
    assert.equal(result.length, 5000, '返回值应保留完整响应');
    const [entry] = getRecent(1);
    assert.equal(entry.response.length, 4000, '日志中响应应截断为 4000');
    assert.equal(entry.response, 'A'.repeat(4000));
  });

  test('恰好 4000 字符不截断', async () => {
    const resp = 'B'.repeat(4000);
    const { provider } = mockProvider(() => resp);
    await runLLMTask(provider, 'doc-type-detect');
    const [entry] = getRecent(1);
    assert.equal(entry.response.length, 4000);
  });

  test('非字符串响应被 String() 归一化', async () => {
    const { provider } = mockProvider(() => 12345);
    await runLLMTask(provider, 'doc-type-detect');
    const [entry] = getRecent(1);
    assert.equal(entry.response, '12345');
  });

  test('对象响应被 String() 归一化', async () => {
    const { provider } = mockProvider(() => ({ text: 'hi' }));
    await runLLMTask(provider, 'doc-type-detect');
    const [entry] = getRecent(1);
    assert.equal(entry.response, '[object Object]');
  });

  test('null 响应归一化为空字符串', async () => {
    const { provider } = mockProvider(() => null);
    await runLLMTask(provider, 'doc-type-detect');
    const [entry] = getRecent(1);
    assert.equal(entry.response, '', 'null ?? "" 归一化为空字符串');
  });

  test('undefined 响应归一化为空字符串', async () => {
    const { provider } = mockProvider(() => undefined);
    await runLLMTask(provider, 'doc-type-detect');
    const [entry] = getRecent(1);
    assert.equal(entry.response, '');
  });
});

describe('runLLMTask 日志调用次数', () => {
  test('成功调用恰好记录一条日志', async () => {
    const { provider } = mockProvider(() => 'ok');
    await runLLMTask(provider, 'doc-type-detect');
    assert.equal(getLogCount(), 1);
  });

  test('失败调用恰好记录一条日志', async () => {
    const provider = { name: 'mock', complete: async () => { throw new Error('fail'); } };
    await assert.rejects(runLLMTask(provider, 'doc-type-detect'));
    assert.equal(getLogCount(), 1, '失败也应且只应记录一条');
  });
});
