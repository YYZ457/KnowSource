import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import {
  MemoryVectorStore,
  PersistedMemoryVectorStore,
  createVectorStore,
  setVectorStore,
  upsert,
  query
} from '../services/vector-store.js';

function makeTempFilePath() {
  return join(tmpdir(), `vector-store-test-${randomUUID()}.json`);
}

describe('MemoryVectorStore', () => {
  test('CRUD 与相似度查询', async () => {
    const store = new MemoryVectorStore();
    await store.upsert('vec1', [1, 0, 0], { label: 'A' });
    await store.upsert('vec2', [0, 1, 0], { label: 'B' });
    await store.upsert('vec3', [0.9, 0.1, 0], { label: 'C' });

    const results = await store.query([1, 0, 0], 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'vec1');
    assert.ok(results[0].score > results[1].score);

    await store.delete('vec1');
    assert.equal(await store.size(), 2);

    await store.clear();
    assert.equal(await store.size(), 0);
  });
});

describe('PersistedMemoryVectorStore', () => {
  const filePaths = [];

  function registerFile(path) {
    filePaths.push(path);
    return path;
  }

  after(() => {
    for (const p of filePaths) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test('CRUD 与相似度查询', async () => {
    const filePath = registerFile(makeTempFilePath());
    const store = new PersistedMemoryVectorStore({ filePath });

    await store.upsert('vec1', [1, 0, 0], { label: 'A' });
    await store.upsert('vec2', [0, 1, 0], { label: 'B' });
    await store.upsert('vec3', [0.9, 0.1, 0], { label: 'C' });

    const results = await store.query([1, 0, 0], 2);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'vec1');
    assert.ok(results[0].score > results[1].score);

    const got = await store.get('vec2');
    assert.equal(got.id, 'vec2');
    assert.deepEqual(got.vec, [0, 1, 0]);

    await store.delete('vec1');
    assert.equal(await store.size(), 2);

    await store.clear();
    assert.equal(await store.size(), 0);
  });

  test('更新向量后索引同步', async () => {
    const filePath = registerFile(makeTempFilePath());
    const store = new PersistedMemoryVectorStore({ filePath });

    await store.upsert('a', [1, 0, 0]);
    await store.upsert('a', [0, 1, 0]);

    const results = await store.query([0, 1, 0], 1);
    assert.equal(results[0].id, 'a');
    assert.ok(results[0].score > 0.99);
  });

  test('持久化与重新加载', async () => {
    const filePath = registerFile(makeTempFilePath());
    const store1 = new PersistedMemoryVectorStore({ filePath });
    await store1.upsert('p1', [1, 0, 0], { tag: 'x' });
    await store1.upsert('p2', [0, 1, 0], { tag: 'y' });

    // 重新实例化，验证从磁盘加载
    const store2 = new PersistedMemoryVectorStore({ filePath });
    assert.equal(await store2.size(), 2);

    const results = await store2.query([1, 0, 0], 1);
    assert.equal(results[0].id, 'p1');
    assert.equal(results[0].meta.tag, 'x');
  });

  test('Top-K 与暴力搜索结果一致', async () => {
    const filePath = registerFile(makeTempFilePath());
    const store = new PersistedMemoryVectorStore({ filePath });

    const dim = 16;
    const vectors = [];
    for (let i = 0; i < 50; i++) {
      const vec = Array.from({ length: dim }, () => Math.random() - 0.5);
      const id = `v${i}`;
      vectors.push({ id, vec });
      await store.upsert(id, vec);
    }

    const queryVec = vectors[0].vec;

    const bruteForce = vectors
      .map(({ id, vec }) => ({ id, score: cosineSimilarity(queryVec, vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => r.id);

    const results = await store.query(queryVec, 5);
    const resultIds = results.map(r => r.id);

    assert.deepEqual(resultIds, bruteForce);
    for (const r of results) {
      assert.ok(r.score >= -1 && r.score <= 1);
    }
  });

  test('createVectorStore 工厂与全局 API', async () => {
    const filePath = registerFile(makeTempFilePath());
    const store = createVectorStore('persistent', { filePath });
    setVectorStore(store);

    await upsert('g1', [1, 0, 0]);
    await upsert('g2', [0, 1, 0]);
    const results = await query([1, 0, 0], 1);
    assert.equal(results[0].id, 'g1');

    // reset to memory to avoid side effects
    setVectorStore(new MemoryVectorStore());
  });
});

function cosineSimilarity(v1, v2) {
  if (v1.length !== v2.length) return 0;
  let dot = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}
