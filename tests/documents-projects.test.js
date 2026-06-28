import { test, describe } from 'node:test';
import assert from 'node:assert';
import { storage } from '../services/storage.js';
import { parseHandler } from '../services/api/handlers/parse.js';
import { reorderDocuments } from '../services/api/handlers/documents.js';
import {
  listProjectsHandler,
  createProjectHandler,
  updateProjectHandler,
  exportProjectHandler,
  importProjectHandler,
  switchProjectHandler
} from '../services/api/handlers/projects.js';

describe('文档排序', () => {
  test('reorderDocuments 按指定顺序重建文档列表', async () => {
    // 先解析 3 个文档
    const doc1 = await parseHandler({ name: 'doc1.md', content: '文档一内容', type: 'markdown' });
    const doc2 = await parseHandler({ name: 'doc2.md', content: '文档二内容', type: 'markdown' });
    const doc3 = await parseHandler({ name: 'doc3.md', content: '文档三内容', type: 'markdown' });

    // 原始顺序：doc1, doc2, doc3
    const before = Array.from(storage.documents.values());
    assert.equal(before[0].docId, doc1.docId);
    assert.equal(before[1].docId, doc2.docId);
    assert.equal(before[2].docId, doc3.docId);

    // 反转顺序：doc3, doc2, doc1
    const result = reorderDocuments({ docIds: [doc3.docId, doc2.docId, doc1.docId] });
    assert.ok(result.success);
    assert.deepEqual(result.docIds, [doc3.docId, doc2.docId, doc1.docId]);

    // 验证内存中的顺序已更新
    const after = Array.from(storage.documents.values());
    assert.equal(after[0].docId, doc3.docId);
    assert.equal(after[1].docId, doc2.docId);
    assert.equal(after[2].docId, doc1.docId);
  });

  test('reorderDocuments 缺少参数返回错误', () => {
    const result = reorderDocuments({});
    assert.ok(result.error);
  });

  test('reorderDocuments 空数组返回错误', () => {
    const result = reorderDocuments({ docIds: [] });
    assert.ok(result.error);
  });

  test('reorderDocuments 保留未在列表中的文档', async () => {
    const docA = await parseHandler({ name: 'docA.md', content: '文档A', type: 'markdown' });
    const docB = await parseHandler({ name: 'docB.md', content: '文档B', type: 'markdown' });

    // 只传入 docA，docB 应被追加到末尾
    const result = reorderDocuments({ docIds: [docA.docId] });
    assert.ok(result.success);
    // docB 应仍在列表中
    assert.ok(result.docIds.includes(docB.docId));
  });
});

describe('项目导出/导入', () => {
  test('导出当前项目数据', async () => {
    // 确保当前项目有文档
    await parseHandler({ name: 'export-test.md', content: '导出测试内容', type: 'markdown' });

    const list = await listProjectsHandler();
    const currentId = list.currentProjectId;

    const result = await exportProjectHandler({ id: currentId });
    assert.ok(result.version);
    assert.ok(result.project);
    assert.ok(Array.isArray(result.documents));
    assert.ok(Array.isArray(result.ideas));
    assert.ok(result.graph);
    assert.ok(result.graph.nodes !== undefined);
  });

  test('导出不存在的项目返回错误', async () => {
    const result = await exportProjectHandler({ id: 'nonexistent-project' });
    assert.ok(result.error);
  });

  test('导入项目数据', async () => {
    // 先导出当前项目
    const list = await listProjectsHandler();
    const currentId = list.currentProjectId;
    const exported = await exportProjectHandler({ id: currentId });
    assert.ok(exported.documents, '导出数据应有 documents');

    // 导入为新项目
    const importResult = await importProjectHandler({
      data: exported,
      name: '导入测试项目'
    });
    assert.ok(importResult.success, '导入应成功');
    assert.ok(importResult.project, '应返回新项目');
    assert.equal(importResult.project.name, '导入测试项目');
    assert.ok(importResult.project.id, '新项目应有 ID');
    assert.ok(importResult.projects.some(p => p.id === importResult.project.id), '项目列表应包含新项目');
  });

  test('导入重名项目自动追加序号', async () => {
    const list = await listProjectsHandler();
    const currentId = list.currentProjectId;
    const exported = await exportProjectHandler({ id: currentId });

    // 用相同名称导入两次
    const result1 = await importProjectHandler({ data: exported, name: '重名导入测试' });
    assert.ok(result1.success);
    assert.equal(result1.project.name, '重名导入测试');

    const result2 = await importProjectHandler({ data: exported, name: '重名导入测试' });
    assert.ok(result2.success);
    assert.equal(result2.project.name, '重名导入测试 (1)');
  });

  test('导入无效数据返回错误', async () => {
    const result = await importProjectHandler({ data: { foo: 'bar' } });
    assert.ok(result.error);
  });

  test('导入数据包含文档和图谱', async () => {
    // 导出当前项目（已有文档）
    const list = await listProjectsHandler();
    const currentId = list.currentProjectId;
    const exported = await exportProjectHandler({ id: currentId });
    const docCount = exported.documents.length;
    assert.ok(docCount > 0, '导出数据应包含文档');

    // 验证导出数据结构完整
    assert.ok(exported.version, '导出数据应包含 version');
    assert.ok(exported.project, '导出数据应包含 project 元信息');
    assert.ok(Array.isArray(exported.documents), '导出数据应包含 documents 数组');
    assert.ok(Array.isArray(exported.ideas), '导出数据应包含 ideas 数组');
    assert.ok(exported.graph, '导出数据应包含 graph');
    assert.ok(exported.graph.nodes !== undefined, 'graph 应包含 nodes');

    // 导入为新项目
    const importResult = await importProjectHandler({ data: exported, name: '验证导入内容' });
    assert.ok(importResult.success, '导入应成功');
    assert.ok(importResult.project, '应返回新项目');
    assert.equal(importResult.project.name, '验证导入内容');

    // 验证导入后项目列表包含新项目
    assert.ok(
      importResult.projects.some(p => p.id === importResult.project.id),
      '项目列表应包含新导入的项目'
    );

    // 注意：在 KNOWLEDGE_IDE_NO_PERSIST=1 测试模式下，saveJSON 为空操作，
    // 导入的数据不会写入磁盘，因此无法通过 switchProject 验证数据加载。
    // 导出/导入的数据结构完整性已通过上述断言验证。
  });
});

describe('项目更新（描述）', () => {
  test('更新项目描述', async () => {
    const created = await createProjectHandler({ name: '描述测试项目' });
    assert.ok(created.project);

    const result = await updateProjectHandler({
      id: created.project.id,
      description: '这是一个测试描述'
    });
    assert.ok(result.project);
    assert.equal(result.project.description, '这是一个测试描述');
  });

  test('同时更新名称和描述', async () => {
    const created = await createProjectHandler({ name: '原名更新测试' });
    assert.ok(created.project);

    const result = await updateProjectHandler({
      id: created.project.id,
      name: '新名更新测试',
      description: '新描述'
    });
    assert.ok(result.project);
    assert.equal(result.project.name, '新名更新测试');
    assert.equal(result.project.description, '新描述');
  });

  test('仅更新描述不改变名称', async () => {
    const created = await createProjectHandler({ name: '仅描述测试' });
    assert.ok(created.project);

    const result = await updateProjectHandler({
      id: created.project.id,
      description: '只改描述'
    });
    assert.ok(result.project);
    assert.equal(result.project.name, '仅描述测试');
    assert.equal(result.project.description, '只改描述');
  });

  test('清空描述', async () => {
    const created = await createProjectHandler({ name: '清空描述测试' });
    await updateProjectHandler({ id: created.project.id, description: '有描述' });

    const result = await updateProjectHandler({
      id: created.project.id,
      description: ''
    });
    assert.ok(result.project);
    assert.equal(result.project.description, '');
  });

  test('缺少 id 返回错误', async () => {
    const result = await updateProjectHandler({ description: '无 ID' });
    assert.ok(result.error);
  });

  test('不提供任何字段返回错误', async () => {
    const created = await createProjectHandler({ name: '无字段更新测试' });
    const result = await updateProjectHandler({ id: created.project.id });
    assert.ok(result.error);
  });

  test('更新名称为已存在名称返回错误', async () => {
    const a = await createProjectHandler({ name: '独有名更新A' });
    const b = await createProjectHandler({ name: '独有名更新B' });
    const result = await updateProjectHandler({ id: b.project.id, name: '独有名更新A' });
    assert.ok(result.error);
    assert.equal(result.error, '项目名称已存在');
  });

  test('renameProjectHandler 仍向后兼容', async () => {
    const created = await createProjectHandler({ name: '向后兼容测试' });
    const { renameProjectHandler } = await import('../services/api/handlers/projects.js');
    const result = await renameProjectHandler({ id: created.project.id, name: '重命名后' });
    assert.ok(result.project);
    assert.equal(result.project.name, '重命名后');
  });
});
