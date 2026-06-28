import { test, describe } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { parseHandler } from '../services/api/handlers/parse.js';
import { extractHandler } from '../services/api/handlers/extract.js';
import { graphBuildHandler } from '../services/api/handlers/graph-build.js';
import { graphQueryHandler } from '../services/api/handlers/graph-query.js';
import { matchHandler } from '../services/api/handlers/match.js';
import { getUploadFilePath } from '../services/storage.js';

describe('POST /parse', () => {
  test('解析 Markdown 文档', async () => {
    const result = await parseHandler({
      name: 'test.md',
      content: '# 光学\n## 折射定律\n折射定律描述光线偏折规律。',
      type: 'markdown'
    });
    assert.ok(result.docId, '必须有 docId');
    assert.equal(result.type, 'markdown');
    assert.ok(Array.isArray(result.sections));
    assert.ok(result.rawText);
    assert.ok(result.meta.parsedAt);
  });

  test('自动检测类型', async () => {
    const result = await parseHandler({ name: 'notes.py', content: 'print("hello")' });
    assert.equal(result.type, 'code');
  });

  test('解析浏览器 OCR 后的 PDF（pdf-extracted）', async () => {
    const result = await parseHandler({
      name: 'scanned.pdf',
      content: {
        text: '扫描版 PDF 的 OCR 文本\n--- 第1页 ---\n这是图片中的文字。',
        rawBase64: 'ZmFrZS1iYXNlNjQ=',
        totalPages: 1,
        isScanned: true
      },
      type: 'pdf-extracted'
    });
    assert.ok(result.docId, '必须有 docId');
    assert.equal(result.type, 'pdf-extracted');
    assert.equal(result.meta.totalPages, 1);
    assert.equal(result.meta.isScanned, true);
    assert.ok(result.rawText.includes('OCR 文本'), 'rawText 应包含 OCR 文本');
    // 原始 base64 应已写入 uploads 目录，文档对象不再保留 rawBase64
    assert.ok(result.filePath, '应有 filePath');
    assert.equal(result.fileSize, 11, 'fileSize 应为解码后字节数');
    assert.ok(!result.rawBase64, '文档对象不应再保留 rawBase64');
    assert.ok(existsSync(getUploadFilePath(result.docId)), 'uploads 目录应存在原始二进制文件');
    assert.ok(Array.isArray(result.sections));
  });
});

describe('POST /extract', () => {
  test('抽取关键词', async () => {
    const result = await extractHandler({
      text: '折射定律是光学的基本定律，描述光线在不同介质中的偏折。',
      topN: 5
    });
    assert.ok(Array.isArray(result.entities));
    assert.ok(result.entities.length > 0, '应有关键词');
    assert.ok(result.entities[0].term);
    assert.ok(result.entities[0].score > 0);
  });

  test('空文本返回空', async () => {
    const result = await extractHandler({ text: '' });
    assert.equal(result.entities.length, 0);
  });
});

describe('POST /graph/build', () => {
  test('构建图谱', async () => {
    const result = await graphBuildHandler({
      documents: [
        { name: 'a.md', content: '折射定律光学介质' },
        { name: 'b.md', content: '反射定律光学镜面' }
      ]
    });
    assert.ok(result.nodes, '必须有 nodes');
    assert.ok(result.edges, '必须有 edges');
    assert.ok(result.stats, '必须有 stats');
    assert.ok(result.stats.nodeCount > 0, '至少一个节点');
  });
});

describe('GET /graph/query', () => {
  test('stats 查询', async () => {
    const result = await graphQueryHandler({ action: 'stats' });
    assert.ok(result.stats);
    assert.ok(result.stats.nodeCount >= 0);
  });

  test('search 查询', async () => {
    const result = await graphQueryHandler({ action: 'search', query: '折射' });
    assert.ok(Array.isArray(result.results));
  });

  test('未知 action 报错', async () => {
    const result = await graphQueryHandler({ action: 'unknown' });
    assert.ok(result.error);
  });
});

describe('POST /match', () => {
  test('hybrid 匹配', async () => {
    // 先解析文档
    await parseHandler({ name: 'optics.md', content: '折射定律光学介质偏折', type: 'markdown' });

    const result = await matchHandler({ query: '折射', strategy: 'hybrid', topN: 3 });
    assert.ok(result.results, '必须有 results');
    assert.equal(result.strategy, 'hybrid');
  });

  test('无 query 报错', async () => {
    const result = await matchHandler({});
    assert.ok(result.error);
  });
});
