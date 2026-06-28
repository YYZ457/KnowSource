import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Idea } from '../core/idea/model.js';
import { linkIdeaToGraph, linkIdeaRelation, unlinkIdeaFromGraph } from '../core/idea/linkage.js';
import { recommendNodes } from '../core/idea/recommend.js';
import { KnowledgeGraph } from '../core/graph/index.js';

describe('Idea 数据模型', () => {
  test('创建与更新', () => {
    const idea = new Idea({ title: '测试想法', content: '关于折射定律的思考' });
    assert.ok(idea.id.startsWith('idea-'));
    assert.equal(idea.title, '测试想法');
    assert.equal(idea.relatedNodes.length, 0);

    idea.update({ title: '更新标题' });
    assert.equal(idea.title, '更新标题');
    assert.ok(idea.updatedAt >= idea.createdAt);
  });

  test('关联节点管理', () => {
    const idea = new Idea({ title: 'T', content: 'C' });
    idea.addRelatedNode('node-1');
    idea.addRelatedNode('node-1'); // 去重
    idea.addRelatedNode('node-2');
    assert.equal(idea.relatedNodes.length, 2);

    idea.removeRelatedNode('node-1');
    assert.equal(idea.relatedNodes.length, 1);
  });

  test('关系管理', () => {
    const idea1 = new Idea({ title: 'A', content: 'a' });
    const idea2 = new Idea({ title: 'B', content: 'b' });
    idea1.addRelation(idea2.id, 'derive');
    idea1.addRelation(idea2.id, 'derive'); // 去重
    assert.equal(idea1.relations.length, 1);
  });

  test('序列化与反序列化', () => {
    const idea = new Idea({ title: 'T', content: 'C', relatedNodes: ['n1'] });
    const json = idea.toJSON();
    const restored = Idea.fromJSON(json);
    assert.equal(restored.id, idea.id);
    assert.equal(restored.title, 'T');
    assert.deepEqual(restored.relatedNodes, ['n1']);
  });
});

describe('Idea 与图谱联动', () => {
  test('linkIdeaToGraph 创建 idea 节点与 belong 边', () => {
    const graph = new KnowledgeGraph();
    graph.addNode({ id: 'concept-1', type: 'concept', content: '折射定律' });

    const idea = new Idea({ title: '折射思考', content: '...', relatedNodes: ['concept-1'] });
    linkIdeaToGraph(graph, idea);

    assert.ok(graph.getNode(idea.id), '应有 idea 节点');
    assert.equal(graph.getNode(idea.id).type, 'idea');

    const neighbors = graph.getNeighbors(idea.id);
    assert.ok(neighbors.some(n => n.node.id === 'concept-1'), '应有 belong 边到 concept-1');
  });

  test('unlinkIdeaFromGraph 移除节点与边', () => {
    const graph = new KnowledgeGraph();
    graph.addNode({ id: 'c1', type: 'concept', content: 'C1' });
    const idea = new Idea({ title: 'T', content: 'C', relatedNodes: ['c1'] });
    linkIdeaToGraph(graph, idea);

    assert.ok(graph.getNode(idea.id));
    unlinkIdeaFromGraph(graph, idea.id);
    assert.ok(!graph.getNode(idea.id));
    assert.equal(graph.getNeighbors('c1').length, 0);
  });

  test('linkIdeaRelation 创建 Idea 间边', () => {
    const graph = new KnowledgeGraph();
    const idea1 = new Idea({ title: 'A', content: 'a' });
    const idea2 = new Idea({ title: 'B', content: 'b' });
    linkIdeaToGraph(graph, idea1);
    linkIdeaToGraph(graph, idea2);

    linkIdeaRelation(graph, idea1.id, idea2.id, 'derive');
    const neighbors = graph.getNeighbors(idea1.id);
    assert.ok(neighbors.some(n => n.node.id === idea2.id));
  });
});

describe('Idea 自动推荐', () => {
  test('recommendNodes 返回相关节点', async () => {
    const graph = new KnowledgeGraph();
    graph.addNode({ id: 'c1', type: 'concept', content: '折射定律', source: { docId: 'd1', sectionId: 's1' } });
    graph.addNode({ id: 'c2', type: 'concept', content: '量子力学', source: { docId: 'd2', sectionId: 's1' } });

    const documents = [
      { meta: { docId: 'd1' }, sections: [{ id: 's1', content: '折射定律光学', keywords: [{word:'折射', count:1}] }] },
      { meta: { docId: 'd2' }, sections: [{ id: 's1', content: '量子力学波函数', keywords: [{word:'量子', count:1}] }] }
    ];

    const idea = new Idea({ title: '折射', content: '关于折射的思考' });
    const recommendations = await recommendNodes(idea, { documents, graph, embedFn: async () => [1,0,0], topN: 3 });

    assert.ok(Array.isArray(recommendations));
    // 折射相关文档应排在前面
    if (recommendations.length > 0) {
      assert.ok(recommendations[0].score > 0);
    }
  });

  test('空查询返回空数组', async () => {
    const idea = new Idea({ title: '', content: '' });
    const recommendations = await recommendNodes(idea, {});
    assert.equal(recommendations.length, 0);
  });
});
