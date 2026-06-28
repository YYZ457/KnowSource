/**
 * 本地 DeepSeek 特异性评分示例
 * 运行：node scripts/test-specificity-deepseek.mjs
 * 要求：Ollama 已启动并拉取 deepseek-r1:7b
 *
 * 本脚本演示三个用法：
 * 1. 直接给 LLM 一组术语+小标题，让它判断特异性
 * 2. 用 extractKeyTermsWithMeta 从带标题的文本抽取术语并自动评分
 * 3. 用 runPipeline 处理一篇纯文本“文档”，观察最终实体节点的 specificity
 */

import { OllamaLLMProvider } from '../services/llm-provider.js';
import { scoreTermSpecificityWithLLM, extractKeyTermsWithMeta } from '../core/graph/llm-extractor.js';
import { runPipeline } from '../core/pipeline/index.js';

const MODEL = 'deepseek-r1:7b';
const BASE_URL = 'http://127.0.0.1:11434';

function createProvider() {
  return new OllamaLLMProvider({ baseUrl: BASE_URL, model: MODEL });
}

async function example1_directScoring() {
  console.log('\n========== 示例 1：直接对术语+小标题做特异性评分 ==========');
  const provider = createProvider();
  const termsWithContext = [
    { term: '概率', heading: '1.1 随机现象与概率' },
    { term: '条件概率', heading: '1.3 条件概率与独立性' },
    { term: '全概率公式', heading: '1.4 全概率公式与贝叶斯公式' },
    { term: '贝叶斯公式', heading: '1.4 全概率公式与贝叶斯公式' },
    { term: '数学期望', heading: '2.1 随机变量的数学期望' },
    { term: '方差', heading: '2.2 方差与协方差' },
    { term: '正态分布', heading: '2.5 常见连续型分布' },
    { term: '函数', heading: '附录 A 预备知识' },
    { term: '方法', heading: '3.1 参数估计方法' },
    { term: '中心极限定理', heading: '3.3 大数定律与中心极限定理' }
  ];

  const map = await scoreTermSpecificityWithLLM(termsWithContext, provider, {
    specificityThreshold: 4,
    specificityBatchSize: 40,
    specificityTimeoutMs: 120000
  });

  console.log('术语\t\t\t小标题\t\t\t\t\tspecificity\tisGeneric');
  for (const { term, heading } of termsWithContext) {
    const info = map.get(term) || {};
    console.log(`${pad(term, 14)}\t${pad(heading, 32)}\t${info.specificity ?? '-'}\t\t${info.isGeneric ?? '-'}`);
  }
}

async function example2_extractAndScore() {
  console.log('\n========== 示例 2：抽取带标题文本的术语并自动评分 ==========');
  const provider = createProvider();
  const text = `
第一章 概率论基础
1.1 随机现象与概率
概率论研究随机现象的统计规律。概率是度量随机事件发生可能性的数值。

1.2 样本空间与随机事件
样本空间是随机试验所有可能结果组成的集合。随机事件是样本空间的子集。

1.3 条件概率与独立性
条件概率描述在已知某事件发生的条件下，另一事件发生的概率。若两事件互不影响，则称它们相互独立。

1.4 全概率公式与贝叶斯公式
全概率公式用于计算复杂事件的概率。贝叶斯公式则用于根据新信息更新概率判断。

第二章 随机变量及其分布
2.1 离散型随机变量
随机变量是定义在样本空间上的函数。离散型随机变量取有限或可列个值。

2.2 常见离散分布
二项分布与泊松分布是两种重要的离散型分布。

2.3 连续型随机变量与正态分布
正态分布是应用最广泛的连续型分布，其概率密度函数呈钟形曲线。
`.trim();

  const result = await extractKeyTermsWithMeta(text, {
    provider,
    splitMode: 'heading',
    maxTerms: 20,
    enableSpecificityScoring: true,
    specificityThreshold: 4,
    specificityBatchSize: 40,
    specificityTimeoutMs: 120000
  });

  console.log(`使用 LLM：${result.meta.usedLLM}，模型：${result.meta.model}`);
  console.log(`分块数：${result.meta.chunkCount}，原始术语：${result.meta.totalRawTerms}，去重后：${result.meta.uniqueAfterDedup}`);
  console.log('术语\t\t\t分数\t\tspecificity\tisGeneric');
  for (const t of result.terms) {
    console.log(`${pad(t.term, 18)}\t${pad(String(t.score), 8)}\t${t.specificity ?? '-'}\t\t${t.isGeneric ?? '-'}`);
  }
}

async function example3_pipeline() {
  console.log('\n========== 示例 3：runPipeline 处理纯文本文档 ==========');
  const provider = createProvider();
  const text = `
第三章 参数估计
3.1 点估计
点估计是用样本统计量估计总体参数的方法。矩估计和最大似然估计是两种常用的点估计方法。

3.2 估计量的评价标准
无偏性、有效性和一致性是评价估计量优劣的主要标准。无偏估计的期望等于被估参数。

3.3 区间估计
区间估计给出参数的一个置信区间。置信水平反映了区间包含真值的可靠程度。

第四章 假设检验
4.1 假设检验的基本思想
假设检验首先提出原假设和备择假设，然后根据样本数据判断是否拒绝原假设。

4.2 正态总体下的检验
Z 检验和 t 检验是常见的正态总体参数检验方法。
`.trim();

  const files = [{
    name: '统计学期中复习.txt',
    content: text,
    type: 'text/plain',
    docId: 'doc_001',
    lastModified: Date.now()
  }];

  const result = await runPipeline(files, {
    provider,
    extractOptions: {
      maxTerms: 25,
      splitMode: 'heading',
      enableSpecificityScoring: true,
      specificityThreshold: 4,
      specificityBatchSize: 40,
      specificityTimeoutMs: 120000
    },
    onProgress: (p) => {
      console.log(`[进度] ${p.stage} ${p.percent}%: ${p.log}`);
    }
  });

  const entityNodes = result.graph.nodes.filter(n => n.type === 'entity');
  console.log(`最终图谱：${result.graph.nodes.length} 节点，${result.graph.edges.length} 边，其中实体 ${entityNodes.length} 个`);
  console.log('实体节点\t\t\t类型\t\t\tspecificity\tisGeneric');
  for (const n of entityNodes.slice(0, 20)) {
    const meta = n.meta || {};
    console.log(`${pad(n.content, 22)}\t${pad(n.type, 12)}\t${meta.specificity ?? '-'}\t\t${meta.isGeneric ?? '-'}`);
  }
}

function pad(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len - 1) + '…' : s + ' '.repeat(len - s.length);
}

async function main() {
  console.log(`使用本地模型：${MODEL} @ ${BASE_URL}`);
  try {
    await example1_directScoring();
    await example2_extractAndScore();
    await example3_pipeline();
    console.log('\n全部示例运行完成。');
  } catch (err) {
    console.error('\n运行失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
