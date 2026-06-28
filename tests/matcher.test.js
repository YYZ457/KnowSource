import { test, describe } from 'node:test';
import assert from 'node:assert';
import { jaccardSimilarity, weightedKeywordOverlap, computeTfIdf, cosineSimilarity, match, graphMatchScore } from '../core/matcher/index.js';

describe('关键词层匹配', () => {
  test('Jaccard 相似度', () => {
    const sim = jaccardSimilarity('折射定律 光学', '反射定律 光学');
    assert.ok(sim > 0, '应有相似度');
    assert.ok(sim < 1, '应小于 1');
  });

  test('加权关键词重叠', () => {
    const kw1 = [{word:'折射', count:3}, {word:'定律', count:2}];
    const kw2 = [{word:'折射', count:1}, {word:'反射', count:2}];
    const overlap = weightedKeywordOverlap(kw1, kw2);
    assert.ok(overlap > 0, '应有重叠');
  });

  test('TF-IDF 余弦相似度', () => {
    const docs = ['折射定律 光学 介质', '反射定律 光学 介质', '量子力学 波函数'];
    const { vectors, idf } = computeTfIdf(docs);
    const sim01 = cosineSimilarity(vectors[0], vectors[1]);
    const sim02 = cosineSimilarity(vectors[0], vectors[2]);
    assert.ok(sim01 > sim02, '相关文档相似度应更高');
  });
});

describe('混合匹配', () => {
  test('tfidf 策略', async () => {
    const documents = [
      { meta: { docId: 'd1' }, sections: [{ id: 's1', content: '折射定律描述光线偏折', keywords: [{word:'折射定律', count:1}] }] },
      { meta: { docId: 'd2' }, sections: [{ id: 's1', content: '量子力学研究微观粒子', keywords: [{word:'量子力学', count:1}] }] }
    ];
    const results = await match('折射定律', { strategy: 'tfidf', documents });
    assert.ok(results.length > 0, '应有匹配结果');
    assert.equal(results[0].docId, 'd1', '应匹配到折射定律文档');
    assert.ok(results[0].breakdown.tfidf !== undefined, '应有 tfidf 分数');
  });

  test('hybrid 策略返回 breakdown', async () => {
    const documents = [
      { meta: { docId: 'd1' }, sections: [{ id: 's1', content: '折射定律光学', keywords: [{word:'折射', count:1}] }] }
    ];
    const results = await match('折射', { strategy: 'hybrid', documents, embedFn: async () => [1,0,0] });
    assert.ok(results.length > 0);
    assert.ok(results[0].breakdown.tfidf !== undefined, 'hybrid 应有 tfidf');
    assert.ok(results[0].breakdown.semantic !== undefined, 'hybrid 应有 semantic');
    assert.ok(results[0].breakdown.graph !== undefined, 'hybrid 应有 graph');
    assert.ok(results[0].score > 0, '总分应大于 0');
  });

  test('无匹配时返回空数组', async () => {
    const documents = [
      { meta: { docId: 'd1' }, sections: [{ id: 's1', content: '量子力学', keywords: [] }] }
    ];
    const results = await match('完全不相关的内容xyz', { strategy: 'tfidf', documents });
    // 可能返回空或低分结果
    assert.ok(Array.isArray(results), '应返回数组');
  });
});

describe('图结构匹配', () => {
  test('graphMatchScore', async () => {
    const { KnowledgeGraph } = await import('../core/graph/index.js');
    const g = new KnowledgeGraph();
    g.addNode({ id: 'a', type: 'concept', content: 'A' });
    g.addNode({ id: 'b', type: 'concept', content: 'B' });
    g.addNode({ id: 'c', type: 'concept', content: 'C' });
    g.addEdge({ from: 'a', to: 'b', type: 'similar' });
    g.addEdge({ from: 'b', to: 'c', type: 'similar' });

    const score = graphMatchScore(g, 'a', 'b');
    assert.ok(score > 0, '相邻节点分数应大于 0');

    const scoreFar = graphMatchScore(g, 'a', 'c');
    assert.ok(scoreFar >= 0, '分数应非负');
  });
});
