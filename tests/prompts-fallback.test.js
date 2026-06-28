/**
 * TASK_DISABLED 禁用回退逻辑集成测试
 *
 * 覆盖关键路径：LLM 任务被用户禁用后，各层调用方应捕获 code=TASK_DISABLED 错误并回退到规则逻辑。
 * - core/graph/llm-extractor.js: extractKeyTermsWithMeta 禁用 doc-type-detect 后回退规则抽取
 * - core/graph/full-extract.js: extractFullGraphFromDocument 禁用 full-graph-extract 后抛 TASK_DISABLED
 * - core/pipeline/index.js: 端到端管线禁用 full-graph-extract 后回退分步管线
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { extractKeyTermsWithMeta } from '../core/graph/llm-extractor.js';
import { extractFullGraphFromDocument } from '../core/graph/full-extract.js';
import { runPipeline } from '../core/pipeline/index.js';
import { setDisabledTasks, resetAllOverrides } from '../core/prompts/registry.js';
import { clearLog } from '../core/prompts/logger.js';

beforeEach(() => {
  resetAllOverrides();
  setDisabledTasks([]);
  clearLog();
});

/** 构造云端 mock provider（qualityLevel=strong，会被识别为云端模型） */
function cloudProvider(completeImpl) {
  return {
    name: 'openai-compatible',
    vendor: 'openai',
    model: 'gpt-4o-mini',
    capabilities: { qualityLevel: 'strong', contextWindow: 200000, supportsJsonMode: true },
    complete: completeImpl || (async () => '{"docType":"教材","domain":"物理"}')
  };
}

const SAMPLE_TEXT = '# 光学\n\n## 折射定律\n折射定律描述光线从一种介质进入另一种介质时的偏折。' +
  '斯涅尔定律是折射定律的数学表达。全反射发生在光线从光密介质射向光疏介质且入射角大于临界角时。' +
  '反射定律描述光线遇到界面时反射的规律。光的波动性可通过干涉和衍射现象验证。';

describe('llm-extractor: 禁用 doc-type-detect 后回退规则抽取', () => {
  test('禁用 doc-type-detect 时 detectDocumentType 内部降级，不向上抛 TASK_DISABLED', async () => {
    // doc-type-detect 被禁用后，runLLMTask 抛 TASK_DISABLED，但 detectDocumentType
    // 内部会捕获该错误并返回默认值，不应向上传播到 extractKeyTermsWithMeta 的外层 catch。
    // 这里让 provider 在后续 cloud-term-extract 调用时抛普通错误，以触发外层"LLM 调用失败"回退，
    // 从而证明 doc-type-detect 的禁用被内部吞掉（外层 fallbackReason 不是"已被禁用"）。
    const provider = cloudProvider(async () => { throw new Error('cloud-term-extract 调用失败'); });
    setDisabledTasks(['doc-type-detect']);

    const result = await extractKeyTermsWithMeta(SAMPLE_TEXT, { provider });

    // 函数正常返回（未向上抛 TASK_DISABLED），并回退到规则抽取
    assert.ok(Array.isArray(result.terms), '应返回术语数组');
    assert.ok(result.terms.length > 0, '规则抽取应产出术语');
    assert.equal(result.meta.usedLLM, false, '禁用+失败后 usedLLM 应为 false');
    // 关键：doc-type-detect 的禁用被内部捕获，外层 fallbackReason 不应是"已被禁用"
    assert.notEqual(
      result.meta.fallbackReason,
      'LLM 任务已被用户禁用',
      'doc-type-detect 禁用应被 detectDocumentType 内部降级，不应传播为外层禁用回退'
    );
    assert.equal(result.meta.fallbackReason, 'LLM 调用失败');
  });

  test('未禁用时云端 provider 正常进入 LLM 路径（对照组）', async () => {
    let completeCalls = 0;
    const provider = cloudProvider(async () => {
      completeCalls++;
      // 返回空的术语抽取结果，触发 LLM 路径但无术语，最终回退规则
      return '{"terms":[],"docType":"教材","domain":"物理"}';
    });
    // 不禁用任何任务
    const result = await extractKeyTermsWithMeta(SAMPLE_TEXT, { provider });
    assert.ok(completeCalls > 0, '未禁用时 provider.complete 应被调用');
    // fallbackReason 不应是"已被禁用"（可能是空结果回退或调用失败回退）
    assert.notEqual(result.meta.fallbackReason, 'LLM 任务已被用户禁用');
  });

  test('禁用 cloud-term-extract 时外层捕获 TASK_DISABLED 并回退规则', async () => {
    // cloud-term-extract 的 TASK_DISABLED 不被内部捕获，会传播到外层 catch，
    // 触发 fallbackReason='LLM 任务已被用户禁用' 的规则回退。
    let completeCalls = 0;
    const provider = cloudProvider(async () => {
      completeCalls++;
      // doc-type-detect 未禁用，会调用 provider；返回合法 docType 响应
      return '{"docType":"教材","domain":"物理"}';
    });
    setDisabledTasks(['cloud-term-extract']);

    const result = await extractKeyTermsWithMeta(SAMPLE_TEXT, { provider });
    assert.ok(Array.isArray(result.terms), '应返回术语数组');
    assert.equal(result.meta.usedLLM, false, '术语抽取被禁用，usedLLM 应为 false');
    assert.equal(result.meta.fallbackReason, 'LLM 任务已被用户禁用');
    assert.ok(result.meta.error.includes('已被禁用'), 'error 应包含禁用信息');
    // doc-type-detect 调用了 provider（未禁用），所以 complete 至少被调用一次
    assert.ok(completeCalls > 0, 'doc-type-detect 未禁用，provider 应被调用');
  });
});

describe('full-extract: 禁用 full-graph-extract 后抛 TASK_DISABLED', () => {
  test('禁用 full-graph-extract 时 extractFullGraphFromDocument 抛 TASK_DISABLED', async () => {
    let completeCalls = 0;
    const provider = cloudProvider(async () => { completeCalls++; return '{}'; });
    setDisabledTasks(['full-graph-extract']);

    await assert.rejects(
      extractFullGraphFromDocument(SAMPLE_TEXT, provider),
      (err) => {
        assert.equal(err.code, 'TASK_DISABLED', '应抛出 TASK_DISABLED 错误');
        assert.equal(err.taskId, 'full-graph-extract');
        return true;
      }
    );
    assert.equal(completeCalls, 0, '禁用任务不应调用 provider.complete');
  });

  test('禁用 full-graph-extract 不影响其他任务的错误码语义', async () => {
    const provider = cloudProvider(async () => { throw new Error('网络超时'); });
    // 不禁用 full-graph-extract，而是让 provider 抛普通错误
    const err = await extractFullGraphFromDocument(SAMPLE_TEXT, provider).catch(e => e);
    assert.notEqual(err.code, 'TASK_DISABLED', 'provider 普通错误不应是 TASK_DISABLED');
    assert.match(err.message, /网络超时/);
  });
});

describe('pipeline: 端到端禁用 full-graph-extract 后回退分步管线', () => {
  test('短文档在禁用 full-graph-extract 后回退到 extractTerms + buildGraph', async () => {
    // mock 云端 provider：返回有效的全文抽取 JSON，但 full-graph-extract 被禁用，
    // 所以全文抽取会抛 TASK_DISABLED，管线应回退分步管线
    let completeCalls = 0;
    const provider = {
      name: 'openai-compatible',
      vendor: 'openai',
      model: 'gpt-4o-mini',
      capabilities: { qualityLevel: 'strong', contextWindow: 200000 },
      complete: async () => {
        completeCalls++;
        return JSON.stringify({
          headings: [{ title: '光学', level: 1, start: 0 }],
          entities: [{ term: '折射定律', specificity: 8, isGeneric: false, start: 0, heading: '光学', type: 'concept' }],
          relationships: []
        });
      }
    };
    setDisabledTasks(['full-graph-extract']);

    const progressCalls = [];
    const result = await runPipeline(
      [{ name: 'short.md', content: '# 光学\n\n' + SAMPLE_TEXT, type: 'markdown' }],
      {
        provider,
        extractOptions: { fullExtractEnabled: true, fullExtractMaxContextChars: 100000 },
        onProgress: (p) => progressCalls.push(p)
      }
    );

    // 管线应成功完成并产出图谱
    assert.ok(result.graph, '必须返回 graph');
    assert.ok(Array.isArray(result.graph.nodes), 'graph.nodes 必须是数组');
    assert.ok(result.graph.nodes.length > 0, '回退分步管线后应仍产出节点');

    // 关键：full-graph-extract 被禁用，应回退到分步管线，extractTerms 阶段应出现
    assert.ok(
      progressCalls.some(p => p.stage === 'extractTerms'),
      '禁用全文抽取后应回退到 extractTerms 阶段'
    );
    assert.ok(
      progressCalls.some(p => p.stage === 'buildGraph'),
      '应执行 buildGraph 阶段'
    );
    // provider 在分步管线中被调用（doc-type-detect / cloud-term-extract 等）
    assert.ok(completeCalls > 0, '分步管线应调用 provider');
  });

  test('不禁用时短文档应走 fullExtract 路径（对照组）', async () => {
    const provider = {
      name: 'openai-compatible',
      vendor: 'openai',
      model: 'gpt-4o-mini',
      capabilities: { qualityLevel: 'strong', contextWindow: 200000 },
      complete: async () => JSON.stringify({
        headings: [{ title: '光学', level: 1, start: 0 }],
        entities: [{ term: '折射定律', specificity: 8, isGeneric: false, start: 0, heading: '光学', type: 'concept' }],
        relationships: []
      })
    };
    // 不禁用
    const progressCalls = [];
    const result = await runPipeline(
      [{ name: 'short.md', content: '# 光学\n\n' + SAMPLE_TEXT, type: 'markdown' }],
      {
        provider,
        extractOptions: { fullExtractEnabled: true, fullExtractMaxContextChars: 100000 },
        onProgress: (p) => progressCalls.push(p)
      }
    );
    assert.ok(progressCalls.some(p => p.stage === 'fullExtract'), '未禁用时应走 fullExtract 阶段');
    assert.ok(result.graph.nodes.length > 0);
  });
});
