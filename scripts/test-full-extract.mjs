/**
 * 测试云端 LLM 全文一次性抽取
 * 运行：node scripts/test-full-extract.mjs
 */
import { readFileSync } from 'fs';
import { OpenAICompatibleLLMProvider } from '../services/llm-provider.js';
import { extractFullGraphFromDocument, canUseFullExtract, convertToGraph } from '../core/graph/full-extract.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DOCX_PATH = 'C:/Users/YANYZ/Desktop/医学微生物学理论教学大纲（42h）.docx';

function createProvider() {
  return new OpenAICompatibleLLMProvider({
    apiKey: API_KEY,
    model: MODEL,
    baseUrl: BASE_URL,
    vendor: 'deepseek'
  });
}

async function testParse() {
  console.log('========== 1. 解析 docx ==========');
  const buffer = readFileSync(DOCX_PATH);
  const mammothMod = await import('mammoth');
  const mammoth = mammothMod.default || mammothMod;
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value || '';
  const rawText = html
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h(\d)[^>]*>/gi, '\n\n')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  console.log(`解析成功：${rawText.length} 字符`);
  return rawText;
}

async function testFullExtract(text, provider) {
  console.log('\n========== 2. 检查是否支持全文抽取 ==========');
  const can = canUseFullExtract(provider, text.length, { maxContextChars: 60000 });
  console.log(`provider: ${provider.name}, model: ${provider.model}, quality: ${provider.capabilities?.qualityLevel}, contextWindow: ${provider.capabilities?.contextWindow}`);
  console.log(`canUseFullExtract: ${can}`);
  if (!can) {
    console.log('不支持全文抽取，退出');
    return null;
  }

  console.log('\n========== 3. 全文一次性抽取 ==========');
  const startTime = Date.now();
  const extracted = await extractFullGraphFromDocument(text, provider, {
    maxTerms: 40,
    maxHeadings: 30,
    specificityThreshold: 4,
    timeoutMs: 180000,
    maxContextChars: 60000
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`耗时：${elapsed}s`);

  console.log(`\n标题（${extracted.headings.length} 个）：`);
  for (const h of extracted.headings) {
    console.log(`  L${h.level} [start=${h.start}] ${h.title}`);
  }

  console.log(`\n实体（${extracted.entities.length} 个）：`);
  for (const e of extracted.entities) {
    const textAtOffset = text.slice(e.start, e.start + Math.min(30, e.term.length + 10));
    const matches = text.includes(e.term) ? 'YES' : 'NO';
    console.log(`  "${e.term}" | spec=${e.specificity} | generic=${e.isGeneric} | type=${e.type} | heading="${e.heading}" | start=${e.start} | inText=${matches} | text@offset="${textAtOffset}"`);
  }

  console.log(`\n关系（${extracted.relationships.length} 个）：`);
  for (const r of extracted.relationships) {
    console.log(`  ${r.from} --[${r.type}, w=${r.weight}]--> ${r.to}`);
  }

  return extracted;
}

async function testConvertToGraph(extracted, docId, docName) {
  console.log('\n========== 4. 转换为图谱节点/边 ==========');
  const { nodes, edges } = convertToGraph(extracted, docId, docName);
  console.log(`节点：${nodes.length}，边：${edges.length}`);

  const docNodes = nodes.filter(n => n.type === 'document');
  const headingNodes = nodes.filter(n => n.type === 'heading');
  const entityNodes = nodes.filter(n => n.type === 'entity');
  console.log(`  文档节点：${docNodes.length}`);
  console.log(`  标题节点：${headingNodes.length}`);
  console.log(`  实体节点：${entityNodes.length}`);

  const containsEdges = edges.filter(e => e.type === 'contains');
  const relatedEdges = edges.filter(e => e.type === 'related');
  const hierarchyEdges = edges.filter(e => e.type === 'hierarchy');
  console.log(`  contains 边：${containsEdges.length}`);
  console.log(`  related 边：${relatedEdges.length}`);
  console.log(`  hierarchy 边：${hierarchyEdges.length}`);

  // 验证实体节点的 source.start 和 keyword 一致性
  console.log('\n实体节点跳转一致性检查：');
  for (const n of entityNodes.slice(0, 10)) {
    const kw = n.meta?.keyword || n.content;
    const start = n.source?.start ?? n.meta?.start ?? 0;
    const textAtOffset = start > 0 ? text.slice(start, start + Math.min(20, kw.length + 5)) : '(offset=0)';
    console.log(`  "${n.content}" | keyword="${kw}" | start=${start} | text@offset="${textAtOffset}"`);
  }

  return { nodes, edges };
}

async function main() {
  console.log(`测试文件：${DOCX_PATH}`);
  console.log(`LLM：${MODEL} @ ${BASE_URL} (key: ${API_KEY ? '已设置' : '未设置'})`);

  if (!API_KEY) {
    console.error('请设置 DEEPSEEK_API_KEY 环境变量');
    process.exit(1);
  }

  try {
    const text = await testParse();
    const provider = createProvider();
    const extracted = await testFullExtract(text, provider);
    if (extracted) {
      await testConvertToGraph(extracted, 'doc_test', '医学微生物学理论教学大纲.docx');
    }
    console.log('\n全部测试完成。');
  } catch (err) {
    console.error('\n测试失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// 需要在 testConvertToGraph 中访问 text
let text = '';
async function mainWithText() {
  console.log(`测试文件：${DOCX_PATH}`);
  console.log(`LLM：${MODEL} @ ${BASE_URL} (key: ${API_KEY ? '已设置' : '未设置'})`);

  if (!API_KEY) {
    console.error('请设置 DEEPSEEK_API_KEY 环境变量');
    process.exit(1);
  }

  try {
    text = await testParse();
    const provider = createProvider();
    const extracted = await testFullExtract(text, provider);
    if (extracted) {
      await testConvertToGraph(extracted, 'doc_test', '医学微生物学理论教学大纲.docx');
    }
    console.log('\n全部测试完成。');
  } catch (err) {
    console.error('\n测试失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

mainWithText();
