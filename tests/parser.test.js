import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('core/parser 模块', () => {
  test('可在 Node 环境中导入并导出所需 API', async () => {
    const parser = await import('../core/parser/index.js');
    assert.ok(typeof parser.parsePDF === 'function', 'parsePDF 必须是函数');
    assert.ok(typeof parser.parseWord === 'function', 'parseWord 必须是函数');
    assert.ok(typeof parser.ocrImage === 'function', 'ocrImage 必须是函数');
    assert.ok(typeof parser.terminateOcrWorker === 'function', 'terminateOcrWorker 必须是函数');
    assert.ok(typeof parser.mergePageContent === 'function', 'mergePageContent 必须是函数');
    assert.ok(typeof parser.extractTextBlocksFromPage === 'function', 'extractTextBlocksFromPage 必须是函数');
  });

  test('mergePageContent 按 Y 坐标从上到下合并文字块与图片 OCR 文本', async () => {
    const { mergePageContent } = await import('../core/parser/index.js');

    // 模拟一页内容：顶部文字、中间图片、底部文字
    const textBlocks = [
      { y: 700, text: '顶部文字' },
      { y: 100, text: '底部文字' }
    ];
    const pageImages = [
      { centerY: 400, dataUrl: 'data:image/png;base64,abc', width: 100, height: 50 }
    ];

    const mockOcr = async (dataUrl) => {
      assert.equal(dataUrl, 'data:image/png;base64,abc');
      return '图片中的文字';
    };

    const result = await mergePageContent(textBlocks, pageImages, () => {}, mockOcr);
    const lines = result.split('\n');

    assert.equal(lines[0], '顶部文字');
    assert.equal(lines[1], '图片中的文字');
    assert.equal(lines[2], '底部文字');
  });

  test('extractTextBlocksFromPage 按 Y 坐标返回文本块', async () => {
    const { extractTextBlocksFromPage } = await import('../core/parser/index.js');

    // 模拟 pdfjs-dist textContent：Y 坐标向上递增，所以 Y=200 在 Y=100 上方
    const textContent = {
      items: [
        { str: '第二行', transform: [10, 0, 0, 10, 0, 100], width: 40, height: 10 },
        { str: '第一行', transform: [10, 0, 0, 10, 0, 200], width: 40, height: 10 }
      ]
    };

    const blocks = extractTextBlocksFromPage(textContent, 500, 800);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].text, '第一行');
    assert.equal(blocks[0].y, 200);
    assert.equal(blocks[1].text, '第二行');
    assert.equal(blocks[1].y, 100);
  });
});
