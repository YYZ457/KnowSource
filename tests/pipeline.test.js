import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 测试数据契约
describe('数据契约 (core/types)', () => {
  test('sample-doc.json 符合 Document 类型结构', () => {
    const doc = JSON.parse(readFileSync(join(__dirname, 'fixtures/sample-doc.json'), 'utf-8'));
    assert.ok(doc.meta.docId, 'docId 必须存在');
    assert.ok(doc.meta.type, 'type 必须存在');
    assert.ok(Array.isArray(doc.sections), 'sections 必须是数组');
    assert.ok(doc.rawText, 'rawText 必须存在');
  });

  test('sample-graph.json 符合 Graph 结构', () => {
    const graph = JSON.parse(readFileSync(join(__dirname, 'fixtures/sample-graph.json'), 'utf-8'));
    assert.ok(Array.isArray(graph.nodes), 'nodes 必须是数组');
    assert.ok(Array.isArray(graph.edges), 'edges 必须是数组');
    assert.ok(graph.nodes.length > 0, '至少有一个节点');
    assert.ok(graph.edges.length > 0, '至少有一条边');

    // 验证节点字段
    const node = graph.nodes[0];
    assert.ok(node.id, '节点必须有 id');
    assert.ok(['concept', 'document', 'idea'].includes(node.type), '节点 type 必须合法');
    assert.ok(node.content, '节点必须有 content');

    // 验证边字段
    const edge = graph.edges[0];
    assert.ok(edge.from, '边必须有 from');
    assert.ok(edge.to, '边必须有 to');
    assert.ok(['cite', 'similar', 'derive', 'belong'].includes(edge.type), '边 type 必须合法');
  });
});

// 测试管线（使用 mock 数据，不依赖浏览器环境）
describe('管线编排 (core/pipeline)', () => {
  test('runPipeline 处理纯文本输入', async () => {
    const { runPipeline } = await import('../core/pipeline/index.js');

    const files = [
      { name: 'test.md', content: '# 测试\n\n## 折射定律\n折射定律描述光线的偏折规律。', type: 'markdown' }
    ];

    const result = await runPipeline(files, {});

    assert.ok(result.documents, '必须返回 documents');
    assert.ok(result.documents.length > 0, '至少一篇文档');
    assert.ok(result.entities, '必须返回 entities');
    assert.ok(result.graph, '必须返回 graph');
    assert.ok(Array.isArray(result.graph.nodes), 'graph.nodes 必须是数组');
  });

  test('runPipeline 进度回调被调用', async () => {
    const { runPipeline } = await import('../core/pipeline/index.js');

    const progressCalls = [];
    const files = [{ name: 'a.txt', content: '测试内容折射定律' }];

    await runPipeline(files, {
      onProgress: (p) => progressCalls.push(p)
    });

    assert.ok(progressCalls.length > 0, '进度回调必须被调用');
    assert.ok(progressCalls.some(p => p.stage === 'parse'), '必须有 parse 阶段');
    assert.ok(progressCalls.some(p => p.stage === 'queryable'), '必须有 queryable 阶段');
  });

  test('本地模型（ollama）禁用全文抽取，统一走分步管线', async () => {
    const { runPipeline } = await import('../core/pipeline/index.js');

    const progressCalls = [];
    const files = [
      { name: 'short.txt', content: '# 短文档\n\n折射定律描述光线偏折。' },
      { name: 'long.txt', content: '# 长文档\n\n' + '折射定律。'.repeat(1000) }
    ];

    const mockOllamaProvider = {
      name: 'ollama',
      capabilities: { qualityLevel: 'medium', contextWindow: 8192 },
      complete: async () => '{"headings":[],"entities":[],"relationships":[]}'
    };

    await runPipeline(files, {
      provider: mockOllamaProvider,
      extractOptions: { fullExtractEnabled: true },
      onProgress: (p) => progressCalls.push(p)
    });

    // ollama 不应进入 fullExtract 阶段，应走 extractTerms / buildGraph 分步管线
    assert.ok(!progressCalls.some(p => p.stage === 'fullExtract'), 'ollama 不应触发 fullExtract 阶段');
    assert.ok(progressCalls.some(p => p.stage === 'extractTerms'), 'ollama 应触发 extractTerms 阶段');
    assert.ok(progressCalls.some(p => p.stage === 'buildGraph'), 'ollama 应触发 buildGraph 阶段');
  });

  test('云端模型按文档自适应选择路径：短文档全文抽取，超长文档分步管线', async () => {
    const { runPipeline } = await import('../core/pipeline/index.js');

    const progressCalls = [];
    const files = [
      { name: 'short.txt', content: '# 短文档\n\n折射定律描述光线偏折。' },
      { name: 'long.txt', content: '# 长文档\n\n' + '折射定律。'.repeat(10000) }
    ];

    const mockCloudProvider = {
      name: 'openai-compatible',
      capabilities: { qualityLevel: 'strong', contextWindow: 200000 },
      complete: async () => '{"headings":[{"title":"短文档","level":1,"start":0}],"entities":[{"term":"折射定律","specificity":8,"isGeneric":false,"start":10,"heading":"短文档","type":"concept"}],"relationships":[]}'
    };

    const result = await runPipeline(files, {
      provider: mockCloudProvider,
      extractOptions: { fullExtractEnabled: true, fullExtractMaxContextChars: 10000 },
      onProgress: (p) => progressCalls.push(p)
    });

    // 短文档应走全文抽取，超长文档应走分步管线
    assert.ok(progressCalls.some(p => p.stage === 'fullExtract'), '短文档应触发 fullExtract 阶段');
    assert.ok(progressCalls.some(p => p.stage === 'extractTerms'), '超长文档应触发 extractTerms 阶段');
    assert.ok(result.graph.nodes.length > 0, '应生成节点');
    assert.ok(result.graph.nodes.some(n => n.type === 'document'), '应包含 document 节点');
  });
});
