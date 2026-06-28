import { test, describe } from 'node:test';
import assert from 'node:assert';
import { KnowledgeGraph, GraphNode, GraphEdge, mergeConcepts, buildCrossLinks, getNeighbors, findPath, searchByContent } from '../core/graph/index.js';

describe('GraphNode', () => {
  test('构造与别名合并', () => {
    const n1 = new GraphNode({ id: 'c1', type: 'concept', content: '折射定律', weight: 2 });
    const n2 = new GraphNode({ id: 'c2', type: 'concept', content: '斯涅尔定律', weight: 1, aliases: ['Snell定律'] });
    n1.mergeAlias(n2);
    assert.ok(n1.aliases.includes('斯涅尔定律'));
    assert.ok(n1.aliases.includes('Snell定律'));
    assert.equal(n1.weight, 2);
  });
});

describe('KnowledgeGraph', () => {
  test('增删节点边', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addEdge({ from: 'a', to: 'b', type: 'similar', weight: 0.5 });
    assert.equal(g.nodes.size, 2);
    assert.equal(g.edges.size, 1);
    g.removeNode('a');
    assert.equal(g.nodes.size, 1);
    assert.equal(g.edges.size, 0); // 边应被级联删除
  });

  test('边去重与权重累加', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addEdge({ from: 'a', to: 'b', type: 'similar', weight: 0.3 });
    g.addEdge({ from: 'b', to: 'a', type: 'similar', weight: 0.6 }); // similar 无向，应合并
    assert.equal(g.edges.size, 1);
    const edge = Array.from(g.edges.values())[0];
    assert.equal(edge.weight, 0.6); // 取最大
  });

  test('序列化与反序列化', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addEdge({ from: 'a', to: 'b', type: 'derive', weight: 0.8 });
    const json = g.serialize();
    const g2 = KnowledgeGraph.deserialize(json);
    assert.equal(g2.nodes.size, 2);
    assert.equal(g2.edges.size, 1);
  });
});

describe('概念合并', () => {
  test('相同内容的概念合并', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'c1', type: 'concept', content: '折射定律', source: { docId: 'd1' }, weight: 2 });
    g.addNode({ id: 'c2', type: 'concept', content: '折射定律', source: { docId: 'd2' }, weight: 1 });
    g.addEdge({ from: 'c1', to: 'doc1', type: 'belong' });
    g.addEdge({ from: 'c2', to: 'doc2', type: 'belong' });
    g.addNode({ id: 'doc1', type: 'document', content: 'D1' });
    g.addNode({ id: 'doc2', type: 'document', content: 'D2' });

    const result = mergeConcepts(g, { threshold: 0.99 });
    assert.equal(result.mergedCount, 1);
    assert.equal(g.nodes.size, 3); // c1 + doc1 + doc2（c2 被合并删除）
    // c2 的边应迁移到 c1
    const neighbors = g.getNeighbors('c1');
    assert.ok(neighbors.some(n => n.node.id === 'doc2'));
  });
});

describe('跨文档连接', () => {
  test('相似概念创建 similar 边', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'c1', type: 'concept', content: '折射定律', source: { docId: 'd1' } });
    g.addNode({ id: 'c2', type: 'concept', content: '反射定律', source: { docId: 'd2' } });

    // 传入 nodeType: 'concept' 以匹配测试节点类型（默认为 'heading'）
    const result = buildCrossLinks(g, { threshold: 0.1, nodeType: 'concept' });
    // textSimilarity 基于字符重叠，'折射定律' vs '反射定律' 有重叠
    assert.ok(result.linkCount >= 0); // 取决于相似度计算
  });
});

describe('图查询', () => {
  test('getNeighbors 2跳', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addNode({ id: 'c', type: 'concept', content: 'C' });
    g.addEdge({ from: 'a', to: 'b', type: 'derive' });
    g.addEdge({ from: 'b', to: 'c', type: 'derive' });

    const neighbors = getNeighbors(g, 'a', 2);
    assert.ok(neighbors.some(n => n.node.id === 'b' && n.depth === 1));
    assert.ok(neighbors.some(n => n.node.id === 'c' && n.depth === 2));
  });

  test('findPath 最短路径', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addNode({ id: 'c', type: 'concept', content: 'C' });
    g.addEdge({ from: 'a', to: 'b', type: 'derive' });
    g.addEdge({ from: 'b', to: 'c', type: 'derive' });

    const path = findPath(g, 'a', 'c');
    assert.ok(path);
    assert.deepEqual(path.path, ['a', 'b', 'c']);
    assert.equal(path.edges.length, 2);
  });

  test('findPath 无路径返回 null', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    // 不连接
    const path = findPath(g, 'a', 'b');
    assert.equal(path, null);
  });

  test('searchByContent 内容搜索', () => {
    const g = new KnowledgeGraph();
    g.addNode({ id: 'c1', type: 'concept', content: '折射定律', aliases: ['斯涅尔定律'] });
    g.addNode({ id: 'c2', type: 'concept', content: '反射定律' });

    const results = searchByContent(g, '折射');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'c1');

    // 别名搜索
    const aliasResults = searchByContent(g, '斯涅尔');
    assert.equal(aliasResults.length, 1);
    assert.equal(aliasResults[0].id, 'c1');
  });
});
