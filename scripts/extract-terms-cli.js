/**
 * @file extract-terms-cli.js
 * @description 从 PDF/文本中提取关键术语的独立 CLI 工具。
 *   流程：PDF 解析（pdfjs-dist） → 标题/字号感知分块 → LLM 抽取 →
 *         重复截断 → 全局去重 → 多轮 LLM 规范化。
 *   专为本地小模型优化，不依赖硬编码标题规则。
 *
 * 用法：
 *   node scripts/extract-terms-cli.js <PDF路径|文本路径> [选项]
 *
 * 常用选项：
 *   --model <模型名>            必填（运行 LLM 时）
 *   --heading-split             推荐：按标题/字号层级分块
 *   --pdf-parser <pdfjs|pdfparse>  默认 pdfjs
 *   --run-llm                   调用 LLM 抽取并规范化术语
 *   --max-terms-per-chunk <N>   每块上限（0 不限制）
 *   --ollama-url <url>
 *
 * 示例：
 *   node scripts/extract-terms-cli.js ./my.pdf --model qwen2.5:1.5b --heading-split --run-llm
 */

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// ============================================================
// 命令行解析
// ============================================================
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const val = argv[i + 1];
      args[key.slice(2)] = val !== undefined && !val.startsWith('--') ? val : true;
      if (args[key.slice(2)] !== true) i++;
    } else {
      args._.push(key);
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const DEFAULT_PDF = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Desktop', 'PSSnotesP3t.pdf');
const inputPath = args._[0] || DEFAULT_PDF;
const providerName = (args.provider || 'ollama').toLowerCase();
const modelName = (args.model || '').toLowerCase();
const forcedCapability = args.capability?.toLowerCase();
const useLLMSplit = !!args['llm-split'];
const useHeadingSplit = !!args['heading-split'];
const headingLevel = args['heading-level'] ? parseInt(args['heading-level'], 10) : null;
const ollamaUrl = (args['ollama-url'] || 'http://127.0.0.1:11434').replace(/\/$/, '');
const pdfParser = (args['pdf-parser'] || 'pdfjs').toLowerCase();
const runLLM = !!args['run-llm'];

function getOutDir() {
  const rootDir = path.resolve(__dirname, '..');
  if (useHeadingSplit) return path.join(rootDir, 'debug-output-heading-split');
  if (useLLMSplit) return path.join(rootDir, 'debug-output-llm-split');
  return path.join(rootDir, 'debug-output');
}
const OUT_DIR = getOutDir();

// ============================================================
// 从 core/graph/llm-extractor.js 复制的自适应参数逻辑
// ============================================================
function resolveCapabilityLevel(provider, model) {
  if (forcedCapability && ['weak', 'medium', 'strong'].includes(forcedCapability)) {
    return forcedCapability;
  }

  const isSmallParam = /(:0\.5b|:1b|:1\.5b|:2b|:3b|0\.5b|1b|1\.5b|2b|3b|tiny|small)/.test(model);
  const isMediumParam = /(:7b|:8b|:13b|7b|8b|13b|phi3|gemma2:2|llama3\.2|qwen2\.5:1|qwen2\.5:3)/.test(model);

  if (provider === 'stub') return 'weak';
  if (isSmallParam) return 'weak';
  if (isMediumParam) return 'medium';
  return 'strong';
}

function resolveAdaptiveOptions(textLen, provider, model, userOptions = {}) {
  const capabilityLevel = resolveCapabilityLevel(provider, model);

  // chunkSize：小模型上下文小，给短 chunk；长文档避免单块过大
  let chunkSize = userOptions.chunkSize;
  if (!chunkSize) {
    if (capabilityLevel === 'weak') {
      chunkSize = textLen > 30000 ? 1800 : (textLen > 10000 ? 2200 : 2800);
    } else if (capabilityLevel === 'medium') {
      chunkSize = textLen > 50000 ? 3000 : (textLen > 20000 ? 3500 : 4000);
    } else {
      chunkSize = textLen > 50000 ? 3500 : (textLen > 20000 ? 4000 : 5000);
    }
  }

  // overlap：一般为 chunk 的 10%-15%，但至少 100 字
  let overlap = userOptions.overlap;
  if (overlap === undefined) {
    overlap = Math.max(100, Math.floor(chunkSize * 0.12));
  }

  // 每块术语数：小模型容易胡言，限制数量提高质量；大模型可以多抽
  // 传 0 表示不限制每块术语数
  let maxTermsPerChunk = userOptions.maxTermsPerChunk;
  if (maxTermsPerChunk === undefined) {
    maxTermsPerChunk = capabilityLevel === 'weak' ? 20 : (capabilityLevel === 'medium' ? 30 : 50);
  }

  // 总术语数：按文本长度弹性伸缩，避免过短/过长
  let maxTerms = userOptions.maxTerms;
  if (!maxTerms) {
    maxTerms = Math.min(120, Math.max(40, Math.floor(textLen / 600)));
  }

  // 温度：抽取术语要求确定性，统一较低温度
  let temperature = userOptions.temperature;
  if (temperature === undefined) {
    temperature = capabilityLevel === 'weak' ? 0.05 : 0.1;
  }

  // maxTokens：按每块术语数估算
  let maxTokens = userOptions.maxTokens;
  if (!maxTokens) {
    maxTokens = capabilityLevel === 'weak' ? 512 : 1024;
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
    maxTerms,
    temperature,
    maxTokens,
    stop,
    capabilityLevel
  };
}

// ============================================================
// PDF 文本提取：默认用 pdfjs-dist（保留字号/位置），可回退 pdf-parse
// ============================================================

async function extractTextWithPdfJs(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  let fullText = '';
  const allItems = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    const items = textContent.items.map(item => {
      const a = item.transform[0], b = item.transform[1];
      const fontSize = Math.sqrt(a * a + b * b);
      return {
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        fontSize,
        width: item.width || 0,
        height: item.height || fontSize
      };
    }).filter(it => it.str && it.str.trim().length > 0);

    allItems.push(...items);

    // 按 Y 坐标聚合成行（允许 2px 误差）
    const yGroups = {};
    for (const it of items) {
      const yKey = Math.round(it.y * 10); // 精度 0.1
      if (!yGroups[yKey]) yGroups[yKey] = [];
      yGroups[yKey].push(it);
    }

    const lines = Object.values(yGroups)
      .map(group => {
        group.sort((a, b) => a.x - b.x);
        const text = group.map(it => it.str).join('');
        const maxFontSize = Math.max(...group.map(it => it.fontSize));
        const avgY = group.reduce((s, it) => s + it.y, 0) / group.length;
        return { y: avgY, text: text.trim(), fontSize: maxFontSize };
      })
      .filter(line => line.text.length > 0);

    // 按 Y 从大到小排序（PDF 坐标原点在左下角）
    lines.sort((a, b) => b.y - a.y);

    for (const line of lines) {
      fullText += `[fs${line.fontSize.toFixed(1)}]${line.text}\n`;
    }
    fullText += '\n';
  }

  const fontSizes = allItems.map(it => it.fontSize).sort((a, b) => a - b);
  const fontSizeStats = {
    median: fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 10,
    max: fontSizes.length > 0 ? fontSizes[fontSizes.length - 1] : 10
  };

  return { text: fullText, fontSizeStats, numPages: pdf.numPages };
}

async function extractText(buffer, parser) {
  if (parser === 'pdfparse') {
    const data = await pdf(buffer);
    return { text: data.text, fontSizeStats: null, numPages: data.numpages };
  }
  return extractTextWithPdfJs(buffer);
}

// ============================================================
// 文本预处理与分块（与项目保持一致）
// ============================================================
function preprocessTextForChunking(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  let inToc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      cleaned.push('');
      continue;
    }

    if (/^---\s*第\d+页\s*---/.test(trimmed)) continue;
    if (/^\d{1,3}$/.test(trimmed)) continue;

    if (/^\d+(?:\.\d+)*\s+\S.*\s+\d+$/.test(trimmed) && /\.{3,}|\s\d+$/.test(trimmed)) {
      inToc = true;
      continue;
    }

    if (/^\s*\.{2,}\s*$/.test(trimmed) || /\.{5,}/.test(trimmed)) continue;

    if (/^\[fs\d+\.?\d*\]/.test(trimmed)) {
      cleaned.push(trimmed);
      continue;
    }

    if (/^[∫∬∭∮∯∰∑∏∂∇√∞∈∉∪∩⊂⊃⊆⊇]/.test(trimmed)) continue;
    if (/^[\d\s+\-*=<>^~∫∬∭∮∯∰∑∏∂∇√∞αβγδεζηθικλμνξοπρστυφχψω\s]+$/.test(trimmed)) continue;

    if (inToc && trimmed.length > 20 && !/^\d+(?:\.\d+)*\s/.test(trimmed)) {
      inToc = false;
    }
    if (inToc) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n');
}

function chunkText(text, chunkSize, overlap) {
  if (!text || text.trim().length === 0) return [];
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.trim().length === 0) return [];
  if (cleanedText.length <= chunkSize) return [cleanedText.trim()];

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

// ============================================================
// LLM-driven 分块：让模型自己决定在哪里切
// ============================================================

async function llmDecideSplitPoints(paragraphs, model, baseUrl) {
  // 给 LLM 看段落摘要，最多 80 个，避免上下文爆炸
  const maxParas = 80;
  const step = Math.max(1, Math.ceil(paragraphs.length / maxParas));
  const sampled = [];
  for (let i = 0; i < paragraphs.length; i += step) {
    const preview = paragraphs[i].replace(/\n/g, ' ').slice(0, 100);
    sampled.push(`${i}. ${preview}`);
  }

  const prompt = `你是一名文档结构分析助手。下面是一篇学术文档的段落索引和前100字摘要。
请根据主题边界，决定哪些段落应该作为新 chunk 的起点。

分块原则：
1. 每个 chunk 尽量包含一个完整的主题、章节或知识点。
2. 封面、目录、前言、附录等元内容应该单独成块或并入相邻内容。
3. 不要在定义、定理、例题、证明中间切断。
4. 相邻的相似主题（如连续几个例题）可以合并为一个 chunk。
5. 最终 chunk 大小建议 1500-3000 字符（不作为硬性限制，以主题完整优先）。

只返回合法 JSON 数组，元素为新 chunk 起点的段落索引（从0开始）：
[0, 3, 8, 15, ...]
不要任何解释，不要 markdown 代码块。

段落摘要：
${sampled.join('\n')}`;

  const resp = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 1024 }
    })
  });

  if (!resp.ok) throw new Error(`Ollama 请求失败: ${resp.status}`);
  const data = await resp.json();
  return parseSplitResponse(data.response, paragraphs.length);
}

async function callOllamaExtractTerms(prompt, model, baseUrl) {
  const resp = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.05, num_predict: 512 }
    })
  });

  if (!resp.ok) throw new Error(`Ollama 请求失败: ${resp.status}`);
  const data = await resp.json();
  return data.response;
}

function parseTermsFromLLMOutput(raw) {
  if (!raw) return null;
  let text = raw.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try {
    const arr = JSON.parse(arrMatch[0]);
    if (!Array.isArray(arr)) return null;
    const terms = arr.filter(x => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());
    return sanitizeTerms(terms);
  } catch {
    return null;
  }
}

function sanitizeTerms(terms) {
  if (!terms || terms.length === 0) return [];
  const result = [];
  let repeatCount = 1;
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (i > 0 && term === terms[i - 1]) {
      repeatCount++;
    } else {
      repeatCount = 1;
    }
    // 检测到连续重复 3 次则截断
    if (repeatCount >= 3) break;
    // 基础过滤：过短、纯数字、纯符号
    if (term.length < 2) continue;
    if (/^[\d\s\.\(\)\[\]\{\}\+\-\*\/\^=]+$/.test(term)) continue;
    result.push(term);
  }
  return result;
}

async function normalizeOneBatch(batch, model, baseUrl, roundNum, batchNum) {
  const prompt = `你是一名学术术语规范化专家。请对下面这组术语进行规范化处理：

任务：
1. 同义合并：把相同概念的不同说法合并成一个最标准的术语。例如"正态分布"和"高斯分布"合并为"正态分布"。
2. 过滤泛化词：删除不是具体学科术语的泛化词，例如"定义"、"定理"、"引理"、"命题"、"方法"、"结果"、"例子"、"说明"、"性质"、"结论"、"计算"、"变量"、"函数"、"分布"（单独出现时）等。

重要规则：
- 只从输入列表中选择或合并，不要编造新术语。
- 保留真正具有学科专业性的术语（如"大数定律"、"马尔可夫链"、"置信区间"）。
- 输出必须是合法 JSON 数组，不要任何解释。

输出示例：["标准化术语1", "标准化术语2", ...]

术语列表：
${JSON.stringify(batch)}`;

  const resp = await callOllamaExtractTerms(prompt, model, baseUrl);
  const parsed = parseTermsFromLLMOutput(resp);
  if (parsed && parsed.length > 0) {
    console.log(`[normalize] 轮次${roundNum} 批次${batchNum}: ${parsed.length} 个术语`);
    return parsed;
  }
  console.warn(`[normalize] 轮次${roundNum} 批次${batchNum} 解析失败，保留原术语`);
  return batch;
}

async function normalizeTermsWithLLM(terms, model, baseUrl) {
  const BATCH_SIZE = 12;
  let current = [...terms];
  const maxRounds = 4;

  for (let round = 1; round <= maxRounds; round++) {
    const normalized = [];
    const totalBatches = Math.ceil(current.length / BATCH_SIZE);

    for (let i = 0; i < current.length; i += BATCH_SIZE) {
      const batch = current.slice(i, i + BATCH_SIZE);
      const result = await normalizeOneBatch(batch, model, baseUrl, round, `${Math.floor(i / BATCH_SIZE) + 1}/${totalBatches}`);
      normalized.push(...result);
    }

    const next = [...new Set(normalized.map(t => t.trim()).filter(t => t.length >= 2))];
    console.log(`[normalize] 轮次${round} 完成: ${current.length} → ${next.length}`);

    if (next.length === current.length) {
      console.log('[normalize] 已收敛，停止迭代');
      return next;
    }
    current = next;
  }

  return current;
}

function parseSplitResponse(raw, maxLen) {
  if (!raw) return null;
  let text = raw.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try {
    const arr = JSON.parse(arrMatch[0]);
    if (!Array.isArray(arr)) return null;
    return [...new Set(arr)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < maxLen)
      .sort((a, b) => a - b);
  } catch {
    return null;
  }
}

function splitByParagraphIndices(paragraphs, indices, chunkSize, overlap) {
  if (!indices || indices.length === 0) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const themeChunks = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = sorted[i + 1] !== undefined ? sorted[i + 1] : paragraphs.length;
    const text = paragraphs.slice(start, end).join('\n\n').trim();
    if (text) themeChunks.push(text);
  }

  // 主题块如果还太长，按规则再细分，保证小模型上下文吃得下
  const finalChunks = [];
  for (const theme of themeChunks) {
    if (theme.length <= chunkSize) {
      finalChunks.push(theme);
    } else {
      finalChunks.push(...chunkText(theme, chunkSize, overlap));
    }
  }
  return finalChunks.filter(c => c.length > 0);
}

async function chunkTextWithLLM(text, model, baseUrl, chunkSize, overlap) {
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.length <= chunkSize) return [cleanedText.trim()];

  const paragraphs = cleanedText.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
  console.log(`\n[llm-split] 共 ${paragraphs.length} 个段落，正在请求 ${model} 决定分块点...`);

  try {
    const splitPoints = await llmDecideSplitPoints(paragraphs, model, baseUrl);
    if (splitPoints && splitPoints.length > 0) {
      console.log(`[llm-split] 模型返回切分点: [${splitPoints.join(', ')}]`);
      return splitByParagraphIndices(paragraphs, splitPoints, chunkSize, overlap);
    }
  } catch (e) {
    console.warn('[llm-split] LLM 分块失败，回退到规则分块:', e.message);
  }

  return chunkText(text, chunkSize, overlap);
}

// ============================================================
// 标题层级分块：按最低层级标题切分，太长再细分，太短再合并
// ============================================================

function chunkTextByFontSizeJumps(text, fontSizeStats, chunkSize, overlap) {
  if (!fontSizeStats) {
    console.warn('[heading-split] 无字号信息，无法按字号切分，回退到规则分块');
    return chunkText(text, chunkSize, overlap);
  }

  const lines = text.split('\n');
  const headingThreshold = Math.max(14, fontSizeStats.median * 1.3);
  console.log(`[heading-split] 字号阈值: ${headingThreshold.toFixed(1)} (median=${fontSizeStats.median.toFixed(1)}, max=${fontSizeStats.max.toFixed(1)})`);

  const splitCharOffsets = [0];
  let charOffset = 0;
  for (const line of lines) {
    const m = line.match(/^\[fs([\d.]+)\]/);
    if (m) {
      const fs = parseFloat(m[1]);
      if (fs >= headingThreshold) {
        splitCharOffsets.push(charOffset);
      }
    }
    charOffset += line.length + 1;
  }

  const sorted = [...new Set(splitCharOffsets)].sort((a, b) => a - b);

  // 按切分点切分，并去除 [fsXX] 字号标记
  const rawChunks = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = sorted[i + 1] !== undefined ? sorted[i + 1] : text.length;
    const chunk = text.slice(start, end).replace(/^\[fs[\d.]+\]/gm, '').trim();
    if (chunk) rawChunks.push(chunk);
  }

  // 过滤掉纯目录/封面的开头块
  const contentChunks = rawChunks.filter(c => {
    const firstLines = c.split('\n').slice(0, 3).join(' ');
    return !/^(概率统计讲稿|Lecture notes|Contents|目录|前言|Preface)/i.test(firstLines.trim());
  });

  // 如果过滤后太少，保留全部
  const chunksToUse = contentChunks.length >= 3 ? contentChunks : rawChunks;

  // 合并过短块，细分过长块
  const merged = [];
  let current = '';
  const minChunkLen = 300;
  for (const chunk of chunksToUse) {
    if (!current) {
      current = chunk;
    } else if (current.length < minChunkLen || chunk.length < minChunkLen) {
      current += '\n\n' + chunk;
    } else {
      merged.push(current);
      current = chunk;
    }
  }
  if (current) merged.push(current);

  const finalChunks = [];
  for (const item of merged) {
    if (item.length <= chunkSize) {
      finalChunks.push(item);
    } else {
      const subChunks = chunkText(item, chunkSize, overlap);
      finalChunks.push(...subChunks);
    }
  }

  return finalChunks.filter(c => c.length > 0);
}

async function chunkTextByHeadings(text, fontSizeStats, chunkSize, overlap) {
  const cleanedText = preprocessTextForChunking(text);
  if (cleanedText.length <= chunkSize) return [cleanedText.trim()];

  const { extractHeadings, flattenHeadings } = await import('../core/extractor/headings.js');
  const tree = extractHeadings(cleanedText, { fontSizeStats });
  const flat = flattenHeadings(tree);

  // 如果 headings.js 识别到的标题太少，回退到字号突变切分
  if (flat.length < 5) {
    console.warn(`[heading-split] headings.js 只识别到 ${flat.length} 个标题，改用字号突变切分`);
    return chunkTextByFontSizeJumps(text, fontSizeStats, chunkSize, overlap);
  }

  // 选择切分层级：用户指定 > 最细层级（最大 level）
  const maxLevel = Math.max(...flat.map(h => h.level));
  const splitLevel = headingLevel || maxLevel;

  // 按选定层级切分
  const splitHeadings = flat.filter(h => h.level === splitLevel).sort((a, b) => a.start - b.start);
  if (splitHeadings.length === 0) {
    console.warn(`[heading-split] 未找到 level=${splitLevel} 的标题，改用字号突变切分`);
    return chunkTextByFontSizeJumps(text, fontSizeStats, chunkSize, overlap);
  }

  console.log(`[heading-split] 识别到 ${flat.length} 个标题（level 1-${maxLevel}），按 level=${splitLevel} 切分，共 ${splitHeadings.length} 个主题块`);

  const rawChunks = [];
  for (let i = 0; i < splitHeadings.length; i++) {
    const start = splitHeadings[i].start;
    const end = splitHeadings[i + 1] ? splitHeadings[i + 1].start : cleanedText.length;
    const chunk = cleanedText.slice(start, end).trim();
    if (chunk) rawChunks.push({ title: splitHeadings[i].title, text: chunk });
  }

  // 合并过短的相邻块（主题碎片不值得单独调用 LLM）
  const merged = [];
  let current = null;
  const minChunkLen = 300;
  for (const item of rawChunks) {
    if (!current) {
      current = item;
    } else if (current.text.length < minChunkLen || item.text.length < minChunkLen) {
      current.text += '\n\n' + item.text;
      current.title += ' / ' + item.title;
    } else {
      merged.push(current);
      current = item;
    }
  }
  if (current) merged.push(current);

  // 对仍超过 chunkSize 的主题块再细分
  const finalChunks = [];
  for (const item of merged) {
    if (item.text.length <= chunkSize) {
      finalChunks.push(item.text);
    } else {
      console.log(`[heading-split] 主题 "${item.title}" 过长（${item.text.length} 字符），内部再细分`);
      const subChunks = chunkText(item.text, chunkSize, overlap);
      finalChunks.push(...subChunks);
    }
  }

  return finalChunks.filter(c => c.length > 0);
}

function buildChunkPrompt(chunk, maxTermsPerChunk) {
  const limitText = maxTermsPerChunk > 0
    ? `数量：最多 ${maxTermsPerChunk} 个，最少 3 个。`
    : '数量：不限制上限，但只保留真正有学科价值的核心术语，最少 3 个。';

  return `你是一名严谨的学术文本知识抽取助手。请从下面这段文本中提取关键知识点、核心概念和专业术语。

抽取要求：
1. 术语必须是文本中反复出现或被明确定义/解释的核心概念，不要抽取只出现一次的边缘词。
2. 每个术语必须是文本中实际出现的完整词组，不要生造、截断或拼接。
3. 优先抽取具有特定学科含义的专业术语，避免抽取泛化日常用语。

允许抽取的类型（仅限名词性术语）：
- 概念、定义、定理、定律、性质、法则
- 方法、算法、模型、假设、检验、估计量
- 结构、系统、空间、函数、变量、参数
- 重要物理量、特征量、指标

绝对禁止输出以下类型：
- 公式片段、数学符号、变量名（如 f(x)、dx、cov、x1）。
- 章节编号和标题片段（如 "1 引言"、"2.3 方法"）。
- 普通动词、代词、介词短语（如 "是一个"、"满足"、"我们"）。
- 泛化日常用语（如 "方法"、"问题"、"结果"、"内容"、"情况"）。
- 例题、例句、页码、图表说明文字。
- 不完整的断词（如被截断的术语片段）。

正例（好的术语）：正态分布、假设检验、大数定律、马尔可夫链、协方差矩阵
反例（不要输出）：函数、估计、模型、参数、分布、变量、方法、问题

输出要求：
- 长度 2-12 个字。
- 同义表达只保留一个最具代表性的。
- ${limitText}
- 只返回合法 JSON 数组，不要任何解释、编号或额外文字：
["术语1", "术语2", ...]

文本：
${chunk}`;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log(`\n输入 PDF: ${inputPath}\n`);

  if ((useLLMSplit || runLLM) && !modelName) {
    console.error('--llm-split / --run-llm 需要同时指定 --model，例如：--model qwen2.5:1.5b');
    process.exit(1);
  }

  if ((useLLMSplit || runLLM) && typeof fetch === 'undefined') {
    console.error('当前 Node 版本没有内置 fetch，请升级到 Node 18+，或安装 node-fetch');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`文件不存在: ${inputPath}`);
    console.error('用法：node debug-pdf-chunks.js [pdf路径] [选项]');
    console.error('选项：--model <模型名> --provider <openai|ollama|huggingface|stub>');
    console.error('       --capability <weak|medium|strong> --chunk-size <数字> --overlap <数字>');
    console.error('       --max-terms <数字> --max-terms-per-chunk <数字> --temperature <数字>');
    console.error('       --pdf-parser <pdfjs|pdfparse>');
    console.error('       --heading-split [--heading-level <数字>]');
    console.error('       --llm-split --ollama-url <url>');
    console.error('       --run-llm');
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputPath);
  const parsed = await extractText(buffer, pdfParser);
  const rawText = parsed.text;
  const fontSizeStats = parsed.fontSizeStats;

  const cleanedText = preprocessTextForChunking(rawText);

  const userOptions = {
    chunkSize: args['chunk-size'] ? parseInt(args['chunk-size'], 10) : undefined,
    overlap: args['overlap'] ? parseInt(args['overlap'], 10) : undefined,
    maxTerms: args['max-terms'] ? parseInt(args['max-terms'], 10) : undefined,
    maxTermsPerChunk: args['max-terms-per-chunk'] ? parseInt(args['max-terms-per-chunk'], 10) : undefined,
    temperature: args['temperature'] ? parseFloat(args['temperature']) : undefined
  };

  const opts = resolveAdaptiveOptions(cleanedText.length, providerName, modelName, userOptions);

  console.log('===== PDF 基本信息 =====');
  console.log(`PDF 解析器   : ${pdfParser}`);
  console.log(`页数         : ${parsed.numPages}`);
  console.log(`原始字符     : ${rawText.length}`);
  console.log(`清洗后字符   : ${cleanedText.length}`);
  if (fontSizeStats) {
    console.log(`中位字号     : ${fontSizeStats.median.toFixed(2)}`);
    console.log(`最大字号     : ${fontSizeStats.max.toFixed(2)}`);
  }

  console.log('\n===== 自适应参数（可强制覆盖）=====');
  console.log(`provider     : ${providerName}`);
  console.log(`model        : ${modelName || '(未指定)'}`);
  console.log(`capability   : ${opts.capabilityLevel}`);
  console.log(`split-mode   : ${useHeadingSplit ? 'heading-split（按标题层级）' : (useLLMSplit ? 'llm-split（LLM 决定）' : 'rule-based（规则分块）')}`);
  if (useHeadingSplit && headingLevel) console.log(`heading-level: ${headingLevel}（用户指定）`);
  console.log(`run-llm      : ${runLLM ? '是（将调用 LLM 抽取术语）' : '否'}`);
  console.log(`chunkSize    : ${opts.chunkSize}`);
  console.log(`overlap      : ${opts.overlap}`);
  console.log(`maxTermsPerChunk : ${opts.maxTermsPerChunk}`);
  console.log(`maxTerms (总) : ${opts.maxTerms}`);
  console.log(`temperature  : ${opts.temperature}`);
  console.log(`maxTokens    : ${opts.maxTokens}`);
  if (opts.stop) console.log(`stop         : ${JSON.stringify(opts.stop)}`);

  let chunks;
  if (useHeadingSplit) {
    chunks = await chunkTextByHeadings(rawText, fontSizeStats, opts.chunkSize, opts.overlap);
  } else if (useLLMSplit) {
    chunks = await chunkTextWithLLM(rawText, modelName, ollamaUrl, opts.chunkSize, opts.overlap);
  } else {
    chunks = chunkText(rawText, opts.chunkSize, opts.overlap);
  }
  console.log(`\n分块数       : ${chunks.length}`);

  console.log('\n===== 原始文本前 600 字符 =====');
  console.log(rawText.slice(0, 600));
  console.log('\n===== 清洗后文本前 600 字符 =====');
  console.log(cleanedText.slice(0, 600));

  console.log('\n===== 各分块概要 =====');
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const preview = c.replace(/\n/g, ' ').slice(0, 120);
    console.log(`\n[块 ${i + 1}/${chunks.length}] 长度=${c.length} 字符`);
    console.log(`  预览: ${preview}${c.length > 120 ? '...' : ''}`);
  }

  // 保存输出
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const summaryLines = [
    `PDF: ${inputPath}`,
    `PDF解析器: ${pdfParser}`,
    `页数: ${parsed.numPages}`,
    `原始字符: ${rawText.length}`,
    `清洗后字符: ${cleanedText.length}`,
    fontSizeStats ? `中位字号: ${fontSizeStats.median.toFixed(2)}` : '',
    fontSizeStats ? `最大字号: ${fontSizeStats.max.toFixed(2)}` : '',
    `provider: ${providerName}`,
    `model: ${modelName || '(未指定)'}`,
    `capability: ${opts.capabilityLevel}`,
    `split-mode: ${useHeadingSplit ? 'heading-split' : (useLLMSplit ? 'llm-split' : 'rule-based')}`,
    headingLevel ? `heading-level: ${headingLevel}` : '',
    `chunkSize: ${opts.chunkSize}`,
    `overlap: ${opts.overlap}`,
    `maxTermsPerChunk: ${opts.maxTermsPerChunk}`,
    `maxTerms: ${opts.maxTerms}`,
    `temperature: ${opts.temperature}`,
    `分块数: ${chunks.length}`,
    ''
  ];

  const llmResults = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildChunkPrompt(chunks[i], opts.maxTermsPerChunk);
    const fileName = `chunk-${String(i + 1).padStart(3, '0')}-prompt.txt`;
    fs.writeFileSync(path.join(OUT_DIR, fileName), prompt, 'utf-8');

    if (runLLM && modelName) {
      process.stdout.write(`\n[run-llm] 块 ${i + 1}/${chunks.length} 抽取中... `);
      try {
        const resp = await callOllamaExtractTerms(prompt, modelName, ollamaUrl);
        const terms = parseTermsFromLLMOutput(resp);
        const result = {
          chunk: i + 1,
          terms: terms || [],
          raw: resp,
          ok: !!terms && terms.length >= 3
        };
        llmResults.push(result);
        fs.writeFileSync(path.join(OUT_DIR, `chunk-${String(i + 1).padStart(3, '0')}-terms.txt`), resp, 'utf-8');
        console.log(`成功，${result.terms.length} 个术语`);
      } catch (e) {
        llmResults.push({ chunk: i + 1, terms: [], raw: e.message, ok: false });
        fs.writeFileSync(path.join(OUT_DIR, `chunk-${String(i + 1).padStart(3, '0')}-terms.txt`), `ERROR: ${e.message}`, 'utf-8');
        console.log(`失败: ${e.message}`);
      }
    }
  }

  if (runLLM && llmResults.length > 0) {
    const okCount = llmResults.filter(r => r.ok).length;
    const failCount = llmResults.length - okCount;
    const totalTerms = llmResults.reduce((s, r) => s + r.terms.length, 0);
    console.log(`\n===== LLM 抽取汇总 =====`);
    console.log(`总块数    : ${llmResults.length}`);
    console.log(`成功      : ${okCount}`);
    console.log(`失败      : ${failCount}`);
    console.log(`总术语数  : ${totalTerms}`);
    console.log(`平均每块  : ${(totalTerms / llmResults.length).toFixed(1)}`);

    const allTerms = llmResults.flatMap(r => r.terms);
    const uniqueTerms = [...new Set(allTerms)];

    console.log('\n[run-llm] 正在进行全局术语规范化...');
    const normalizedTerms = await normalizeTermsWithLLM(uniqueTerms, modelName, ollamaUrl);
    console.log(`[run-llm] 规范化完成: ${uniqueTerms.length} → ${normalizedTerms.length}`);

    fs.writeFileSync(path.join(OUT_DIR, 'all-terms.json'), JSON.stringify({
      summary: { total: llmResults.length, ok: okCount, fail: failCount, totalTerms, uniqueTerms: uniqueTerms.length, normalizedTerms: normalizedTerms.length },
      results: llmResults
    }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(OUT_DIR, 'global-terms.txt'), uniqueTerms.join('\n'), 'utf-8');
    fs.writeFileSync(path.join(OUT_DIR, 'normalized-terms.txt'), normalizedTerms.join('\n'), 'utf-8');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), summaryLines.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'raw.txt'), rawText, 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'cleaned.txt'), cleanedText, 'utf-8');

  console.log(`\n===== 输出文件已保存到 ${OUT_DIR} =====`);
  console.log('  summary.txt              - 分块统计与自适应参数');
  console.log(`  raw.txt                  - ${pdfParser} 提取的原始文本`);
  console.log('  cleaned.txt              - 清洗后文本');
  console.log('  chunk-001-prompt.txt ... - 每个 chunk 喂给 LLM 的完整 prompt');
  if (runLLM) {
    console.log('  chunk-001-terms.txt ...  - 每个 chunk 的 LLM 抽取结果');
    console.log('  all-terms.json           - 汇总后的术语统计');
    console.log('  global-terms.txt         - 全局去重后的术语列表');
    console.log('  normalized-terms.txt     - LLM 规范化后的最终术语列表');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
