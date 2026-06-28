import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseHandler } from '../services/api/handlers/parse.js';
import { extractHandler } from '../services/api/handlers/extract.js';
import { graphBuildHandler } from '../services/api/handlers/graph-build.js';
import { graphQueryHandler } from '../services/api/handlers/graph-query.js';
import { matchHandler } from '../services/api/handlers/match.js';
import { Idea } from '../core/idea/model.js';
import { linkIdeaToGraph } from '../core/idea/linkage.js';
import { recommendNodes } from '../core/idea/recommend.js';
import { pluginManager } from '../plugins/manager.js';
import samplePlugin from '../plugins/sample-plugin/index.js';
import { setLLMProvider, createLLMProvider } from '../services/llm-provider.js';
import { setVectorStore, createVectorStore } from '../services/vector-store.js';

describe('E2E: 完整知识 IDE 流程', () => {
  test('导入多文档 → 构建图谱 → 创建 Idea → 搜索匹配', async () => {
    // === 步骤 1: 初始化扩展能力 ===
    pluginManager.clear();
    pluginManager.register(samplePlugin);
    assert.equal(pluginManager.list().length, 1, '插件应已注册');

    setLLMProvider(createLLMProvider('stub'));
    setVectorStore(createVectorStore('memory'));

    // === 步骤 2: 导入 3 篇文档（2 篇 Markdown + 1 篇文本）===
    const doc1 = await parseHandler({
      name: 'optics.md',
      content: '# 光学\n## 折射定律\n折射定律描述光线从一种介质进入另一种介质时的偏折。斯涅尔定律是折射定律的数学表达。全反射发生在临界角。',
      type: 'markdown'
    });
    assert.ok(doc1.docId, 'doc1 应有 docId');

    const doc2 = await parseHandler({
      name: 'waves.md',
      content: '# 波动\n## 干涉衍射\n杨氏双缝干涉展示了光的波动性。光程差决定明暗条纹。单缝衍射的中央明纹宽度与缝宽有关。',
      type: 'markdown'
    });
    assert.ok(doc2.docId, 'doc2 应有 docId');

    const doc3 = await parseHandler({
      name: 'notes.txt',
      content: '量子力学研究微观粒子的运动规律。波函数描述粒子状态。薛定谔方程是量子力学的基本方程。',
      type: 'text'
    });
    assert.ok(doc3.docId, 'doc3 应有 docId');

    // === 步骤 3: 抽取关键词 ===
    const extractResult = await extractHandler({ docId: doc1.docId, topN: 5 });
    assert.ok(extractResult.entities.length > 0, '应有关键词');

    // === 步骤 4: 构建知识图谱 ===
    const graphResult = await graphBuildHandler({
      documents: [
        { name: 'optics.md', content: doc1.rawText },
        { name: 'waves.md', content: doc2.rawText },
        { name: 'notes.txt', content: doc3.rawText }
      ]
    });
    assert.ok(graphResult.nodes.length > 0, '图谱应有节点');
    assert.ok(graphResult.stats, '应有统计信息');

    // === 步骤 5: 图查询 ===
    const statsResult = await graphQueryHandler({ action: 'stats' });
    assert.ok(statsResult.stats.nodeCount > 0, '应有节点');

    const searchResult = await graphQueryHandler({ action: 'search', query: '折射' });
    assert.ok(Array.isArray(searchResult.results), '搜索应返回数组');

    // === 步骤 6: 创建 Idea 并关联图谱 ===
    const idea = new Idea({
      title: '光学与波动的联系',
      content: '折射定律和干涉衍射都源于光的波动性，研究光在不同条件下的行为。'
    });
    assert.ok(idea.id, 'Idea 应有 id');

    // === 步骤 7: 匹配搜索 ===
    const matchResult = await matchHandler({
      query: '折射定律 干涉',
      strategy: 'hybrid',
      topN: 5
    });
    assert.ok(matchResult.results, '匹配应返回结果');
    assert.equal(matchResult.strategy, 'hybrid');

    // === 步骤 8: 插件 hook 验证 ===
    const processedDoc = await pluginManager.runHook('parser', { meta: {}, rawText: '测试文本内容' });
    assert.ok(processedDoc.meta.charCount > 0, '插件应添加字数统计');

    const processedEntities = await pluginManager.runHook('extractor', [
      { term: '短词', score: 1 },
      { term: '这是一个长术语', score: 2 }
    ]);
    assert.ok(processedEntities[1].meta?.longTerm, '插件应标记长词');
  });

  test('LLM 与向量库适配器切换', async () => {
    // Stub LLM
    const stubLlm = createLLMProvider('stub');
    const stubResult = await stubLlm.complete('测试');
    assert.ok(stubResult.includes('stub-llm'), 'Stub LLM 应返回标记');

    const stubEmbed = await stubLlm.embed('测试文本');
    assert.ok(Array.isArray(stubEmbed), 'embed 应返回数组');
    assert.equal(stubEmbed.length, 64, 'stub embedding 维度应为 64');

    // 内存向量库
    const store = createVectorStore('memory');
    await store.upsert('vec1', [1, 0, 0], { label: 'A' });
    await store.upsert('vec2', [0, 1, 0], { label: 'B' });
    await store.upsert('vec3', [0.9, 0.1, 0], { label: 'C' });

    const results = await store.query([1, 0, 0], 2);
    assert.equal(results.length, 2, '应返回 Top-2');
    assert.equal(results[0].id, 'vec1', '最相似应为 vec1');
    assert.ok(results[0].score > results[1].score, '分数应降序');

    // 删除测试
    await store.delete('vec1');
    assert.equal(await store.size(), 2, '删除后应为 2');
  });

  test('Idea 推荐流程', async () => {
    // 先构建图谱
    await graphBuildHandler({
      documents: [
        { name: 'optics.md', content: '折射定律光学介质偏折' },
        { name: 'quantum.md', content: '量子力学波函数薛定谔' }
      ]
    });

    // 创建 Idea
    const idea = new Idea({
      title: '折射',
      content: '关于折射定律的思考'
    });

    // 推荐（用已解析的文档）
    const documents = [
      { meta: { docId: 'd1' }, sections: [{ id: 's1', content: '折射定律光学', keywords: [{word:'折射', count:1}] }] },
      { meta: { docId: 'd2' }, sections: [{ id: 's1', content: '量子力学波函数', keywords: [{word:'量子', count:1}] }] }
    ];

    const recommendations = await recommendNodes(idea, {
      documents,
      embedFn: async () => [1, 0, 0],
      topN: 3
    });

    assert.ok(Array.isArray(recommendations), '推荐应返回数组');
  });
});
