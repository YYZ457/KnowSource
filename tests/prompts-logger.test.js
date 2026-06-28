/**
 * core/prompts/logger 单元测试
 *
 * 覆盖：环形缓冲区写入、倒序读取、limit 边界、清空、计数、MAX_ENTRIES 截断
 * 该模块为 core 层纯内存逻辑，无磁盘 / 网络依赖。
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { logCall, getRecent, clearLog, getLogCount } from '../core/prompts/logger.js';

beforeEach(() => {
  clearLog();
});

function makeEntry(i) {
  return {
    taskId: `task-${i}`,
    taskName: `任务${i}`,
    system: 'sys',
    user: `user-${i}`,
    response: `resp-${i}`,
    durationMs: i * 10,
    success: true,
    timestamp: new Date(1700000000000 + i).toISOString()
  };
}

describe('logCall / getLogCount', () => {
  test('单条写入后计数为 1', () => {
    logCall(makeEntry(0));
    assert.equal(getLogCount(), 1);
  });

  test('多条写入累计计数', () => {
    for (let i = 0; i < 10; i++) logCall(makeEntry(i));
    assert.equal(getLogCount(), 10);
  });

  test('写入的条目是副本，外部修改不影响存储', () => {
    const entry = makeEntry(0);
    logCall(entry);
    // 修改原始对象
    entry.taskId = 'changed';
    entry.response = 'changed';
    const recent = getRecent(1);
    assert.equal(recent[0].taskId, 'task-0', '存储应为副本，不受外部修改影响');
    assert.equal(recent[0].response, 'resp-0');
  });
});

describe('getRecent 倒序与 limit', () => {
  test('按时间倒序返回（最新在前）', () => {
    for (let i = 0; i < 5; i++) logCall(makeEntry(i));
    const recent = getRecent(3);
    assert.equal(recent.length, 3);
    // 最后写入的 i=4 应排在最前
    assert.equal(recent[0].taskId, 'task-4', '最新条目应排在首位');
    assert.equal(recent[1].taskId, 'task-3');
    assert.equal(recent[2].taskId, 'task-2');
  });

  test('limit 大于条目数时返回全部', () => {
    for (let i = 0; i < 3; i++) logCall(makeEntry(i));
    const recent = getRecent(100);
    assert.equal(recent.length, 3);
  });

  test('默认 limit=50', () => {
    for (let i = 0; i < 60; i++) logCall(makeEntry(i));
    const recent = getRecent();
    assert.equal(recent.length, 50, '默认应返回 50 条');
    assert.equal(recent[0].taskId, 'task-59', '最新应在首位');
  });

  test('limit=0 返回空数组', () => {
    for (let i = 0; i < 5; i++) logCall(makeEntry(i));
    const recent = getRecent(0);
    assert.equal(recent.length, 0);
  });

  test('空缓冲区返回空数组', () => {
    assert.equal(getRecent(10).length, 0);
    assert.equal(getRecent().length, 0);
  });
});

describe('clearLog', () => {
  test('清空后计数为 0', () => {
    for (let i = 0; i < 5; i++) logCall(makeEntry(i));
    assert.equal(getLogCount(), 5);
    clearLog();
    assert.equal(getLogCount(), 0);
    assert.equal(getRecent(10).length, 0);
  });

  test('清空后仍可继续写入', () => {
    logCall(makeEntry(0));
    clearLog();
    logCall(makeEntry(1));
    assert.equal(getLogCount(), 1);
    assert.equal(getRecent(1)[0].taskId, 'task-1');
  });
});

describe('环形缓冲区 MAX_ENTRIES 截断', () => {
  test('超过 200 条时丢弃最旧的，保留最近 200 条', () => {
    // 写入 250 条
    for (let i = 0; i < 250; i++) logCall(makeEntry(i));
    assert.equal(getLogCount(), 200, '应只保留 200 条');

    // 最近 200 条应为 i=50..249
    const all = getRecent(200);
    assert.equal(all.length, 200);
    // all[0] 是最新（i=249），all[199] 是最旧（i=50）
    assert.equal(all[0].taskId, 'task-249', '最新应为 task-249');
    assert.equal(all[199].taskId, 'task-50', '最旧应被截断到 task-50');
    // 不应包含已丢弃的旧条目
    assert.ok(!all.some(e => e.taskId === 'task-49'), 'task-49 应已被丢弃');
    assert.ok(!all.some(e => e.taskId === 'task-0'), 'task-0 应已被丢弃');
  });

  test('恰好 200 条时不截断', () => {
    for (let i = 0; i < 200; i++) logCall(makeEntry(i));
    assert.equal(getLogCount(), 200);
    assert.equal(getRecent(200)[199].taskId, 'task-0', 'task-0 仍应保留');
  });

  test('持续写入后倒序仍正确', () => {
    for (let i = 0; i < 210; i++) logCall(makeEntry(i));
    const recent = getRecent(3);
    assert.equal(recent[0].taskId, 'task-209');
    assert.equal(recent[1].taskId, 'task-208');
    assert.equal(recent[2].taskId, 'task-207');
  });
});

describe('日志条目字段完整性', () => {
  test('成功调用条目包含完整字段', () => {
    logCall({
      taskId: 'doc-type-detect',
      taskName: '文档类型识别',
      system: 'sys-prompt',
      user: 'user-prompt',
      response: '响应内容',
      durationMs: 123,
      success: true,
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    const [entry] = getRecent(1);
    assert.equal(entry.taskId, 'doc-type-detect');
    assert.equal(entry.taskName, '文档类型识别');
    assert.equal(entry.system, 'sys-prompt');
    assert.equal(entry.user, 'user-prompt');
    assert.equal(entry.response, '响应内容');
    assert.equal(entry.durationMs, 123);
    assert.equal(entry.success, true);
    assert.equal(entry.timestamp, '2026-01-01T00:00:00.000Z');
  });

  test('失败调用条目携带 error 与 fallbackReason', () => {
    logCall({
      taskId: 't',
      taskName: 'T',
      system: '',
      user: 'u',
      response: '',
      durationMs: 5,
      success: false,
      error: '网络超时',
      fallbackReason: 'LLM 任务已被禁用',
      disabled: true,
      overridden: false,
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    const [entry] = getRecent(1);
    assert.equal(entry.success, false);
    assert.equal(entry.error, '网络超时');
    assert.equal(entry.fallbackReason, 'LLM 任务已被禁用');
    assert.equal(entry.disabled, true);
    assert.equal(entry.overridden, false);
  });
});
