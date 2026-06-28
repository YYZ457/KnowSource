import { test, describe } from 'node:test';
import assert from 'node:assert';
import { KnowledgeGraph, buildCrossLinks } from '../core/graph/index.js';
import { runPipeline } from '../core/pipeline/index.js';

describe('跨文档 L1 子树感知连接 (core/graph/crosslink)', () => {
  test('子树共享 entity 时 L1 标题应建立 cross-link', () => {
    const g = new KnowledgeGraph();

    // 文档 A：L1 标题及其子 entity
    g.addNode({ id: 'h_a1', type: 'heading', content: '光学基础', source: { docId: 'docA' }, meta: { level: 1 } });
    g.addNode({ id: 'e_shared', type: 'entity', content: '折射定律', source: { docId: 'docA' } });
    g.addEdge({ from: 'h_a1', to: 'e_shared', type: 'contains' });

    // 文档 B：L1 标题不同，但子 entity 与 A 共享（模拟概念合并后的同一节点）
    g.addNode({ id: 'h_b1', type: 'heading', content: '光的传播', source: { docId: 'docB' }, meta: { level: 1 } });
    g.addEdge({ from: 'h_b1', to: 'e_shared', type: 'contains' });

    const result = buildCrossLinks(g, { threshold: 0.3 });

    const l1Link = Array.from(g.edges.values()).find(e =>
      e.type === 'cross-link' &&
      ((e.from === 'h_a1' && e.to === 'h_b1') || (e.from === 'h_b1' && e.to === 'h_a1'))
    );
    assert.ok(l1Link, '子树共享 entity 时应在 L1 标题间建立 cross-link');
    assert.equal(l1Link.evidence.method, 'sharedDescendants');
  });

  test('子树之间存在边时 L1 标题应建立 cross-link', () => {
    const g = new KnowledgeGraph();

    // 文档 A
    g.addNode({ id: 'h_a1', type: 'heading', content: '电磁学', source: { docId: 'docA' }, meta: { level: 1 } });
    g.addNode({ id: 'e_a1', type: 'entity', content: '电场', source: { docId: 'docA' } });
    g.addEdge({ from: 'h_a1', to: 'e_a1', type: 'contains' });

    // 文档 B
    g.addNode({ id: 'h_b1', type: 'heading', content: '量子物理', source: { docId: 'docB' }, meta: { level: 1 } });
    g.addNode({ id: 'e_b1', type: 'entity', content: '光子', source: { docId: 'docB' } });
    g.addEdge({ from: 'h_b1', to: 'e_b1', type: 'contains' });

    // 子级 entity 之间存在语义/共现边
    g.addEdge({ from: 'e_a1', to: 'e_b1', type: 'semantic', weight: 0.6 });

    const result = buildCrossLinks(g, { threshold: 0.3 });

    const l1Link = Array.from(g.edges.values()).find(e =>
      e.type === 'cross-link' &&
      ((e.from === 'h_a1' && e.to === 'h_b1') || (e.from === 'h_b1' && e.to === 'h_a1'))
    );
    assert.ok(l1Link, '子树之间存在边时应在 L1 标题间建立 cross-link');
    assert.equal(l1Link.evidence.method, 'subtreeEdges');
  });

  test('已存在 L1 cross-link 时不应重复创建', () => {
    const g = new KnowledgeGraph();

    g.addNode({ id: 'h_a1', type: 'heading', content: '基础概念', source: { docId: 'docA' }, meta: { level: 1 } });
    g.addNode({ id: 'h_b1', type: 'heading', content: '基本概念', source: { docId: 'docB' }, meta: { level: 1 } });
    g.addEdge({ from: 'h_a1', to: 'h_b1', type: 'cross-link', weight: 0.8, evidence: { method: 'textSimilarity' } });

    const result = buildCrossLinks(g, { threshold: 0.3 });

    const crossLinks = Array.from(g.edges.values()).filter(e =>
      e.type === 'cross-link' &&
      ((e.from === 'h_a1' && e.to === 'h_b1') || (e.from === 'h_b1' && e.to === 'h_a1'))
    );
    assert.equal(crossLinks.length, 1, '不应重复创建已有的 L1 cross-link');
  });

  test('sourceDocIds === targetDocIds 时应在同一集合内建立 cross-link', () => {
    const g = new KnowledgeGraph();

    g.addNode({ id: 'docA', type: 'document', content: '医学微生物学大纲', source: { docId: 'docA' } });
    g.addNode({ id: 'h_a1', type: 'heading', content: '细菌的形态与结构', source: { docId: 'docA' }, meta: { level: 1 } });
    g.addNode({ id: 'e_a1', type: 'entity', content: '金黄色葡萄球菌', source: { docId: 'docA' } });
    g.addEdge({ from: 'docA', to: 'h_a1', type: 'contains' });

    g.addNode({ id: 'docB', type: 'document', content: '医学微生物学应试指南', source: { docId: 'docB' } });
    g.addNode({ id: 'h_b1', type: 'heading', content: '细菌结构', source: { docId: 'docB' }, meta: { level: 1 } });
    g.addNode({ id: 'e_b1', type: 'entity', content: '金黄色葡萄球菌', source: { docId: 'docB' } });
    g.addEdge({ from: 'docB', to: 'h_b1', type: 'contains' });

    const ids = ['docA', 'docB'];
    const result = buildCrossLinks(g, { threshold: 0.25, sourceDocIds: ids, targetDocIds: ids });

    const crossLinks = Array.from(g.edges.values()).filter(e => e.type === 'cross-link');
    assert.ok(crossLinks.length >= 1, '多选重建时应在选中文档间建立 cross-link');
  });

  test('文档名高度相似时应建立 cross-link', () => {
    const g = new KnowledgeGraph();

    g.addNode({ id: 'docA', type: 'document', content: '医学微生物学理论教学大纲（42h）', source: { docId: 'docA' } });
    g.addNode({ id: 'h_a1', type: 'heading', content: '细菌学总论', source: { docId: 'docA' }, meta: { level: 1 } });
    g.addEdge({ from: 'docA', to: 'h_a1', type: 'contains' });

    g.addNode({ id: 'docB', type: 'document', content: '医学微生物学应试指南', source: { docId: 'docB' } });
    g.addNode({ id: 'h_b1', type: 'heading', content: '细菌的形态与结构', source: { docId: 'docB' }, meta: { level: 1 } });
    g.addEdge({ from: 'docB', to: 'h_b1', type: 'contains' });

    const result = buildCrossLinks(g, { threshold: 0.25 });

    const crossLinks = Array.from(g.edges.values()).filter(e => e.type === 'cross-link');
    assert.ok(crossLinks.length >= 1, '文档名高度相似时应建立 cross-link');
  });
});

describe('跨文档 L1 子树感知连接 (core/pipeline)', () => {
  test('runPipeline 对多文档生成子树感知的 cross-link', async () => {
    const files = [
      {
        name: 'docA.md',
        content: '# 机器学习\n\n## 监督学习\n监督学习使用标注数据训练模型。',
        type: 'markdown'
      },
      {
        name: 'docB.md',
        content: '# 机器学习应用\n\n## 分类算法\n分类算法是监督学习的一种。',
        type: 'markdown'
      }
    ];

    const result = await runPipeline(files, {});
    assert.ok(result.graph, '必须返回 graph');
    assert.ok(Array.isArray(result.graph.edges), 'graph.edges 必须是数组');

    const l1Nodes = result.graph.nodes.filter(n => n.type === 'heading' && n.meta?.level === 1);
    assert.ok(l1Nodes.length >= 2, '应至少有两个 L1 heading 节点');

    const crossLinks = result.graph.edges.filter(e => e.type === 'cross-link');
    // L1 标题“机器学习”与“机器学习应用”高度相似，应产生 cross-link
    assert.ok(crossLinks.length > 0, '多文档间应存在 cross-link 边');
  });
});
