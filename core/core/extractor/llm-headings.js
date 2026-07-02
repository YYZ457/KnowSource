/** @module core/extractor/llm-headings
 *  职责：LLM 辅助标题判断
 *  架构边界：core 层模块，通过参数接收 provider，不 import services 层
 *  策略：
 *    - 云端大模型：利用长上下文，按页批量做整结构标题识别
 *    - 本地模型：对规则候选集做二分类 + 基于可疑短行的补充发现
 *    - 未选模型（stub）时直接返回规则结果。
 */

import { extractHeadings, flattenHeadings, normalizeExamSectionLevels, EXAM_SECTION_PATTERN } from './headings.js';
import { runLLMTask } from '../prompts/run-task.js';

/**
 * 用 LLM 辅助判断标题
 * @param {string} text - 文档全文（含 [fsXX] 字号标记）
 * @param {object} provider - LLM provider（通过参数注入，不直接 import services）
 * @param {object} [options] - { fontSizeStats, maxCandidates, onProgress }
 * @returns {Promise<Array>} 标题树（与 extractHeadings 相同格式）
 */
export async function extractHeadingsWithLLM(text, provider, options = {}) {
  // 未选模型或 stub：直接返回规则结果
  if (!provider || provider.name === 'stub') {
    return extractHeadings(text, { fontSizeStats: options.fontSizeStats });
  }

  // 云端模型：用长上下文做整页/整结构识别
  if (isCloudProvider(provider)) {
    try {
      const cloudHeadings = await llmCloudExtractHeadings(text, provider, options);
      if (cloudHeadings && cloudHeadings.length > 0) {
        return rebuildHeadingTree(cloudHeadings);
      }
    } catch (e) {
      console.warn('[llm-headings] 云端模型整结构识别失败，回退到本地模式:', e.message);
    }
  }

  // 本地模型 / 云端失败回退：规则 + 精炼 + 补充发现
  const ruleHeadings = extractHeadings(text, { fontSizeStats: options.fontSizeStats });
  const flat = flattenHeadings(ruleHeadings);

  // 保护规则识别出的试卷大题号：这些主标题不应被 LLM 精炼误删
  const examSectionHeadings = flat.filter(h => EXAM_SECTION_PATTERN.test(h.title));

  let combined = flat;

  // 候选数量过多时，LLM 判断成本高，跳过精炼
  const maxCandidates = options.maxCandidates || 120;
  if (flat.length <= maxCandidates && flat.length > 0) {
    try {
      const refined = await llmRefineHeadings(text, flat, provider, options);
      if (refined && refined.length > 0) {
        combined = refined;
      }
    } catch (e) {
      console.warn('[llm-headings] LLM 辅助判断失败，回退到规则结果:', e.message);
    }
  }

  // LLM 补充发现规则遗漏的标题
  try {
    const discovered = await llmDiscoverHeadings(text, combined, provider, options);
    if (discovered && discovered.length > 0) {
      combined = [...combined, ...discovered];
    }
  } catch (e) {
    console.warn('[llm-headings] LLM 补充发现失败:', e.message);
  }

  // 后处理：过滤明显的小题号（如"(2) X + Y 的概率密度函数"、"2) Z 的分布"）
  // 这对弱本地模型是必要的安全网；强模型通常已在精炼阶段过滤掉它们。
  combined = combined.filter(h => !isObviousSubQuestion(h.title));

  // 恢复被 LLM 误删的试卷大题号
  const combinedTitles = new Set(combined.map(h => h.title));
  for (const h of examSectionHeadings) {
    if (!combinedTitles.has(h.title)) {
      combined.push(h);
      combinedTitles.add(h.title);
    }
  }

  if (combined.length === 0) return ruleHeadings;

  // 标准化试卷大题号层级
  normalizeExamSectionLevels(combined);

  return rebuildHeadingTree(combined);
}

// 判断一个标题是否明显是试卷中的小题号（而非章节标题）
function isObviousSubQuestion(title) {
  const trimmed = title.trim();
  // 匹配 (1)/（1）/1)/1. 等编号前缀
  const m = trimmed.match(/^\s*[(（]?\d+[)）\.．\s]\s*(.+)$/);
  if (!m) return false;
  const content = m[1].trim();
  if (!content) return true;

  // 如果内容像章节标题关键词，保留
  const headingKeywords = /第[一二三四五六七八九十百千万\d]+[章编节部分]|选择|填空|解答|例题|复习|小结|总结|结论|引言|方法|结果|讨论|定理|定义|性质|引理|推论|命题|附录/;
  if (headingKeywords.test(content)) return false;

  // 小题号特征：短或含题目常见动词/符号
  if (content.length < 18) return true;
  const questionSignals = /求|设|证明|是否|已知|若|则|的分布|概率密度|分布函数|转移概率|期望|方差|协方差|=|＝|≠|≤|≥|>|</;
  if (questionSignals.test(content)) return true;

  return false;
}

/**
 * 判断 provider 是否属于云端大模型
 * （通过 provider.name / vendor 推断，避免引入 services 层）
 */
function isCloudProvider(provider) {
  if (!provider) return false;
  if (provider.name === 'stub' || provider.name === 'ollama' || provider.name === 'huggingface') return false;
  if (provider.vendor === 'ollama' || provider.vendor === 'huggingface') return false;
  return true;
}

/**
 * 云端模型：按页批量做整结构标题识别
 * 策略：
 *  1. 按 "--- 第 N 页 ---" 切分页面
 *  2. 每批最多 5 页或最多 12000 字（根据模型能力可调整）
 *  3. 让 LLM 输出该批文本中的标题列表（title/level/page）
 *  4. 在原文中搜索标题文本定位 start
 */
async function llmCloudExtractHeadings(text, provider, options = {}) {
  const pages = splitTextByPageMarkers(text);
  if (pages.length === 0) return [];

  // 每批页面数：短文档直接全量，长文档分页
  const totalChars = text.length;
  let batchPageCount = 5;
  if (totalChars < 8000) batchPageCount = pages.length; // 短文档一次性处理
  else if (totalChars < 30000) batchPageCount = 5;
  else batchPageCount = 3;

  const maxCharsPerBatch = options.cloudMaxCharsPerBatch || 12000;
  const allHeadings = [];

  for (let i = 0; i < pages.length; i += batchPageCount) {
    // 动态累积页面，直到接近 maxCharsPerBatch
    let batchChars = 0;
    let batchPages = [];
    let j = i;
    while (j < pages.length && batchPages.length < batchPageCount) {
      const page = pages[j];
      if (batchChars + page.content.length > maxCharsPerBatch && batchPages.length > 0) break;
      batchPages.push(page);
      batchChars += page.content.length;
      j++;
    }

    const batchText = batchPages.map(p => `--- 第 ${p.page} 页 ---\n${p.content}`).join('\n\n');
    const startPage = batchPages[0].page;
    const endPage = batchPages[batchPages.length - 1].page;

    const response = await runLLMTask(provider, 'cloud-heading-extract', {
      temperature: 0.05,
      maxTokens: options.maxTokens || 2048,
      timeoutMs: options.timeoutMs || 120000,
      _vars: { batchText, startPage, endPage }
    });

    const headings = parseCloudHeadingResponse(response, batchPages, text);
    if (headings && headings.length > 0) {
      allHeadings.push(...headings);
    }

    if (options.onProgress) {
      options.onProgress({ stage: 'cloud-heading', current: j, total: pages.length });
    }
  }

  // 去重：同一标题在原文中多次出现，保留第一次
  return deduplicateHeadingsByPosition(allHeadings);
}

/**
 * 按 "--- 第 N 页 ---" 标记切分文本
 */
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

  // 如果没有页码标记，按字符数近似分页（每页约 2000 字）
  if (pages.length === 0) {
    const approxPageSize = 2000;
    for (let i = 0; i < text.length; i += approxPageSize) {
      pages.push({ page: Math.floor(i / approxPageSize) + 1, content: text.slice(i, i + approxPageSize) });
    }
  }

  return pages;
}

function parseCloudHeadingResponse(response, batchPages, fullText) {
  if (!response) return [];
  let decisions = null;
  try {
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = codeBlockMatch ? codeBlockMatch[1] : response;
    decisions = extractValidJsonArray(jsonText);
    if (!decisions) {
      decisions = extractValidJsonArray(response);
    }
  } catch (e) {
    console.warn('[llm-headings] 解析云端 LLM 响应失败:', e.message);
    return [];
  }

  if (!Array.isArray(decisions)) return [];

  const headings = [];
  const pageSet = new Set(batchPages.map(p => p.page));

  for (const d of decisions) {
    if (!d || !d.title || typeof d.title !== 'string') continue;
    const title = d.title.trim();
    if (!title || title.length < 2 || title.length > 120) continue;

    const level = (typeof d.level === 'number' && d.level >= 1 && d.level <= 6) ? d.level : 3;
    const page = (typeof d.page === 'number' && d.page > 0) ? d.page : batchPages[0].page;

    // 在原文中定位标题位置：优先在指定页附近搜索
    const searchStart = Math.max(0, fullText.indexOf(`--- 第 ${page} 页 ---`) - 100);
    const searchEnd = Math.min(fullText.length, searchStart + 15000);
    const region = fullText.slice(searchStart, searchEnd);
    const posInRegion = region.indexOf(title);
    const start = posInRegion >= 0 ? searchStart + posInRegion : fullText.indexOf(title);

    headings.push({
      id: `cloud_h_${headings.length}`,
      title,
      level,
      start: start >= 0 ? start : 0,
      end: start >= 0 ? start + title.length : title.length,
      page,
      source: { start, page }
    });
  }

  return headings;
}

function deduplicateHeadingsByPosition(headings) {
  const seen = new Map(); // title -> heading with earliest start
  for (const h of headings) {
    const key = h.title;
    const existing = seen.get(key);
    if (!existing || h.start < existing.start) {
      seen.set(key, h);
    }
  }
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

/**
 * 用 LLM 对候选标题集做精炼：判断每个候选是否真的是标题，并修正层级
 * 关键：给模型足够的上下文（前后多行），让它自己泛化判断，而不是依赖硬编码规则
 */
async function llmRefineHeadings(text, candidates, provider, options = {}) {
  // 构造候选列表（带前后各 3 行上下文）
  const lines = text.split('\n');
  // 预计算每行起始偏移
  const lineOffsets = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const candidateItems = candidates.map((h, i) => {
    const lineIndex = findLineIndex(lineOffsets, h.start);
    const contextLines = getContextLines(lines, lineIndex, 3);
    return {
      index: i,
      text: h.title,
      level: h.level,
      lineIndex,
      context: contextLines
    };
  });

  const timeoutMs = options.timeoutMs || 60000;
  const maxTokens = options.maxTokens || 1024;
  // 本地小模型上下文和遵循能力有限，每次少给一些候选
  const batchSize = options.refineBatchSize || (isCloudProvider(provider) ? 30 : 5);

  const allDecisions = new Map();
  for (let i = 0; i < candidateItems.length; i += batchSize) {
    const batch = candidateItems.slice(i, i + batchSize);
    // 调整 batch 内的 index 从 1 开始
    const reindexedBatch = batch.map((item, idx) => ({ ...item, index: idx + 1 }));
    const blocks = buildHeadingBlocks(reindexedBatch);

    const response = await runLLMTask(provider, 'heading-refine', {
      temperature: 0.1,
      maxTokens,
      timeoutMs,
      _vars: { blocks }
    });

    const decisions = parseHeadingDecisions(response);
    for (const d of decisions) {
      if (d && typeof d.index === 'number') {
        allDecisions.set(i + d.index - 1, d);
      }
    }
  }

  return applyHeadingDecisions(candidates, allDecisions);
}

function findLineIndex(lineOffsets, pos) {
  let lo = 0, hi = lineOffsets.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineOffsets[mid] <= pos) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function getContextLines(lines, centerIdx, radius) {
  const start = Math.max(0, centerIdx - radius);
  const end = Math.min(lines.length, centerIdx + radius + 1);
  return lines.slice(start, end).map((line, i) => ({
    lineNum: start + i + 1,
    text: line,
    isCandidate: start + i === centerIdx
  }));
}

/**
 * 构建候选标题的格式化文本块（供 prompt 和 _vars 共用）
 */
function buildHeadingBlocks(items) {
  return items.map((item, i) => {
    const ctx = item.context.map(l =>
      `${l.isCandidate ? '>>' : '  '} ${String(l.lineNum).padStart(3)} | ${l.text}`
    ).join('\n');
    return `[候选 ${i + 1}] 当前level=${item.level} "${item.text}"\n${ctx}`;
  }).join('\n\n');
}

function extractValidJsonArray(text) {
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

function parseHeadingDecisions(response) {
  if (!response) return [];

  let decisions = null;
  try {
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = codeBlockMatch ? codeBlockMatch[1] : response;
    decisions = extractValidJsonArray(jsonText);
    if (!decisions) {
      // 退而求其次：尝试在整个响应里找 JSON 数组
      decisions = extractValidJsonArray(response);
    }
  } catch (e) {
    console.warn('[llm-headings] 解析 LLM 响应失败:', e.message);
    return [];
  }

  if (!Array.isArray(decisions)) return [];
  return decisions.filter(d => d && typeof d.index === 'number');
}

function applyHeadingDecisions(originalCandidates, decisionMap) {
  const refined = [];
  for (let i = 0; i < originalCandidates.length; i++) {
    const candidate = originalCandidates[i];
    const decision = decisionMap.get(i); // 注意：这里使用 0-based 索引
    if (decision && decision.isHeading === false) {
      continue;
    }
    let level = candidate.level;
    if (decision && typeof decision.level === 'number' && decision.level >= 1 && decision.level <= 6) {
      level = decision.level;
    }
    refined.push({ ...candidate, level });
  }
  return refined;
}

/**
 * LLM 补充发现规则遗漏的标题
 * 策略：扫描文本中"可疑的短行"（可能是标题但未被规则识别），
 *       发送给 LLM 判断，返回新发现的标题
 */
async function llmDiscoverHeadings(text, existingHeadings, provider, options = {}) {
  // 构建已有标题的文本集合，用于去重
  const existingTitles = new Set(
    existingHeadings.map(h => h.title).filter(Boolean)
  );

  // 扫描可疑行：短行、独立行、非空、非页码、未被规则识别
  const lines = text.split('\n');
  const lineOffsets = [];
  let tmpOffset = 0;
  for (const line of lines) {
    lineOffsets.push(tmpOffset);
    tmpOffset += line.length + 1;
  }
  const suspicious = [];
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim().replace(/^\[fs[\d.]+\]\s*/, '').replace(/^\[bookmark:L\d+\]\s*/, '');
    const lineStart = charOffset;

    // 跳过空行、页码标记、过长行（标题通常 < 80 字符）
    if (!trimmed || trimmed.length < 3 || trimmed.length > 80) {
      charOffset += line.length + 1;
      continue;
    }

    // 跳过已有标题
    if (existingTitles.has(trimmed)) {
      charOffset += line.length + 1;
      continue;
    }

    // 跳过明显的正文（含句号且较长）
    if (trimmed.length > 40 && /[。；！？]/.test(trimmed)) {
      charOffset += line.length + 1;
      continue;
    }

    // 跳过页码
    if (/^---\s*第\s*\d+\s*页\s*---/.test(trimmed) || /^\d+$/.test(trimmed)) {
      charOffset += line.length + 1;
      continue;
    }

    // 可疑条件：短行 + 上下文有较长行（标题通常比周围正文短）
    const prevLine = i > 0 ? lines[i - 1].trim() : '';
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
    const isShort = trimmed.length <= 40;
    const neighborsLonger =
      (prevLine.length > trimmed.length * 2 || nextLine.length > trimmed.length * 2);

    // 编号前缀：阿拉伯数字、中文数字、括号编号、字母/罗马数字
    const hasNumberPrefix =
      /^\d+(\.\d+)*[\s.、．]/.test(trimmed) ||
      /^[一二三四五六七八九十]+[、．.\s]/.test(trimmed) ||
      /^[(（][\d一二三四五六七八九十a-zA-Z]+[)）]/.test(trimmed) ||
      /^[A-Z]|[IVXivx]{1,5}[\.．)\s]/.test(trimmed);

    // 标题关键词：增加考试题型和步骤类词汇
    const hasHeadingKeyword = /(章|节|引言|结论|方法|实验|结果|分析|定义|定理|证明|例|习题|问题|总结|概述|基础|原理|应用|步骤|阶段|考点|题型)/.test(trimmed);

    // 考试题型标记：例题/例/习题/练习/问题/题目/Question/Problem/Exercise/Step/阶段
    const isExamOrStep = /^(?:例题|例|习题|练习|问题|题目|Question|Problem|Exercise|Step|阶段|Phase|Part)\s*[\d一二三四五六七八九十]+/i.test(trimmed);

    if (isShort && (neighborsLonger || hasNumberPrefix || hasHeadingKeyword || isExamOrStep)) {
      // 取上下文
      const ctxStart = Math.max(0, lineStart - 50);
      const ctxEnd = Math.min(text.length, lineStart + trimmed.length + 50);
      const before = text.slice(ctxStart, lineStart).replace(/\n+/g, ' ').trim().slice(-30);
      const after = text.slice(lineStart + trimmed.length, ctxEnd).replace(/\n+/g, ' ').trim().slice(0, 30);

      suspicious.push({
        text: trimmed,
        start: lineStart,
        before,
        after
      });
    }

    charOffset += line.length + 1;
  }

  // 限制可疑行数量，避免 LLM 成本过高
  const maxSuspicious = 60;
  if (suspicious.length > maxSuspicious) {
    // 均匀采样
    const step = suspicious.length / maxSuspicious;
    const sampled = [];
    for (let i = 0; i < maxSuspicious; i++) {
      sampled.push(suspicious[Math.floor(i * step)]);
    }
    suspicious.length = 0;
    suspicious.push(...sampled);
  }

  if (suspicious.length === 0) return [];

  // 构造 LLM prompt：给每个可疑行附带前后 2 行原文上下文
  const suspiciousBlocks = suspicious.map((item, i) => {
    const lineIndex = findLineIndex(lineOffsets, item.start);
    const ctx = getContextLines(lines, lineIndex, 2);
    const ctxText = ctx.map(l =>
      `${l.isCandidate ? '>>' : '  '} ${String(l.lineNum).padStart(3)} | ${l.text}`
    ).join('\n');
    return `[可疑行 ${i + 1}] "${item.text}"\n${ctxText}`;
  }).join('\n\n');

  const timeoutMs = options.timeoutMs || 60000;
  const maxTokens = options.maxTokens || 1024;

  const response = await runLLMTask(provider, 'heading-discover', {
    temperature: 0.1,
    maxTokens,
    timeoutMs,
    _vars: { suspiciousBlocks }
  });

  // 解析响应
  const decisions = parseHeadingDecisions(response);

  // 构建新发现的标题
  const discovered = [];
  for (const d of decisions) {
    if (d.isHeading === false) continue;
    const item = suspicious[d.index - 1];
    if (!item) continue;

    // 再次检查去重
    if (existingTitles.has(item.text)) continue;

    const level = (typeof d.level === 'number' && d.level >= 1 && d.level <= 6) ? d.level : 3;
    discovered.push({
      id: `llm_h_${discovered.length}`,
      title: item.text,
      level,
      start: item.start,
      end: item.start + item.text.length,
      page: 0,
      source: { start: item.start, end: item.start + item.text.length }
    });
    existingTitles.add(item.text); // 防止重复添加
  }

  return discovered;
}

/**
 * 从扁平列表重建标题树
 */
function rebuildHeadingTree(flat) {
  // 按 start 排序
  const sorted = [...flat].sort((a, b) => (a.start || 0) - (b.start || 0));

  // 重新计算 end
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].end = i < sorted.length - 1 ? sorted[i + 1].start : sorted[i].end;
  }

  // 构建树
  const root = { id: 'root', level: 0, title: '文档根', children: [], start: 0, end: 0 };
  const stack = [root];

  for (const item of sorted) {
    const node = { ...item, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root.children;
}
