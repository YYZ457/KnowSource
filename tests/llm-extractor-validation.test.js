import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateExtractedNodesAndEdges } from '../core/graph/llm-extractor.js';

describe('validateExtractedNodesAndEdges', () => {
  test('保留完整有效的节点和边', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: '  折射定律  ', source: { docId: 'd1' }, weight: 1.2 },
      { id: 'n2', type: 'entity', content: '斯涅尔定律', source: { docId: 'd1' }, weight: 0.8 }
    ];
    const edges = [
      { from: 'n1', to: 'n2', type: 'related', weight: 0.9 }
    ];
    const result = validateExtractedNodesAndEdges(nodes, edges, 'd1');

    assert.equal(result.validNodes.length, 2);
    assert.equal(result.validEdges.length, 1);
    assert.equal(result.droppedCount, 0);
    assert.equal(result.errors.length, 0);

    assert.equal(result.validNodes[0].content, '折射定律');
    assert.equal(result.validNodes[0].type, 'concept');
    assert.equal(result.validNodes[0].source.docId, 'd1');
  });

  test('content 自动 trim，非字符串对象被 JSON.stringify', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: ['a', 'b'], source: { docId: 'd1' } }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes[0].content, '["a","b"]');
  });

  test('weight 非数字时默认 0.5', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: 'x', source: { docId: 'd1' }, weight: 'heavy' }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes[0].weight, 0.5);
  });

  test('重复 id 只保留第一个', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: 'first', source: { docId: 'd1' } },
      { id: 'n1', type: 'entity', content: 'second', source: { docId: 'd1' } }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes.length, 1);
    assert.equal(result.validNodes[0].content, 'first');
    assert.equal(result.droppedCount, 1);
  });

  test('非法节点 type 归一化为 concept', () => {
    const nodes = [
      { id: 'n1', type: 'method', content: '贝叶斯公式', source: { docId: 'd1' } }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes[0].type, 'concept');
  });

  test('缺少 source 时补充 sourceDocId', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: 'x', weight: 1 }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes[0].source.docId, 'd1');
  });

  test('content 缺失时从 label/keyword 推导', () => {
    const nodes = [
      { id: 'n1', type: 'concept', label: '  斯涅尔定律  ', source: { docId: 'd1' } }
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes[0].content, '斯涅尔定律');
  });

  test('缺少必要字段的节点被丢弃', () => {
    const nodes = [
      { id: 'n1', type: 'concept', source: { docId: 'd1' } }, // 缺少 content
      { type: 'concept', content: 'no id', source: { docId: 'd1' } }, // 缺少 id
      { id: 'n3', type: 'concept', content: '', source: { docId: 'd1' } } // 空 content
    ];
    const result = validateExtractedNodesAndEdges(nodes, [], 'd1');
    assert.equal(result.validNodes.length, 0);
    assert.equal(result.droppedCount, 3);
  });

  test('悬空边和非法 type 边被丢弃', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: 'x', source: { docId: 'd1' } }
    ];
    const edges = [
      { from: 'n1', to: 'n2', type: 'related' }, // to 不存在
      { from: 'n1', to: 'n1', type: 'unknown-type' }, // 非法 type
      { from: '', to: 'n1', type: 'related' } // 空 from
    ];
    const result = validateExtractedNodesAndEdges(nodes, edges, 'd1');
    assert.equal(result.validEdges.length, 0);
    assert.equal(result.droppedCount, 3);
  });

  test('边 weight 非数字时默认 0.5', () => {
    const nodes = [
      { id: 'n1', type: 'concept', content: 'a', source: { docId: 'd1' } },
      { id: 'n2', type: 'concept', content: 'b', source: { docId: 'd1' } }
    ];
    const edges = [
      { from: 'n1', to: 'n2', type: 'related', weight: 'high' }
    ];
    const result = validateExtractedNodesAndEdges(nodes, edges, 'd1');
    assert.equal(result.validEdges[0].weight, 0.5);
  });

  test('nodes 或 edges 不是数组时安全返回', () => {
    const result = validateExtractedNodesAndEdges(null, null, 'd1');
    assert.equal(result.validNodes.length, 0);
    assert.equal(result.validEdges.length, 0);
    assert.ok(result.errors.length >= 1);
  });
});
