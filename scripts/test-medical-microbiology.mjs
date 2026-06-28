/**
 * 测试医学微生物学docx文件的标题检测和管线
 * 运行：node scripts/test-medical-microbiology.mjs
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseWord } from '../core/parser/index.js';
import { extractHeadings, flattenHeadings } from '../core/extractor/headings.js';
import { extractHeadingsWithLLM } from '../core/extractor/llm-headings.js';
import { OpenAICompatibleLLMProvider } from '../services/llm-provider.js';
import { runPipeline } from '../core/pipeline/index.js';

// 从环境变量读取配置
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DOCX_PATH = 'C:/Users/YANYZ/Desktop/医学微生物学理论教学大纲（42h）.docx';

function createProvider() {
  if (!API_KEY) {
    console.warn('未设置 DEEPSEEK_API_KEY，将仅测试规则模式');
    return null;
  }
  return new OpenAICompatibleLLMProvider({
    apiKey: API_KEY,
    model: MODEL,
    baseUrl: BASE_URL,
    vendor: 'deepseek'
  });
}

async function testParse() {
  console.log('\n========== 1. 解析 docx 文件 ==========');
  const buffer = readFileSync(DOCX_PATH);
  // mammoth 在 Node.js 环境使用 { buffer } 选项
  const mammothMod = await import('mammoth');
  const mammoth = mammothMod.default || mammothMod;
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value || '';
  // 从 HTML 提取纯文本（保留段落换行）
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
  console.log(`前 800 字符：\n${rawText.slice(0, 800)}\n...`);
  return { rawText, html, fontSizeStats: null };
}

async function testRuleHeadings(text, fontSizeStats) {
  console.log('\n========== 2. 规则模式标题检测 ==========');
  const tree = extractHeadings(text, { fontSizeStats });
  const flat = flattenHeadings(tree);
  console.log(`规则模式识别出 ${flat.length} 个标题：`);
  for (const h of flat) {
    console.log(`  L${h.level} [${h.page}] ${h.title}`);
  }
  return flat;
}

async function testLLMHeadings(text, provider, fontSizeStats) {
  if (!provider) {
    console.log('\n========== 3. LLM 标题检测（跳过，无 provider） ==========');
    return null;
  }
  console.log('\n========== 3. LLM 标题检测 ==========');
  const tree = await extractHeadingsWithLLM(text, provider, { fontSizeStats });
  const flat = flattenHeadings(tree);
  console.log(`LLM 识别出 ${flat.length} 个标题：`);
  for (const h of flat) {
    console.log(`  L${h.level} [${h.page}] ${h.title}`);
  }
  return flat;
}

async function testPipeline(text, provider) {
  console.log('\n========== 4. 全管线测试 ==========');
  const files = [{
    name: '医学微生物学理论教学大纲（42h）.docx',
    content: text,
    type: 'text/plain',
    docId: 'doc_medical',
    lastModified: Date.now()
  }];

  const result = await runPipeline(files, {
    provider,
    extractOptions: {
      maxTerms: 30,
      splitMode: 'heading',
      enableSpecificityScoring: true,
      specificityThreshold: 4,
      specificityBatchSize: 40,
      specificityTimeoutMs: 120000
    },
    onProgress: (p) => {
      console.log(`  [进度] ${p.stage} ${p.percent}%: ${p.log}`);
    }
  });

  const entityNodes = result.graph.nodes.filter(n => n.type === 'entity');
  const headingNodes = result.graph.nodes.filter(n => n.type === 'heading');
  console.log(`\n最终图谱：${result.graph.nodes.length} 节点，${result.graph.edges.length} 边`);
  console.log(`  - 文档节点：${result.graph.nodes.filter(n => n.type === 'document').length}`);
  console.log(`  - 标题节点：${headingNodes.length}`);
  console.log(`  - 实体节点：${entityNodes.length}`);

  console.log('\n实体节点（前 20 个）：');
  for (const n of entityNodes.slice(0, 20)) {
    const meta = n.meta || {};
    const kw = meta.keyword || n.content || '';
    const start = n.source?.start ?? meta.start ?? 0;
    const textAtOffset = start > 0 ? text.slice(start, start + Math.min(30, kw.length + 10)) : '(offset=0)';
    const matches = kw && text.includes(kw) ? 'YES' : 'NO';
    console.log(`  "${n.content}" | keyword="${kw}" | start=${start} | text@offset="${textAtOffset}" | inText=${matches} | spec=${meta.specificity ?? '-'}`);
  }

  console.log('\n标题节点（前 20 个）：');
  for (const n of headingNodes.slice(0, 20)) {
    console.log(`  L${n.meta?.level || '?'} "${n.content}" | page=${n.source?.page ?? n.meta?.page ?? '?'}`);
  }

  return result;
}

async function main() {
  console.log(`测试文件：${DOCX_PATH}`);
  console.log(`LLM 配置：${MODEL} @ ${BASE_URL} (API key: ${API_KEY ? '已设置' : '未设置'})`);

  try {
    const parsed = await testParse();
    const provider = createProvider();

    const ruleHeadings = await testRuleHeadings(parsed.rawText, parsed.fontSizeStats);
    const llmHeadings = await testLLMHeadings(parsed.rawText, provider, parsed.fontSizeStats);

    // 对比规则 vs LLM
    if (llmHeadings) {
      console.log('\n========== 5. 规则 vs LLM 对比 ==========');
      const ruleTitles = new Set(ruleHeadings.map(h => h.title));
      const llmTitles = new Set(llmHeadings.map(h => h.title));
      const onlyInRule = [...ruleTitles].filter(t => !llmTitles.has(t));
      const onlyInLLM = [...llmTitles].filter(t => !ruleTitles.has(t));
      console.log(`规则独有（可能是误判）：${onlyInRule.length} 个`);
      for (const t of onlyInRule.slice(0, 20)) console.log(`  - ${t}`);
      console.log(`LLM 独有（规则遗漏）：${onlyInLLM.length} 个`);
      for (const t of onlyInLLM.slice(0, 20)) console.log(`  - ${t}`);
    }

    await testPipeline(parsed.rawText, provider);

    console.log('\n全部测试完成。');
  } catch (err) {
    console.error('\n测试失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
