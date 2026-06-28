/** @module core/graph/llm-extractor
 *  职责：基于 LLM 的关键术语/概念抽取
 *  输入：文档文本；输出：关键概念列表（带权重）
 *  当 LLM 不可用时自动回退到规则抽取。
 *
 *  核心改进：
 *  - 长文档按段落分块，每块独立调用小模型，避免上下文截断。
 *  - Prompt 中给出“概念类型 Schema”，让模型只抽有价值的知识点。
 *  - 跨块结果按频率+排名合并、去重，得到整文档的关键概念。
 */

import { extractKeywords } from '../extractor/index.js';
import { textRankKeywords } from './unsupervised.js';
import { extractExamConcepts } from '../extractor/exam-concept-extractor.js';
import { runLLMTask } from '../prompts/run-task.js';

const DEFAULT_CHUNK_SIZE = 2500;
const DEFAULT_OVERLAP = 200;
const DEFAULT_MAX_TERMS_PER_CHUNK = 15;
const DEFAULT_MAX_TERMS = 80;
const DEFAULT_CONCURRENCY = 2;
const FALLBACK_MAX_TEXT_LEN = 50000;

// 新分块/规范化策略开关
const DEFAULT_SPLIT_MODE = 'heading'; // 'paragraph' | 'heading' | 'llm'
const DEFAULT_WEAK_MAX_TERMS_PER_CHUNK = 20; // 小模型允许每块产出更多术语，后续靠后处理收敛

// 跨领域通用泛化词（语言层面的通用虚词，类似英文停用词，非领域特定硬编码）
// LLM 路径下由 refineTermsWithLLM 进行语义级过滤，此列表仅用于 rule fallback 兜底
const GENERIC_WORDS = new Set([
  '函数', '估计', '模型', '参数', '分布', '变量', '方法', '问题',
  '结果', '内容', '情况', '方面', '方式', '过程', '系统', '结构',
  '定义', '性质', '特征', '规律', '关系', '概念', '理论', '原理',
  '公式', '方程', '解方程', '计算', '求解', '标准', '时间', '独立'
]);

// 通用停用词：仅保留真正通用的虚词/代词/连接词/教材套话，不包含领域特定词
// 领域特定词应由 TF-IDF 相对频率 + PMI 自动降权，而非硬编码
const LLM_STOP_WORDS = new Set([
  // 中文虚词/助词
  '的', '了', '在', '是', '和', '与', '或', '一个', '可以', '这', '那', '为', '以', '及', '等',
  '中', '上', '下', '不', '有', '无', '到', '从', '被', '把', '将', '对', '向', '由', '于', '而',
  '且', '但', '则', '即', '若', '如', '虽', '然', '因', '故', '所', '之', '其', '此', '彼',
  // 代词
  '我', '你', '他', '它', '们', '我们', '你们', '他们', '它们', '自己', '某', '该',
  // 连接词/过渡词
  '进行', '通过', '根据', '按照', '由于', '因为', '所以', '但是', '然而', '另外',
  '同时', '其中', '其他', '其它', '上述', '下面', '上面', '前面', '后面', '之间',
  '以及', '并且', '或者', '如果', '虽然', '尽管', '即使', '除非', '一旦',
  // 教材套话（通用，非领域特定）
  '表明', '表示', '如下', '所示', '称为', '称作', '叫做', '定义', '是指', '就是',
  '例如', '比如', '譬如', '举例', '实例', '可见', '可知', '得出',
  '本节', '本章', '本文', '本书', '本课',
  '一般', '通常', '常见', '常常', '经常', '往往',
  '重要', '主要', '基本', '基础', '根本', '核心', '关键',
  '注意', '需要', '应', '应当', '应该', '必须',
  '内容', '方法', '方式', '方面', '情况', '情形', '问题', '结果', '结论', '目的',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'up', 'about', 'into', 'through', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'can', 'may', 'must', 'shall', 'as', 'if', 'then', 'than', 'so', 'such', 'also', 'too', 'very', 'just', 'only'
]);

// 数学/公式符号：过滤公式残留
const MATH_SYMBOLS = /[∫∬∭∮∯∰∑∏∂∇√∞∈∉∪∩⊂⊃⊆⊇≈≠≡≤≥×÷±∞αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ¯ˆ˜¨˙\^\_]/;
const MATH_VAR_PATTERN = /^(dx|dy|dz|dt|cov|var|std|sd|se|exp|ex|log|ln|lim|sin|cos|tan|dxdy|dydx|dxdz|dzdx|dydz|dzdy|dtdx|dxdt|dtdy|dydt|[a-zA-Z][0-9]?\(?|x\d*|y\d*)$/i;
const HEADING_NUMBER_PATTERN = /^\s*\d+(?:\.\d+)*\s*[\u4e00-\u9fa5]/;
const FRAGMENT_PATTERN = /^\s*[\(\[（【]\s*[\u4e00-\u9fa5]/;
const PURE_LATIN_VAR = /^[a-zA-Z][0-9]?$/;
// 常见数学修饰词/形容词，单独出现时不构成完整概念术语
const MATH_MODIFIER_STANDALONE = new Set(['齐次', '连续', '离散', '充分', '必要', '独立', '随机', '无偏']);

/**
 * 从文本中抽取关键概念
 * @param {string} text - 文档或段落文本
 * @param {object} options - { provider, useLLM, chunkSize, overlap, maxTermsPerChunk, maxTerms, concurrency }
 * @returns {Promise<Array<{term:string, score:number}>>}
 */
export async function extractKeyTerms(text, options = {}) {
  const result = await extractKeyTermsWithMeta(text, options);
  return result.terms;
}

/**
 * 提取关键术语并返回附带元信息（含 LLM 调用统计、回退原因等）。
 *
 * @param {string} text - 待抽取的文档纯文本。
 * @param {Object} [options={}] - 抽取选项。
 * @param {Object} [options.provider] - LLM 服务提供者实例，为空时走 stub/规则回退。
 * @param {number} [options.maxTerms] - 最终返回的最大术语数。
 * @param {number} [options.chunkSize] - 分块大小（字符数）。
 * @param {number} [options.maxTermsPerChunk] - 每块最多抽取的术语数。
 * @param {number} [options.concurrency] - 并发 LLM 请求数。
 * @param {number} [options.timeoutMs] - 单次 LLM 请求超时（毫秒）。
 * @param {('auto'|'heading'|'llm'|'fixed')} [options.splitMode] - 文本分块策略。
 * @param {boolean} [options.enableGlobalNormalize] - 是否对术语做全局规范化去重，默认 true。
 * @returns {Promise<{terms: Array<{term: string, score: number}>, meta: Object}>}
 *   抽取结果，terms 为术语数组，meta 包含抽取过程统计信息。
 */
export async function extractKeyTermsWithMeta(text, options = {}) {
  const provider = options.provider || null;
  const meta = {
    usedLLM: false,
    providerName: provider?.name || 'stub',
    model: provider?.model || '',
    fallbackReason: '',
    error: '',
    chunkCount: 0,
    termsPerChunk: [],
    totalRawTerms: 0,
    uniqueAfterDedup: 0,
    refinedByLLM: false
  };

  // 动态计算 maxTerms：未传入时按文本长度弹性伸缩
  if (!options.maxTerms) {
    options.maxTerms = Math.max(50, Math.min(200, Math.floor((text?.length || 0) / 500)));
  }

  const useLLM = options.useLLM !== false && provider && provider.name !== 'stub';
  const onProgress = options.onProgress;

  if (!useLLM) {
    meta.fallbackReason = provider?.name === 'stub'
      ? '当前使用的是 stub 规则模型，未启用 LLM'
      : '未配置 LLM Provider';
    if (onProgress) onProgress({ stage: 'fallback', percent: 50, log: '未启用 LLM，使用规则抽取...' });
    const terms = ruleBasedTerms(text, options);
    if (onProgress) onProgress({ stage: 'done', percent: 100, log: `规则抽取完成：${terms.length} 个术语` });
    return { terms, meta };
  }

  try {
    let result = null;

    // 云端大模型：先做文档类型识别，再做全局/整页抽取，不需要拆太细
    if (isCloudProvider(provider)) {
      if (onProgress) onProgress({ stage: 'detect-doc-type', percent: 10, log: '云端模型：识别文档类型...' });
      const docTypeInfo = await detectDocumentType(text, provider, options);
      meta.docType = docTypeInfo.docType;
      meta.domain = docTypeInfo.domain;

      if (onProgress) onProgress({ stage: 'cloud-extract', percent: 25, log: `云端模型：按 ${docTypeInfo.docType} 类型抽取考点/术语...` });
      result = await cloudExtractTerms(text, provider, { ...options, docTypeInfo }, onProgress);
    } else {
      // 本地模型：保持分块策略
      if (onProgress) onProgress({ stage: 'chunking', percent: 10, log: '正在分块文本...' });
      result = await llmBasedTermsChunked(text, provider, options, onProgress);
    }

    if (result && result.terms.length > 0) {
      meta.usedLLM = true;
      meta.chunkCount = result.chunkCount;
      meta.termsPerChunk = result.termsPerChunk;
      meta.totalRawTerms = result.totalRawTerms;
      meta.uniqueAfterDedup = result.terms.length;

      // 若 LLM 抽取数量过少（弱模型常出现），补充规则抽取结果
      let termsToRefine = result.terms;
      if (result.terms.length < 5) {
        const ruleTerms = ruleBasedTerms(text, options);
        const combinedTerms = [...result.terms, ...ruleTerms];
        const seen = new Set();
        termsToRefine = [];
        for (const t of combinedTerms) {
          const key = normalizeTerm(t.term || t);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          termsToRefine.push(t.term ? t : { term: t, score: 1 });
        }
      }

      // 试卷/试题：按小题提取考点概念，弥补全文术语抽取对隐式考点的遗漏
      try {
        const examConcepts = await extractExamConcepts(text, provider, { ...options, onProgress });
        if (examConcepts && examConcepts.length > 0) {
          const seen = new Set(termsToRefine.map(t => normalizeTerm(t.term || t)));
          for (const c of examConcepts) {
            const key = normalizeTerm(c.term);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            termsToRefine.push({ term: c.term, score: (c.score || 1) * 1.5 });
          }
        }
      } catch (e) {
        console.warn('[llm-extractor] 试卷考点提取失败:', e.message);
      }

      // 使用 LLM 对术语进行特异性评分（带标题上下文），默认启用
      const enableSpecificityScoring = options.enableSpecificityScoring !== false;
      if (enableSpecificityScoring && provider && provider.name !== 'stub' && termsToRefine.length > 0) {
        try {
          // 从分块结果收集每个术语的标题上下文；规则/考点补充术语可能没有上下文
          const occurrences = result.uniqueOccurrences || [];
          const headingByTerm = new Map();
          for (const occ of occurrences) {
            const t = normalizeTerm(occ.term);
            if (!t) continue;
            if (!headingByTerm.has(t) && occ.heading) headingByTerm.set(t, occ.heading);
          }
          const termsWithContext = termsToRefine.map(t => {
            const term = t.term || t;
            return { term, heading: headingByTerm.get(normalizeTerm(term)) || '' };
          });
          const specificityMap = await scoreTermSpecificityWithLLM(termsWithContext, provider, {
            specificityThreshold: options.specificityThreshold,
            specificityBatchSize: options.specificityBatchSize,
            specificityTimeoutMs: options.specificityTimeoutMs
          });
          // 把特异性分数写回 termsToRefine
          termsToRefine = termsToRefine.map(t => {
            const term = t.term || t;
            const info = specificityMap.get(term);
            if (!info) return t;
            return { ...t, specificity: info.specificity, isGeneric: info.isGeneric };
          });
        } catch (e) {
          console.warn('[llm-extractor] 特异性评分失败，继续无评分校验:', e.message);
        }
      }

      // LLM 二次校验：让模型审核术语质量，过滤泛化词，精炼标签
      if (onProgress) onProgress({ stage: 'refine', percent: 92, log: '正在校验术语质量...' });
      let refined = null;
      try {
        refined = await refineTermsWithLLM(termsToRefine, text, provider);
      } catch (e) {
        console.warn('[llm-extractor] 二次校验异常:', e.message);
      }
      if (refined && Array.isArray(refined) && refined.length > 0) {
        meta.refinedByLLM = true;
        if (onProgress) onProgress({ stage: 'done', percent: 100, log: `LLM 抽取+校验完成：${refined.length} 个术语` });
        return { terms: refined, meta };
      }
      // 校验失败则返回原始结果
      if (onProgress) onProgress({ stage: 'done', percent: 100, log: `LLM 抽取完成：${termsToRefine.length} 个术语` });
      return { terms: termsToRefine, meta };
    }
    meta.fallbackReason = 'LLM 所有分块均返回空结果';
    if (onProgress) onProgress({ stage: 'fallback', percent: 80, log: 'LLM 返回空结果，回退到规则抽取...' });
  } catch (e) {
    // 区分 TASK_DISABLED（用户主动禁用）和真正的 LLM 调用失败，日志更准确
    if (e.code === 'TASK_DISABLED') {
      meta.fallbackReason = 'LLM 任务已被用户禁用';
      meta.error = e.message || String(e);
      console.warn('[llm-extractor] LLM 任务已被禁用，回退到规则抽取:', e.message);
      if (onProgress) onProgress({ stage: 'fallback', percent: 80, log: 'LLM 任务已被禁用，使用规则抽取...' });
    } else {
      meta.fallbackReason = 'LLM 调用失败';
      meta.error = e.message || String(e);
      console.warn('[llm-extractor] LLM 抽取失败，回退到规则:', e.message);
      if (onProgress) onProgress({ stage: 'fallback', percent: 80, log: `LLM 调用失败：${e.message}，回退到规则抽取...` });
    }
  }
  // 回退到规则抽取时，使用根据模型能力动态计算的文本截断长度
  const adaptive = resolveAdaptiveOptions(text, provider, options);
  const fallbackTerms = ruleBasedTerms(text, { ...options, fallbackMaxTextLen: adaptive.fallbackMaxTextLen });
  if (onProgress) onProgress({ stage: 'done', percent: 100, log: `规则抽取完成：${fallbackTerms.length} 个术语` });
  return { terms: fallbackTerms, meta };
}

/**
 * 判断 provider 是否属于云端大模型（非本地 ollama / huggingface / stub）
 * core 层不直接 import services，通过 provider.name / vendor 推断
 */
function isCloudProvider(provider) {
  if (!provider) return false;
  if (provider.name === 'stub' || provider.name === 'ollama' || provider.name === 'huggingface') return false;
  if (provider.vendor === 'ollama' || provider.vendor === 'huggingface') return false;
  return true;
}

/**
 * 云端模型：先识别文档类型和学科领域
 */
async function detectDocumentType(text, provider, options = {}) {
  const sample = text.slice(0, 3000);

  try {
    const response = await runLLMTask(provider, 'doc-type-detect', {
      temperature: 0.1,
      maxTokens: 256,
      timeoutMs: options.timeoutMs || 60000,
      _vars: { sample }
    });
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = codeBlockMatch ? codeBlockMatch[1] : response;
    const parsed = extractValidJsonObject(jsonText);
    if (parsed) {
      return {
        docType: parsed.docType || 'other',
        domain: parsed.domain || '',
        specialElements: Array.isArray(parsed.specialElements) ? parsed.specialElements : []
      };
    }
  } catch (e) {
    if (e.code === 'TASK_DISABLED') {
      console.warn('[llm-extractor] 文档类型识别任务已被禁用:', e.message);
    } else {
      console.warn('[llm-extractor] 文档类型识别失败:', e.message);
    }
  }
  return { docType: 'other', domain: '', specialElements: [] };
}

/**
 * 云端模型：按页批量做全局术语/考点抽取
 * 短文档一次性处理，长文档按页分批，最后全局去重合并
 */
async function cloudExtractTerms(text, provider, options = {}, onProgress) {
  const { docTypeInfo } = options;
  const docType = docTypeInfo?.docType || 'other';

  // 按页切分
  const pages = splitTextByPageMarkers(text);
  const totalChars = text.length;

  let batchPageCount = 5;
  if (totalChars < 8000) batchPageCount = pages.length;
  else if (totalChars < 30000) batchPageCount = 5;
  else batchPageCount = 3;

  const maxCharsPerBatch = options.cloudMaxCharsPerBatch || 12000;
  const allTerms = [];
  const allOccurrences = [];
  let processedPages = 0;

  for (let i = 0; i < pages.length; processedPages = i) {
    let batchChars = 0;
    const batchPages = [];
    while (i < pages.length && batchPages.length < batchPageCount) {
      const page = pages[i];
      if (batchChars + page.content.length > maxCharsPerBatch && batchPages.length > 0) break;
      batchPages.push(page);
      batchChars += page.content.length;
      i++;
    }

    const batchText = batchPages.map(p => `--- 第 ${p.page} 页 ---\n${p.content}`).join('\n\n');
    const domain = docTypeInfo?.domain || '';
    const domainHint = domain ? `这是一篇${domain}领域的文档。` : '';

    const response = await runLLMTask(provider, 'cloud-term-extract', {
      temperature: 0.1,
      maxTokens: options.maxTokens || 2048,
      timeoutMs: options.timeoutMs || 120000,
      _vars: { batchText, domainHint }
    });

    const terms = parseCloudTermResponse(response);
    const batchHeading = batchPages.length > 0 ? `第 ${batchPages[0].page}${batchPages.length > 1 ? `-${batchPages[batchPages.length - 1].page}` : ''} 页` : '';
    if (terms.length > 0) {
      allTerms.push(...terms.map(t => ({ term: t, score: 1.0 })));
      terms.forEach((term, rank) => {
        allOccurrences.push({ term, chunkIndex: i, rank, heading: batchHeading });
      });
    }

    if (onProgress) {
      const percent = 25 + Math.floor((processedPages / pages.length) * 60);
      onProgress({ stage: 'cloud-extract', percent, log: `云端抽取中：第 ${processedPages}/${pages.length} 页` });
    }
  }

  // 去重并返回
  const uniqueTerms = deduplicateTerms(allTerms);
  const uniqueOccurrences = dedupeTermOccurrences(allOccurrences);
  return {
    terms: uniqueTerms,
    chunkCount: pages.length,
    termsPerChunk: [],
    totalRawTerms: allTerms.length,
    uniqueOccurrences
  };
}

function splitTextByPageMarkers(text) {
  const pages = [];
  const regex = /---\s*第\s*(\d+)\s*页\s*---/g;
  let lastIndex = 0;
  let lastPage = 1;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pages.push({ page: lastPage, content: text.slice(lastIndex, match.index) });
    }
    lastPage = parseInt(match[1], 10);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    pages.push({ page: lastPage, content: text.slice(lastIndex) });
  }
  if (pages.length === 0) {
    const approxPageSize = 2000;
    for (let i = 0; i < text.length; i += approxPageSize) {
      pages.push({ page: Math.floor(i / approxPageSize) + 1, content: text.slice(i, i + approxPageSize) });
    }
  }
  return pages;
}

function parseCloudTermResponse(response) {
  if (!response) return [];
  try {
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = codeBlockMatch ? codeBlockMatch[1] : response;
    const arr = extractValidJsonArray(jsonText);
    if (Array.isArray(arr)) {
      return arr
        .filter(t => t && typeof t === 'string' && t.trim().length >= 2 && t.trim().length <= 30)
        .map(t => t.trim());
    }
  } catch (e) {
    console.warn('[llm-extractor] 解析云端术语响应失败:', e.message);
  }
  return [];
}

function deduplicateTerms(termObjects) {
  const seen = new Set();
  const result = [];
  for (const t of termObjects) {
    if (!t || !t.term) continue;
    const key = t.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

/**
 * LLM 二次校验：让模型审核术语质量，过滤泛化词，精炼标签
 * 替代硬编码 GENERIC_WORDS 列表，用模型语义判断
 * @param {Array<{term:string,score:number}>} terms - 待校验术语
 * @param {string} fullText - 文档全文（用于推断主题）
 * @param {object} provider - LLM provider
 * @returns {Promise<Array<{term:string,score:number}>|null>} 校验后的术语，失败返回 null
 */
async function refineTermsWithLLM(terms, fullText, provider) {
  if (!provider || provider.name === 'stub' || !terms || terms.length === 0) return null;
  // 过滤掉 term 为空的元素，避免后续 null.length 错误
  const validTerms = terms.filter(t => t && typeof t.term === 'string' && t.term.trim().length > 0);
  if (validTerms.length === 0) return null;
  if (validTerms.length <= 3) return validTerms;

  // 从全文前800字推断文档主题
  const topicHint = (fullText || '').slice(0, 800).replace(/\s+/g, ' ').trim();

  const termList = validTerms.map((t, i) => `${i + 1}. ${t.term}`).join('\n');

  try {
    const raw = await runLLMTask(provider, 'term-refine', {
      temperature: 0.1,
      maxTokens: 2048,
      timeoutMs: 60000,
      _vars: { topicHint, termList }
    });
    const refined = parseRefineResponse(raw, validTerms);
    return refined;
  } catch (e) {
    if (e.code === 'TASK_DISABLED') {
      console.warn('[llm-extractor] 二次校验任务已被禁用，跳过校验:', e.message);
    } else {
      console.warn('[llm-extractor] 二次校验失败，返回原始术语:', e.message);
      console.warn(e.stack);
    }
    return null;
  }
}

/**
 * 从可能包含噪声的文本中提取第一个合法 JSON 数组
 */
function extractValidJsonArray(text) {
  if (!text) return null;
  let start = text.indexOf('[');
  while (start !== -1) {
    let end = text.indexOf(']', start);
    while (end !== -1) {
      try {
        const candidate = text.slice(start, end + 1);
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // 尝试更长的闭合
      }
      end = text.indexOf(']', end + 1);
    }
    start = text.indexOf('[', start + 1);
  }
  return null;
}

/**
 * 从可能包含噪声的文本中提取第一个合法 JSON 对象
 */
function extractValidJsonObject(text) {
  if (!text) return null;
  let start = text.indexOf('{');
  while (start !== -1) {
    let end = text.indexOf('}', start);
    while (end !== -1) {
      try {
        const candidate = text.slice(start, end + 1);
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (e) {
        // 尝试更长的闭合
      }
      end = text.indexOf('}', end + 1);
    }
    start = text.indexOf('{', start + 1);
  }
  return null;
}

/**
 * 解析 LLM 二次校验响应
 */
function parseRefineResponse(raw, originalTerms) {
  if (!raw) return null;
  let text = raw.trim();
  // 去除 markdown 代码块
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  // 提取第一个合法 JSON 数组
  const arr = extractValidJsonArray(text);
  if (!arr) return null;
  try {
    if (!Array.isArray(arr)) return null;

    const result = [];
    const usedRefined = new Set(); // 去重

    for (const item of arr) {
      const idx = typeof item.index === 'number' ? item.index - 1 : -1; // index 从 1 开始
      if (idx < 0 || idx >= originalTerms.length) continue;
      const originalTerm = originalTerms[idx]?.term;
      if (!originalTerm) continue;

      if (item.keep === false) continue; // 丢弃

      const refinedTerm = (typeof item.refined === 'string' && item.refined.trim())
        ? item.refined.trim()
        : originalTerm;

      if (!refinedTerm || refinedTerm.length < 2 || refinedTerm.length > 20) continue;

      // 去重
      const normalized = refinedTerm.toLowerCase().replace(/\s+/g, '');
      if (usedRefined.has(normalized)) continue;
      usedRefined.add(normalized);

      const refined = {
        term: refinedTerm,
        score: originalTerms[idx].score || 1
      };
      if (originalTerms[idx].specificity !== undefined) refined.specificity = originalTerms[idx].specificity;
      if (originalTerms[idx].isGeneric !== undefined) refined.isGeneric = originalTerms[idx].isGeneric;
      result.push(refined);
    }

    // 如果校验后剩余太少（<3），说明校验可能有问题，返回原始术语
    if (result.length < 3 && originalTerms.length >= 5) {
      console.warn('[llm-extractor] 二次校验后剩余过少，返回原始术语');
      return null;
    }

    return result;
  } catch (e) {
    console.warn('[llm-extractor] 二次校验响应解析失败:', e.message);
    return null;
  }
}

function ruleBasedTerms(text, options = {}) {
  const maxTerms = options.maxTerms || DEFAULT_MAX_TERMS;
  const fallbackMaxTextLen = options.fallbackMaxTextLen || FALLBACK_MAX_TEXT_LEN;
  const truncated = text.slice(0, fallbackMaxTextLen);
  const tr = textRankKeywords(truncated, maxTerms);
  if (tr.length > 0) {
    // 使用模块级 GENERIC_WORDS 过滤跨领域通用泛化词
    let filtered = tr
      .filter(k => !GENERIC_WORDS.has(k.word))
      .map((k, i) => ({ term: k.word, score: Math.max(1, Math.round((k.score || 1) * 10)) }));

    // 断词过滤：检查术语在全文中出现时，前后是否为非中文字符（边界）。
    // 若术语总是作为更长术语的子串出现（boundary===0），说明是断词，过滤掉。
    // 这是通用统计方法，不依赖领域特定词表。
    const countInText = (term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = text.match(new RegExp(escaped, 'g'));
      return matches ? matches.length : 0;
    };
    const countBoundary = (term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^\\u4e00-\\u9fa5])${escaped}(?:[^\\u4e00-\\u9fa5]|$)`, 'g');
      const matches = text.match(re);
      return matches ? matches.length : 0;
    };
    filtered = filtered.filter(t => {
      const total = countInText(t.term);
      if (total === 0) return false; // 全文找不到的词过滤
      const boundary = countBoundary(t.term);
      if (boundary === 0) return false; // 断词过滤
      return isValidTerm(t.term, 'medium');
    });

    return filtered;
  }
  const keywords = extractKeywords(text, maxTerms);
  return keywords.map(k => ({ term: k.word, score: k.count }));
}

/**
 * 自适应参数：根据文本长度、模型类型自动选择最佳分块/并发/温度/超时等参数。
 * 用户不需要手动调整。
 * 模型能力分级：优先用 provider.capabilities，其次按模型名参数规模启发式判断。
 */
function resolveAdaptiveOptions(text, provider, userOptions = {}) {
  const providerName = (provider?.name || 'stub').toLowerCase();
  const model = (provider?.model || '').toLowerCase();
  const textLen = text?.length || 0;

  // 判断模型能力等级
  // 优先使用 provider 显式声明的 capabilities
  const caps = provider?.capabilities;
  let capabilityLevel = 'medium'; // weak | medium | strong
  if (caps && typeof caps === 'object') {
    if (caps.qualityLevel && ['weak', 'medium', 'strong'].includes(caps.qualityLevel)) {
      capabilityLevel = caps.qualityLevel;
    } else if (typeof caps.contextWindow === 'number') {
      if (caps.contextWindow <= 2048) capabilityLevel = 'weak';
      else if (caps.contextWindow <= 8192) capabilityLevel = 'medium';
      else capabilityLevel = 'strong';
    }
  }

  // 无 capabilities 时，按模型名参数规模启发式
  if (!caps) {
    const isSmallParam = /(:0\.5b|:1b|:1\.5b|:2b|:3b|0\.5b|1b|1\.5b|2b|3b|tiny|small)/.test(model);
    const isMediumParam = /(:7b|:8b|:13b|7b|8b|13b|phi3|gemma2:2|llama3\.2|qwen2\.5:1|qwen2\.5:3)/.test(model);
    if (providerName === 'stub') {
      capabilityLevel = 'weak';
    } else if (isSmallParam) {
      capabilityLevel = 'weak';
    } else if (isMediumParam) {
      capabilityLevel = 'medium';
    } else {
      capabilityLevel = 'strong';
    }
  }

  const isWeakModel = capabilityLevel === 'weak';

  // chunkSize：小模型上下文小，给短 chunk；strong 模型利用大上下文窗口
  let chunkSize = userOptions.chunkSize;
  if (!chunkSize) {
    if (capabilityLevel === 'weak') {
      chunkSize = textLen > 30000 ? 1800 : (textLen > 10000 ? 2200 : 2800);
    } else if (capabilityLevel === 'medium') {
      chunkSize = textLen > 50000 ? 3000 : (textLen > 20000 ? 3500 : 4000);
    } else {
      // strong 模型：利用 128k 上下文窗口，大 chunk 减少分块数
      chunkSize = textLen > 100000 ? 8000 : (textLen > 30000 ? 10000 : 12000);
    }
  }

  // overlap：一般为 chunk 的 10%-15%，但至少 100 字
  let overlap = userOptions.overlap;
  if (overlap === undefined) {
    overlap = Math.max(100, Math.floor(chunkSize * 0.12));
  }

  // 每块术语数：小模型容易重复，这里放宽上限，后续用 LLM 多轮规范化收敛
  let maxTermsPerChunk = userOptions.maxTermsPerChunk;
  if (!maxTermsPerChunk) {
    maxTermsPerChunk = capabilityLevel === 'weak' ? DEFAULT_WEAK_MAX_TERMS_PER_CHUNK : (capabilityLevel === 'medium' ? 25 : 80);
  }
  // 0 表示不限制（仅建议大模型使用）
  const unlimitedTerms = maxTermsPerChunk === 0;

  // 总术语数：按文本长度弹性伸缩，避免过短/过长
  let maxTerms = userOptions.maxTerms;
  if (!maxTerms) {
    maxTerms = Math.max(50, Math.min(200, Math.floor(textLen / 500)));
  }

  // 回退路径文本截断长度：根据模型能力动态调整
  const fallbackMaxTextLen = capabilityLevel === 'strong' ? 200000
    : (capabilityLevel === 'medium' ? 60000 : FALLBACK_MAX_TEXT_LEN);

  // 预估分块数，用于计算并发
  const chunksCount = Math.max(1, Math.ceil(textLen / (chunkSize - overlap)));

  // 并发：本地小模型并发过高会 OOM/超时；云端模型可以提高并发
  const isCloudProvider = providerName === 'openai' || providerName === 'openai-compatible';
  let concurrency = userOptions.concurrency;
  if (!concurrency) {
    if (providerName === 'ollama') {
      concurrency = capabilityLevel === 'weak' ? 1 : 2;
    } else if (isCloudProvider) {
      // strong 云端模型可承受更高并发
      concurrency = capabilityLevel === 'strong'
        ? Math.min(8, Math.max(3, Math.floor(chunksCount / 3) + 1))
        : Math.min(6, Math.max(2, Math.floor(chunksCount / 4) + 1));
    } else {
      concurrency = capabilityLevel === 'weak' ? 2 : 3;
    }
  }

  // 温度：抽取术语要求确定性，统一较低温度
  let temperature = userOptions.temperature;
  if (temperature === undefined) {
    temperature = capabilityLevel === 'weak' ? 0.05 : 0.1;
  }

  // 超时：小模型本地推理慢，给更长超时；strong 模型大 chunk 需要更多时间
  let timeoutMs = userOptions.timeoutMs;
  if (!timeoutMs) {
    if (capabilityLevel === 'weak') {
      timeoutMs = Math.min(120000, 30000 + chunkSize * 30);
    } else if (capabilityLevel === 'strong') {
      timeoutMs = 90000; // 大 chunk 需要更长生成时间
    } else {
      timeoutMs = 60000;
    }
  }

  // maxTokens：strong 模型允许 rich 输出
  let maxTokens = userOptions.maxTokens;
  if (!maxTokens) {
    maxTokens = capabilityLevel === 'weak' ? 512 : (capabilityLevel === 'strong' ? 4096 : 1024);
  }

  // stop 序列：小模型输出 JSON 数组后容易继续生成多余文本，用 stop 截断
  let stop = userOptions.stop;
  if (!stop && capabilityLevel === 'weak') {
    stop = ['\n\n\n', '```', '文本：', '文本:'];
  }

  return {
    chunkSize,
    overlap,
    maxTermsPerChunk,
    unlimitedTerms,
    maxTerms,
    fallbackMaxTextLen,
    concurrency,
    temperature,
    timeoutMs,
    maxTokens,
    stop,
    capabilityLevel
  };
}

async function llmBasedTermsChunked(text, provider, options = {}, onProgress) {
  const adaptive = resolveAdaptiveOptions(text, provider, options);
  const chunkSize = adaptive.chunkSize;
  const overlap = adaptive.overlap;
  const maxTermsPerChunk = adaptive.maxTermsPerChunk;
  const unlimitedTerms = adaptive.unlimitedTerms;
  const maxTerms = adaptive.maxTerms;
  const concurrency = adaptive.concurrency;
  const temperature = adaptive.temperature;
  const timeoutMs = adaptive.timeoutMs;
  const maxTokens = adaptive.maxTokens;
  const stop = adaptive.stop;
  const splitMode = options.splitMode || DEFAULT_SPLIT_MODE;
  const fontSizeStats = options.fontSizeStats || [];
  const enableGlobalNormalize = options.enableGlobalNormalize !== false; // 默认开启

  // 根据 splitMode 选择分块策略
  let chunks = [];
  if (splitMode === 'heading') {
    chunks = await chunkTextByHeadings(text, fontSizeStats, chunkSize, overlap);
  } else if (splitMode === 'llm') {
    chunks = await chunkTextByLLM(text, provider, chunkSize, overlap);
  } else {
    chunks = chunkText(text, chunkSize, overlap);
  }

  if (chunks.length === 0) return { terms: [], chunkCount: 0, termsPerChunk: [], totalRawTerms: 0 };

  const termsPerChunk = new Array(chunks.length).fill(0);
  const allOccurrences = []; // { term, chunkIndex, rank, heading }
  let completedChunks = 0;

  if (onProgress) onProgress({
    stage: 'extract',
    percent: 15,
    log: `开始调用模型抽取（共 ${chunks.length} 个分块，并发 ${concurrency}）...`,
    chunkIndex: 0,
    chunkCount: chunks.length
  });

  const isStrongModel = adaptive.capabilityLevel === 'strong';

  await mapLimit(chunks, concurrency, async (chunk, idx) => {
    try {
      if (onProgress) onProgress({
        stage: 'extract',
        percent: 15 + Math.floor((completedChunks / chunks.length) * 70),
        log: `正在抽取第 ${idx + 1}/${chunks.length} 块...`,
        chunkIndex: idx,
        chunkCount: chunks.length
      });

      const chunkContent = chunk && typeof chunk === 'object' ? chunk.content : chunk;
      const chunkHeading = chunk && typeof chunk === 'object' ? (chunk.heading || '') : '';
      let response;
      if (isStrongModel) {
        // Strong 模型：system prompt + JSON mode，充分发挥模型能力
        response = await withTimeout(
          runLLMTask(provider, 'chunk-term-extract-strong', {
            temperature,
            maxTokens,
            timeoutMs,
            responseFormat: 'json',
            _vars: { chunk: chunkContent, maxTerms: maxTermsPerChunk }
          }),
          timeoutMs + 5000,
          `分块 ${idx + 1} 模型调用超时`
        );
      } else {
        // Weak/Medium 模型：内联 prompt + stop 序列
        response = await withTimeout(
          runLLMTask(provider, 'chunk-term-extract', {
            temperature, maxTokens, timeoutMs, stop,
            _vars: { chunk: chunkContent, countHint: unlimitedTerms ? '不限数量' : `最多 ${maxTermsPerChunk} 个` }
          }),
          timeoutMs + 5000,
          `分块 ${idx + 1} 模型调用超时`
        );
      }

      let terms = parseTermsFromResponse(response, adaptive.capabilityLevel);
      // 后处理：截断模型重复输出（如连续重复同一个术语）
      terms = sanitizeTerms(terms);
      termsPerChunk[idx] = terms.length;
      terms.forEach((term, rank) => {
        allOccurrences.push({ term, chunkIndex: idx, rank, heading: chunkHeading });
      });
    } catch (e) {
      console.warn(`[llm-extractor] 分块 ${idx + 1}/${chunks.length} 抽取失败:`, e.message);
      termsPerChunk[idx] = 0;
    }
    completedChunks++;
    if (onProgress) onProgress({
      stage: 'extract',
      percent: 15 + Math.floor((completedChunks / chunks.length) * 70),
      log: `已完成 ${completedChunks}/${chunks.length} 块...`,
      chunkIndex: completedChunks,
      chunkCount: chunks.length
    });
  });

  if (onProgress) onProgress({
    stage: 'merge',
    percent: 90,
    log: `合并 ${allOccurrences.length} 个原始术语（去重、排序）...`,
    chunkIndex: chunks.length,
    chunkCount: chunks.length
  });

  const totalRawTerms = allOccurrences.length;
  // 全局去重：跨块合并完全相同的术语，保留首次出现的位置
  const uniqueOccurrences = dedupeTermOccurrences(allOccurrences);
  let merged = mergeTerms(uniqueOccurrences, maxTerms, text, adaptive.capabilityLevel);

  // 多轮 LLM 规范化：strong 模型只需 1 轮（输出质量高），weak/medium 模型需要多轮收敛
  if (enableGlobalNormalize && merged.length > 0 && provider && provider.name !== 'stub') {
    if (onProgress) onProgress({
      stage: 'normalize',
      percent: 95,
      log: `正在对 ${merged.length} 个术语进行${isStrongModel ? '轻量' : '多轮'}规范化...`,
      chunkIndex: chunks.length,
      chunkCount: chunks.length
    });
    try {
      // 本地模型能力有限，多轮规范化容易过度过滤，限制为 1-2 轮
      const normalizeRounds = isStrongModel ? 1 : 2;
      const normalized = await normalizeTermsMultiRound(merged, provider, normalizeRounds);
      if (normalized && normalized.length > 0) {
        merged = normalized.slice(0, maxTerms);
      }
    } catch (e) {
      console.warn('[llm-extractor] 多轮规范化失败，使用原始术语:', e.message);
    }
  }

  return {
    terms: merged,
    chunkCount: chunks.length,
    termsPerChunk,
    totalRawTerms,
    uniqueOccurrences
  };
}

function chunkText(text, chunkSize, overlap) {
  if (!text || text.trim().length === 0) return [];
  // 预处理：过滤目录行、页码标记、点连线噪声，提升传给 LLM 的文本质量
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.trim().length === 0) return [];
  if (cleanedText.length <= chunkSize) return [cleanedText.trim()];

  // 按段落拆分
  const paragraphs = cleanedText.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks = [];
  let current = '';

  function flush() {
    if (current.trim()) chunks.push(current.trim());
  }

  for (const para of paragraphs) {
    if (current.length && current.length + para.length + 2 > chunkSize) {
      flush();
      current = '';
      if (overlap > 0 && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        // 从上一块尾部取 overlap 长度，优先在段落边界截断
        let cut = Math.max(0, prev.length - overlap);
        const nextNewline = prev.indexOf('\n', cut);
        if (nextNewline !== -1) cut = nextNewline + 1;
        const overlapText = prev.slice(cut).trim();
        if (overlapText) current = overlapText + '\n\n';
      }
    }
    current += (current ? '\n\n' : '') + para;
  }
  flush();

  // 兜底：如果段落分块后某块仍然超长（如单个段落极长），按字符强制切
  const normalized = [];
  for (const c of chunks) {
    if (c.length <= chunkSize) {
      normalized.push(c);
      continue;
    }
    for (let i = 0; i < c.length; i += chunkSize - overlap) {
      normalized.push(c.slice(i, i + chunkSize).trim());
    }
  }
  return normalized.filter(c => c.length > 0);
}

/**
 * 文本预处理：过滤目录、页码、点连线等噪声，提升 LLM 输入质量
 * 保留正文内容和带字号标记的标题行（作为上下文锚点）
 */
function preprocessTextForChunking(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  let inToc = false; // 目录区域标记

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行（保留段落分隔用）
    if (!trimmed) {
      cleaned.push('');
      continue;
    }

    // 跳过页码标记 "--- 第N页 ---"
    if (/^---\s*第\d+页\s*---/.test(trimmed)) continue;

    // 跳过纯页码行（单独一个数字）
    if (/^\d{1,3}$/.test(trimmed)) continue;

    // 跳过目录行：如 "1 概率模型 5"、"8.1 期望与方差 . . . . . . 7"
    // 特征：开头是章节编号，结尾是页码，中间可能有大量点连线
    if (/^\d+(?:\.\d+)*\s+\S.*\s+\d+$/.test(trimmed) && /\.{3,}|\s\d+$/.test(trimmed)) {
      inToc = true;
      continue;
    }
    // 目录项的点连线 ".... . . . . ."
    if (/^\s*\.{2,}\s*$/.test(trimmed) || /\.{5,}/.test(trimmed)) {
      continue;
    }

    // 跳过纯英文页眉页脚（如 "Lecture notes on Probability Theory"）
    // 但保留带字号标记的标题行 [fsXX]
    if (/^\[fs\d+\.?\d*\]/.test(trimmed)) {
      cleaned.push(trimmed);
      continue;
    }

    // 跳过纯公式行（以积分/求和/极限符号开头，或全是数学符号）
    if (/^[∫∬∭∮∯∰∑∏∂∇√∞∈∉∪∩⊂⊃⊆⊇]/.test(trimmed)) continue;
    if (/^[\d\s+\-*=<>^~∫∬∭∮∯∰∑∏∂∇√∞αβγδεζηθικλμνξοπρστυφχψω\s]+$/.test(trimmed)) continue;

    // 目录区域结束：遇到非目录的正文行
    if (inToc && trimmed.length > 20 && !/^\d+(?:\.\d+)*\s/.test(trimmed)) {
      inToc = false;
    }
    if (inToc) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n');
}

function mergeTerms(occurrences, maxTerms, fullText = '', modelTier = 'medium', specificityMap = new Map()) {
  // 按标准化形式分组
  const groups = [];
  for (const occ of occurrences) {
    const term = cleanTerm(occ.term);
    if (!isValidTerm(term, modelTier)) continue;

    let found = false;
    for (const g of groups) {
      if (termSimilarity(g.canonical, term) >= 0.85) {
        g.frequency += 1;
        g.rankSum += occ.rank;
        g.terms.push(term);
        // 选择更长、更具体的作为 canonical
        if (term.length > g.canonical.length && !g.canonical.includes(term)) {
          g.canonical = term;
        }
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({
        canonical: term,
        frequency: 1,
        rankSum: occ.rank,
        terms: [term]
      });
    }
  }

  // 后处理：若提供了全文，过滤在全文出现次数 < 2 的术语（避免 LLM 幻觉）
  // 同时对泛化词降权（使用模块级 GENERIC_WORDS）

  const scored = groups.map(g => {
    const avgRank = g.rankSum / g.frequency;
    // 检查在全文中的出现次数
    let fullTextCount = 0;
    if (fullText) {
      const escaped = g.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = fullText.match(new RegExp(escaped, 'g'));
      fullTextCount = matches ? matches.length : 0;
    }
    // 优先使用 LLM 特异性评分；若无评分则回退到硬编码泛化词表
    const specificityInfo = specificityMap.get(g.canonical);
    let isGeneric = specificityInfo ? specificityInfo.isGeneric : GENERIC_WORDS.has(g.canonical);
    let specificity = specificityInfo ? specificityInfo.specificity : (isGeneric ? 2 : 5);
    // 泛化词降权（LLM 判定为 1-3 分的术语）
    const genericPenalty = isGeneric ? 0.35 : 1.0;
    // 频率权重更高；排名越靠前（avgRank 越小）加分越多
    let score = (g.frequency * 10 + Math.max(0, 20 - avgRank)) * genericPenalty;
    // 全文出现次数加成（出现越多越核心）
    if (fullTextCount > 0) {
      score += Math.min(15, fullTextCount * 0.5);
    }
    return {
      term: g.canonical,
      frequency: g.frequency,
      avgRank,
      fullTextCount,
      score,
      specificity,
      isGeneric
    };
  });

  // 过滤全文出现次数过少的术语（仅当有全文时）
  // strong 模型放宽到 >=1（LLM 正确推断的术语可能只出现一次）；其他模型 >=2
  const minFullTextCount = modelTier === 'strong' ? 1 : 2;
  const filtered = fullText
    ? scored.filter(s => s.fullTextCount >= minFullTextCount)
    : scored;

  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, maxTerms).map((s, i) => ({
    term: s.term,
    score: Math.round(s.score),
    specificity: s.specificity,
    isGeneric: s.isGeneric
  }));
}

/**
 * 使用 LLM 对候选术语进行“特异性”评分，并给出标题上下文。
 * 特异性 1-10：
 *   1-3 分为泛化词（如教材里的“概率”“函数”），
 *   4-6 分为章节级概念，
 *   7-10 分为具体定理/方法/专有概念。
 * @param {Array<{term:string, heading:string}>} termsWithContext
 * @param {object} provider - LLM provider
 * @param {object} options - { threshold=4, batchSize=40, timeoutMs=60000 }
 * @returns {Promise<Map<string, {specificity:number, isGeneric:boolean}>>}
 */
export async function scoreTermSpecificityWithLLM(termsWithContext, provider, options = {}) {
  if (!provider || termsWithContext.length === 0) return new Map();
  const threshold = options.specificityThreshold ?? 4;
  const batchSize = options.specificityBatchSize ?? 40;
  const timeoutMs = options.specificityTimeoutMs ?? 60000;
  const result = new Map();

  // 按 term 去重，保留出现次数最多的 heading 作为代表上下文
  const headingByTerm = new Map();
  const countByTerm = new Map();
  for (const { term, heading } of termsWithContext) {
    const t = (term || '').trim();
    if (!t) continue;
    const prev = countByTerm.get(t) || 0;
    countByTerm.set(t, prev + 1);
    if (!headingByTerm.has(t) || prev === 0) {
      headingByTerm.set(t, heading || '');
    }
  }
  const uniqueTerms = Array.from(headingByTerm.entries()).map(([term, heading]) => ({ term, heading }));

  for (let i = 0; i < uniqueTerms.length; i += batchSize) {
    const batch = uniqueTerms.slice(i, i + batchSize);
    const batchText = batch.map(t => `- 术语："${t.term}"，所在小节："${t.heading || '未分类'}"`).join('\n');

    try {
      const response = await runLLMTask(provider, 'specificity-scoring', {
        temperature: 0.3,
        maxTokens: Math.min(2048, batch.length * 80 + 200),
        timeoutMs,
        _vars: { batchText }
      });
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || !item.term) continue;
          const specificity = Number(item.specificity);
          // 优先以 specificity 阈值为准，不信任模型 inconsistent 的 isGeneric
          result.set(item.term, {
            specificity: Number.isFinite(specificity) ? Math.max(1, Math.min(10, specificity)) : 5,
            isGeneric: Number.isFinite(specificity) ? specificity <= threshold : Boolean(item.isGeneric)
          });
        }
      }
    } catch (e) {
      if (e.code === 'TASK_DISABLED') {
        console.warn('[scoreTermSpecificityWithLLM] 特异性评分任务已被禁用，跳过所有批次:', e.message);
        break; // 任务被禁用，后续批次也会失败，直接退出循环
      }
      console.warn('[scoreTermSpecificityWithLLM] batch failed:', e.message);
      // 失败后该批次不返回任何分数，后续会回退到默认
    }
  }

  return result;
}

function parseTermsFromResponse(response, modelTier = 'medium') {
  if (!response) return [];
  let candidates = [];

  // 辅助：尝试把任意文本解析成对象/数组，支持双重 JSON 转义
  function tryParseJSON(text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      // 新格式：{"domain": "...", "terms": [...]}
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.terms)) {
        return parsed.terms;
      }
      // 小模型有时会返回被再次序列化的 JSON 字符串，如 "[\"a\",\"b\"]"
      if (typeof parsed === 'string') {
        const inner = tryParseJSON(parsed);
        if (Array.isArray(inner)) return inner;
      }
      return null;
    } catch {
      // 退而求其次：从噪声文本中提取合法 JSON 数组/对象
      const arr = extractValidJsonArray(text);
      if (arr) return arr;
      const obj = extractValidJsonObject(text);
      if (obj && Array.isArray(obj.terms)) return obj.terms;
      return null;
    }
  }

  // 1. 优先尝试 markdown 代码块中的 JSON
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const arr = tryParseJSON(codeBlockMatch[1]);
    if (arr) candidates = arr;
  }

  // 2. 尝试直接匹配 JSON 数组/对象（或被序列化的 JSON 字符串）
  if (candidates.length === 0) {
    // 先尝试完整字符串（处理 \" 转义的情况）
    const fullArr = tryParseJSON(response);
    if (fullArr) {
      candidates = fullArr;
    } else {
      // 尝试匹配 JSON 对象（新格式 {"domain":"...", "terms":[...]}）
      const objMatch = response.match(/\{[\s\S]*\}/);
      if (objMatch) {
        const obj = tryParseJSON(objMatch[0]);
        if (obj) candidates = obj;
      }
      // 尝试匹配 JSON 数组（旧格式 ["术语1", ...]）
      if (candidates.length === 0) {
        const jsonMatch = response.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const arr = tryParseJSON(jsonMatch[0]);
          if (arr) candidates = arr;
        }
      }
    }
  }

  // 3. 退回到按行/逗号/顿号提取
  if (candidates.length === 0) {
    candidates = response.split(/\n|，|、/);
  }

  const seen = new Set();
  return candidates
    .map(item => {
      if (typeof item === 'string') return cleanTerm(item);
      if (item && typeof item === 'object') {
        return cleanTerm(item.term || item.name || item.concept || item.entity || item.keyword || JSON.stringify(item));
      }
      return '';
    })
    .filter(t => isValidTerm(t, modelTier))
    .filter(t => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

function isValidTerm(term, modelTier = 'medium') {
  // strong 模型放宽长度上限：16→20，中文 10→15
  const maxLen = modelTier === 'strong' ? 20 : 16;
  const maxChineseLen = modelTier === 'strong' ? 15 : 10;
  if (!term || term.length < 2 || term.length > maxLen) return false;
  if (LLM_STOP_WORDS.has(term)) return false;
  if (MATH_MODIFIER_STANDALONE.has(term)) return false;
  // 过滤全数字
  if (/^\d+$/.test(term)) return false;
  // 过滤纯符号：必须包含至少一个中文字符、英文字母或数字
  if (!/[a-zA-Z0-9\u4e00-\u9fa5]/.test(term)) return false;
  // 过滤包含数学符号的公式残留
  if (MATH_SYMBOLS.test(term)) return false;
  // 过滤英文变量/函数缩写
  if (MATH_VAR_PATTERN.test(term)) return false;
  if (PURE_LATIN_VAR.test(term)) return false;
  // 过滤数学期望类变量写法，如 EZ、EY、EX、XY（通常是 E[Z]、E[Y] 的简写，不是概念术语）
  if (/^[A-Z]{2,3}$/.test(term)) return false;
  // 过滤章节编号开头，如 "1 复合随机..."
  if (HEADING_NUMBER_PATTERN.test(term)) return false;
  // 过滤以残缺括号/特殊符号/停用词/断词开头的片段
  if (FRAGMENT_PATTERN.test(term)) return false;
  if (/^[的是在中为和以与或得次量互维]/u.test(term)) return false;
  // 过滤中英文混合里的公式片段：含等号、不等号、积分号等
  if (/[+=<>^~]/.test(term)) return false;
  // 过滤以"的""是""为""与"结尾的断词
  if (/[的是为与]$/.test(term)) return false;
  // 过滤介词/连词开头的片段，如 "关于参数"、"对于分布"
  if (/^(?:关于|对于|通过|由于|基于|根据|按照|随着|除了|至于|作为|为了)/.test(term)) return false;
  // 过滤数学题中 "设" 开头的短片段，如 "设总体"、"设随机"
  if (/^设/.test(term) && term.length <= 4) return false;
  // 中文术语长度应在合理范围：纯中文 2-maxChineseLen 字，中英混合 2-maxLen 字符
  const chineseChars = term.match(/[\u4e00-\u9fa5]/g) || [];
  if (chineseChars.length > 0 && chineseChars.length > maxChineseLen) return false;
  // 过滤英文术语必须是完整单词（至少 2 个字母），不能是单字母变量
  const latinWords = term.match(/[a-zA-Z]+/g) || [];
  if (latinWords.length > 0 && latinWords.every(w => w.length <= 1)) return false;
  // 过滤全小写英文缩写（1-3字母），如 ar、mle —— 这类通常不是完整术语
  if (/^[a-z]{1,3}$/.test(term)) return false;
  return true;
}

function cleanTerm(term) {
  return String(term)
    .replace(/^\s*[-\d\.\)\]\*]+\s*/, '')
    .replace(/["'"'“”‘’\[\]{}()（）]/g, '')
    .replace(/[，,、。\.\?\?！!\n\r]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTerm(term) {
  return String(term).toLowerCase()
    .replace(/[，,、。\.\?\?！!"'"'“”‘’\[\]{}()（）\-\\/]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function termSimilarity(a, b) {
  const na = normalizeTerm(a);
  const nb = normalizeTerm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.95;

  // 字符集合 Jaccard
  const sa = new Set(na);
  const sb = new Set(nb);
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

// ============ 标题/字号感知分块 ============

async function chunkTextByHeadings(text, fontSizeStats, chunkSize, overlap) {
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.length <= chunkSize) return [{ content: cleanedText.trim(), heading: '' }];

  const { extractHeadings, flattenHeadings } = await import('../extractor/headings.js');
  const tree = extractHeadings(cleanedText, { fontSizeStats });
  const flat = flattenHeadings(tree);

  // 标题数 < 3 时回退到段落分块（不再使用字号突变切分）
  // flattenHeadings 输出的所有节点都是标题，直接按 level 过滤即可
  let headings = flat.filter(h => h.level >= 1);
  if (headings.length < 3) {
    return chunkText(text, chunkSize, overlap).map(c => ({ content: c, heading: '' }));
  }

  // 按标题位置切分
  headings.sort((a, b) => a.start - b.start);
  const topicBlocks = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].start;
    const end = (i + 1 < headings.length) ? headings[i + 1].start : cleanedText.length;
    const headingTitle = headings[i].title || '';
    topicBlocks.push({ block: cleanedText.slice(start, end).trim(), heading: headingTitle });
  }

  // 主题块过长时内部再按段落细分，保留标题上下文
  const chunks = [];
  for (const { block, heading } of topicBlocks) {
    if (block.length <= chunkSize) {
      chunks.push({ content: block, heading });
    } else {
      const subChunks = chunkText(block, chunkSize, overlap);
      subChunks.forEach((c, idx) => {
        chunks.push({ content: c, heading: idx === 0 ? heading : heading + '（续）' });
      });
    }
  }
  return chunks.filter(c => c.content.length > 0);
}

// ============ LLM 自己决定分块点 ============

async function chunkTextByLLM(text, provider, chunkSize, overlap) {
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.length <= chunkSize) return [{ content: cleanedText.trim(), heading: '' }];

  const paragraphs = cleanedText.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
  if (paragraphs.length <= 3) return [{ content: cleanedText.trim(), heading: '' }];

  // 给每个段落一个摘要（前 200 字）喂给 LLM
  const summaries = paragraphs.map((p, i) => ({ index: i, preview: p.slice(0, 200).replace(/\s+/g, ' ') }));
  const summariesText = summaries.map(s => `${s.index}. ${s.preview}`).join('\n');

  try {
    const raw = await runLLMTask(provider, 'llm-chunking', { temperature: 0.1, maxTokens: 512, timeoutMs: 60000, _vars: { summariesText } });
    let indices = [0];
    const parsed = extractValidJsonArray(raw || '');
    if (Array.isArray(parsed)) indices = parsed.filter(i => Number.isInteger(i) && i >= 0 && i < paragraphs.length);
    if (indices.length === 0) indices = [0];
    indices = [...new Set(indices)].sort((a, b) => a - b);

    const chunks = [];
    for (let i = 0; i < indices.length; i++) {
      const start = indices[i];
      const end = (i + 1 < indices.length) ? indices[i + 1] : paragraphs.length;
      const block = paragraphs.slice(start, end).join('\n\n');
      if (block.length > chunkSize) {
        chunkText(block, chunkSize, overlap).forEach(c => chunks.push({ content: c, heading: '' }));
      } else {
        chunks.push({ content: block, heading: '' });
      }
    }
    return chunks.filter(c => c.content.length > 0);
  } catch (e) {
    console.warn('[llm-extractor] LLM 分块失败，回退到段落分块:', e.message);
    return chunkText(text, chunkSize, overlap).map(c => ({ content: c, heading: '' }));
  }
}

// ============ 后处理：截断重复输出 ============

function sanitizeTerms(terms) {
  if (!terms || terms.length === 0) return [];
  const result = [];
  let repeatCount = 0;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (i > 0 && t === terms[i - 1]) {
      repeatCount++;
    } else {
      repeatCount = 0;
    }
    // 允许一次连续重复，第二次重复开始截断
    if (repeatCount >= 2) break;
    result.push(t);
  }
  return result.filter(t => t && t.length >= 2);
}

// ============ 全局去重 ============

function dedupeTermOccurrences(occurrences) {
  const seen = new Set();
  const result = [];
  for (const occ of occurrences) {
    const key = `${occ.chunkIndex}:${String(occ.term).trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(occ);
  }
  return result;
}

// ============ 多轮 LLM 规范化 ============

async function normalizeTermsMultiRound(terms, provider, maxRoundsOverride) {
  const BATCH_SIZE = 12;
  const MAX_ROUNDS = maxRoundsOverride || 4;
  // 保留原始元数据，规范化后尽量还原
  const metaByTerm = new Map();
  let current = terms.map(t => {
    const term = typeof t === 'string' ? t : (t.term || '');
    if (term && typeof t === 'object') {
      metaByTerm.set(term, { specificity: t.specificity, isGeneric: t.isGeneric, score: t.score });
    }
    return term;
  }).filter(t => typeof t === 'string' && t.length >= 2);
  if (current.length === 0) return [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const normalized = [];
    const totalBatches = Math.ceil(current.length / BATCH_SIZE);

    for (let i = 0; i < current.length; i += BATCH_SIZE) {
      const batch = current.slice(i, i + BATCH_SIZE);
      const result = await normalizeOneBatch(batch, provider, round, `${Math.floor(i / BATCH_SIZE) + 1}/${totalBatches}`);
      normalized.push(...result);
    }

    const next = [...new Set(normalized.map(t => t.trim()).filter(t => t.length >= 2))];
    if (next.length === current.length) {
      return next.map(t => buildNormalizedTerm(t, metaByTerm));
    }
    current = next;
  }

  return current.map(t => buildNormalizedTerm(t, metaByTerm));
}

function buildNormalizedTerm(term, metaByTerm) {
  const meta = metaByTerm.get(term) || {};
  const out = { term, score: meta.score || 1 };
  if (meta.specificity !== undefined) out.specificity = meta.specificity;
  if (meta.isGeneric !== undefined) out.isGeneric = meta.isGeneric;
  return out;
}

async function normalizeOneBatch(batch, provider, roundNum, batchNum) {
  const batchJson = JSON.stringify(batch);

  try {
    const raw = await runLLMTask(provider, 'term-normalize', { temperature: 0.1, maxTokens: 1024, timeoutMs: 60000, _vars: { batchJson } });
    const parsed = parseNormalizeResponse(raw);
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.warn(`[llm-extractor] 规范化 轮次${roundNum} 批次${batchNum} 失败:`, e.message);
  }
  return batch;
}

function parseNormalizeResponse(raw) {
  if (!raw) return null;
  let text = raw.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  const arr = extractValidJsonArray(text);
  if (!arr) return null;
  return arr.map(item => typeof item === 'string' ? item.trim() : '').filter(t => t.length >= 2);
}

async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = [];
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i));
    results.push(p);
    const e = p.then(() => {
      const idx = executing.indexOf(e);
      if (idx !== -1) executing.splice(idx, 1);
    });
    executing.push(e);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

function withTimeout(promise, ms, message = '操作超时') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

// ============ 节点/边数据校验 ============

/**
 * 合法节点类型（与 services/api/handlers/graph-node.js 保持一致）
 */
const VALID_NODE_TYPES_FOR_EXTRACTION = new Set([
  'concept', 'entity', 'heading', 'document', 'idea', 'manual'
]);

/**
 * 合法边类型（与 services/api/handlers/graph-node.js 的 VALID_EDGE_TYPES 保持一致）
 */
const VALID_EDGE_TYPES_FOR_EXTRACTION = new Set([
  // 手动创建
  'manual',
  // 无向边类型
  'similar', 'related', 'cross-link', 'co-occurrence', 'semantic', 'relates', 'also-known-as',
  // 层级/包含关系
  'belong', 'contains', 'hierarchy', 'includes',
  // Idea 关联
  'idea-hierarchy', 'idea-link',
  // 语义关系
  'is', 'of', 'affects', 'refers-to', 'enables', 'examines',
  // 其他合法类型
  'derive', 'cite'
]);

/**
 * 校验并规范化 LLM 抽取出的节点/边。
 * 用于 full-extract 路径与 cross-link 结果过滤，避免残缺/悬空数据污染图谱。
 *
 * @param {Array} nodes - 待校验节点数组
 * @param {Array} edges - 待校验边数组
 * @param {string} [sourceDocId] - 期望归属的文档 ID，用于补全缺失的 source.docId
 * @returns {{validNodes:Array, validEdges:Array, droppedCount:number, errors:string[]}}
 */
export function validateExtractedNodesAndEdges(nodes, edges, sourceDocId) {
  const errors = [];
  const validNodes = [];
  const validEdges = [];
  const seenNodeIds = new Set();
  let droppedCount = 0;

  // 校验节点
  if (!Array.isArray(nodes)) {
    errors.push('nodes 不是数组');
    droppedCount++;
    nodes = [];
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const prefix = `节点[${i}]`;

    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`${prefix}: 不是有效对象`);
      droppedCount++;
      continue;
    }

    // id：必须是非空字符串
    if (typeof node.id !== 'string' || !node.id.trim()) {
      errors.push(`${prefix}: id 缺失或为空`);
      droppedCount++;
      continue;
    }

    // 重复 id 只保留第一个
    if (seenNodeIds.has(node.id)) {
      errors.push(`${prefix}: id "${node.id}" 重复，跳过`);
      droppedCount++;
      continue;
    }

    // type：必须是合法类型；非法时归一化为 'concept' 并记录警告
    let nodeType = node.type;
    if (typeof nodeType !== 'string' || !VALID_NODE_TYPES_FOR_EXTRACTION.has(nodeType)) {
      errors.push(`${prefix}: type "${nodeType}" 无效，已归一化为 concept`);
      nodeType = 'concept';
    }

    // content：必须是字符串；缺失时从 label/keyword/name/term 推导，数组/对象则 JSON.stringify，再 trim
    let content = node.content;
    if (typeof content !== 'string' || !content.trim()) {
      const fallback = node.label || node.keyword || node.name || node.term;
      if (typeof fallback === 'string' && fallback.trim()) {
        content = fallback.trim();
      }
    }
    if (typeof content !== 'string') {
      if (content !== null && typeof content === 'object') {
        try {
          content = JSON.stringify(content);
        } catch (e) {
          content = String(content);
        }
      } else {
        content = String(content ?? '');
      }
      errors.push(`${prefix}: content 不是字符串，已转换: "${content.slice(0, 50)}"`);
    }
    content = content.trim();
    if (!content) {
      errors.push(`${prefix}: content 为空`);
      droppedCount++;
      continue;
    }

    // source：必须存在；缺失时补充，必要时写入 sourceDocId
    let source = node.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      errors.push(`${prefix}: source 缺失或类型错误，已补充`);
      source = sourceDocId ? { docId: sourceDocId } : {};
    } else {
      source = { ...source };
      if (sourceDocId && !source.docId) {
        source.docId = sourceDocId;
      }
    }

    // weight：不是数字则默认 0.5
    let weight = node.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      errors.push(`${prefix}: weight "${weight}" 不是数字，默认 0.5`);
      weight = 0.5;
    }

    seenNodeIds.add(node.id);
    validNodes.push({
      ...node,
      id: node.id,
      type: nodeType,
      content,
      source,
      weight
    });
  }

  // 校验边
  if (!Array.isArray(edges)) {
    errors.push('edges 不是数组');
    edges = [];
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const prefix = `边[${i}]`;

    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      errors.push(`${prefix}: 不是有效对象`);
      droppedCount++;
      continue;
    }

    // from / to / type：必须存在且为字符串
    if (typeof edge.from !== 'string' || !edge.from.trim()) {
      errors.push(`${prefix}: from 缺失或为空`);
      droppedCount++;
      continue;
    }
    if (typeof edge.to !== 'string' || !edge.to.trim()) {
      errors.push(`${prefix}: to 缺失或为空`);
      droppedCount++;
      continue;
    }
    if (typeof edge.type !== 'string' || !VALID_EDGE_TYPES_FOR_EXTRACTION.has(edge.type)) {
      errors.push(`${prefix}: type "${edge.type}" 无效`);
      droppedCount++;
      continue;
    }

    // from / to 必须存在于有效节点 id 集合中
    if (!seenNodeIds.has(edge.from) || !seenNodeIds.has(edge.to)) {
      errors.push(`${prefix}: 悬空边 "${edge.from}" -> "${edge.to}"（端点不存在）`);
      droppedCount++;
      continue;
    }

    // weight：不是数字则默认 0.5
    let weight = edge.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      errors.push(`${prefix}: weight "${weight}" 不是数字，默认 0.5`);
      weight = 0.5;
    }

    validEdges.push({
      ...edge,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      weight
    });
  }

  if (droppedCount > 0 || errors.length > 0) {
    console.warn(`[validateExtractedNodesAndEdges] 校验完成：保留 ${validNodes.length} 节点 / ${validEdges.length} 边，丢弃/修正 ${errors.length} 项`);
    for (const err of errors) {
      console.warn(`  - ${err}`);
    }
  }

  return { validNodes, validEdges, droppedCount, errors };
}
