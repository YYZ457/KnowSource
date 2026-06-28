import { test, describe } from 'node:test';
import assert from 'node:assert';
import { storage } from '../services/storage.js';
import {
  listProjectsHandler,
  createProjectHandler,
  switchProjectHandler,
  deleteProjectHandler,
  renameProjectHandler
} from '../services/api/handlers/projects.js';

describe('项目管理', () => {
  test('初始有默认项目', async () => {
    const result = await listProjectsHandler();
    assert.ok(result.projects.length > 0, '应至少有一个默认项目');
    assert.ok(result.currentProjectId, '应有当前项目 ID');
  });

  test('创建新项目', async () => {
    const result = await createProjectHandler({ name: '测试项目A' });
    assert.ok(result.project, '应返回创建的项目');
    assert.equal(result.project.name, '测试项目A');
    assert.ok(result.project.id, '项目应有 ID');
    assert.ok(result.projects.some(p => p.id === result.project.id), '项目列表应包含新项目');
  });

  test('切换项目并切回', async () => {
    const initial = await listProjectsHandler();
    const created = await createProjectHandler({ name: '切换测试B' });

    const switchResult = await switchProjectHandler({ projectId: created.project.id });
    assert.ok(switchResult.success, '切换应成功');
    assert.equal(switchResult.currentProjectId, created.project.id, '当前项目应已切换');

    // 切回原项目
    const restoreResult = await switchProjectHandler({ projectId: initial.currentProjectId });
    assert.ok(restoreResult.success, '切回应成功');
    assert.equal(restoreResult.currentProjectId, initial.currentProjectId, '应切回原项目');
  });

  test('重命名项目', async () => {
    const created = await createProjectHandler({ name: '原名C' });
    const result = await renameProjectHandler({ id: created.project.id, name: '新名C' });
    assert.ok(result.project, '应返回更新后的项目');
    assert.equal(result.project.name, '新名C');
  });

  test('创建重名项目返回错误', async () => {
    const created = await createProjectHandler({ name: '重名测试D' });
    assert.ok(created.project, '首次创建应成功');
    const dup = await createProjectHandler({ name: '重名测试D' });
    assert.ok(dup.error, '重名创建应返回错误');
    assert.equal(dup.error, '项目名称已存在');
  });

  test('重命名为已存在名称返回错误', async () => {
    const a = await createProjectHandler({ name: '独有名E' });
    const b = await createProjectHandler({ name: '独有名F' });
    assert.ok(a.project && b.project, '两个项目应创建成功');
    const result = await renameProjectHandler({ id: b.project.id, name: '独有名E' });
    assert.ok(result.error, '重命名为已存在名称应返回错误');
    assert.equal(result.error, '项目名称已存在');
  });

  test('重命名为自身名称不报错', async () => {
    const created = await createProjectHandler({ name: '自身名G' });
    const result = await renameProjectHandler({ id: created.project.id, name: '自身名G' });
    assert.ok(result.project, '重命名为自身名称应成功');
    assert.equal(result.project.name, '自身名G');
  });

  test('不能删除最后一个项目', async () => {
    // 删除所有项目直到只剩一个
    let all = await listProjectsHandler();
    while (all.projects.length > 1) {
      // 优先删除非当前项目
      const toDelete = all.projects.find(p => p.id !== all.currentProjectId) || all.projects[0];
      await deleteProjectHandler({ id: toDelete.id });
      all = await listProjectsHandler();
    }

    // 尝试删除最后一个项目
    const last = all.projects[0];
    const result = await deleteProjectHandler({ id: last.id });
    assert.ok(result.error, '删除最后一个项目应返回错误');
  });

  test('切换到不存在的项目返回错误', async () => {
    const result = await switchProjectHandler({ projectId: 'nonexistent-id' });
    assert.ok(result.error, '切换到不存在的项目应返回错误');
  });

  test('缺少参数时返回错误', async () => {
    const switchResult = await switchProjectHandler({});
    assert.ok(switchResult.error);

    const deleteResult = await deleteProjectHandler({});
    assert.ok(deleteResult.error);

    const renameResult = await renameProjectHandler({});
    assert.ok(renameResult.error);
  });
});
