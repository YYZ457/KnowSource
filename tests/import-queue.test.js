import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  quickHash,
  computeFingerprint,
  createDeferred,
  createImportTask,
  isTaskDeduplicable,
  findDuplicateTask
} from '../renderer/src/utils/import-queue.mjs';

describe('import-queue 工具函数', () => {
  test('quickHash 对相同内容返回相同哈希', () => {
    assert.equal(quickHash('hello'), quickHash('hello'));
  });

  test('quickHash 对不同内容返回不同哈希', () => {
    assert.notEqual(quickHash('hello'), quickHash('world'));
  });

  test('computeFingerprint 组合文件名、长度、哈希与类型', () => {
    const fp1 = computeFingerprint('a.md', 'hello', 'markdown');
    const fp2 = computeFingerprint('a.md', 'hello', 'markdown');
    const fp3 = computeFingerprint('a.md', 'hello', 'text');
    const fp4 = computeFingerprint('b.md', 'hello', 'markdown');

    assert.equal(fp1, fp2, '相同输入指纹应一致');
    assert.notEqual(fp1, fp3, '类型不同指纹不同');
    assert.notEqual(fp1, fp4, '文件名不同指纹不同');
    assert.ok(fp1.includes('a.md'), '指纹包含文件名');
    assert.ok(fp1.includes('5'), '指纹包含长度信息');
  });

  test('createDeferred 可正常 resolve/reject', async () => {
    const d1 = createDeferred();
    d1.resolve(42);
    assert.equal(await d1.promise, 42);

    const d2 = createDeferred();
    d2.reject(new Error('fail'));
    await assert.rejects(d2.promise, /fail/);
  });

  test('createImportTask 生成带默认状态的任务对象', () => {
    const task = createImportTask('test.md', '# Hello', 'markdown');
    assert.ok(task.id, '任务应有 id');
    assert.equal(task.name, 'test.md');
    assert.equal(task.type, 'markdown');
    assert.equal(task.status, 'queued');
    assert.equal(task.size, 7);
    assert.ok(task.fingerprint, '任务应有指纹');
    assert.equal(task.progress.percent, 0);
    assert.equal(task.error, null);
    assert.equal(task.retryable, false);
    assert.equal(task.result, null);
  });

  test('isTaskDeduplicable 正确识别可去重状态', () => {
    assert.ok(isTaskDeduplicable({ status: 'queued' }));
    assert.ok(isTaskDeduplicable({ status: 'parsing' }));
    assert.ok(isTaskDeduplicable({ status: 'done' }));
    assert.equal(isTaskDeduplicable({ status: 'error' }), false);
    assert.equal(isTaskDeduplicable({ status: 'cancelled' }), false);
  });

  test('findDuplicateTask 按指纹查找可去重任务', () => {
    const tasks = [
      createImportTask('a.md', 'content-a', 'markdown'),
      createImportTask('b.md', 'content-b', 'markdown')
    ];
    tasks[0].status = 'parsing';
    tasks[1].status = 'error';

    const dup = findDuplicateTask(tasks, computeFingerprint('a.md', 'content-a', 'markdown'));
    assert.ok(dup, '应找到正在解析的重复任务');
    assert.equal(dup.name, 'a.md');

    const notDup = findDuplicateTask(tasks, computeFingerprint('b.md', 'content-b', 'markdown'));
    assert.equal(notDup, undefined, '失败任务不应被去重');

    const none = findDuplicateTask(tasks, computeFingerprint('c.md', 'content-c', 'markdown'));
    assert.equal(none, undefined, '无匹配任务');
  });

  test('文件内容长度相同但内容不同时指纹不同', () => {
    const fp1 = computeFingerprint('x.txt', 'aaaaa', 'text');
    const fp2 = computeFingerprint('x.txt', 'bbbbb', 'text');
    assert.notEqual(fp1, fp2);
  });
});
