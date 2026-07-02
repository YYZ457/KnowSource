/**
 * @file exam-concept-extractor.js
 * @description 试卷/试题专用的考点概念提取器。
 * 思路：先把文本拆成一道道小题，再针对每道小题让 LLM 推断它真正考查的上位概念/知识点，
 * 而不是从全文泛泛地抽取术语。
 */

// 本地副本：避免与 llm-extractor.js 形成循环依赖
import { runLLMTask } from '../prompts/run-task.js';
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
      } catch (e) {}
      end = text.indexOf(']', end + 1);
    }
    start = text.indexOf('[', start + 1);
  }
  return null;
}

// 常见题号模式：1. / 2) / (3) / （4） / 5．
const QUESTION_NUMBER_PATTERN = /^\s*(?:\d+[\.．)）]|\(\d+\)|（\d+）)\s*/;

// 试卷大题标题（如 一、选择题）
const SECTION_HEADER_PATTERN = /^\s*(?:第\s*[一二三四五六七八九十]+\s*[章编节部分]|\d+[\.．、])\s*(?:选择|填空|解答|判断|计算|证明|问答|综合|分析|应用|实验|论述|简答|名词解释)(?:题|部分|大题)?/;

// 答案/解析页开始标记
const SOLUTION_START_PATTERN = /参考答案|答案解析|试题解答|解答与评分|评分标准|标准答案/;

// 试卷头部强特征：通常出现在文件最前面几行
const EXAM_HEADER_PATTERN = /试卷|考试|课程名称|考试时间|考试方式|密封|得分|评卷人|阅卷人|准考证号|学号|姓名|年级|专业|班级/;

// 检测样本长度控制
const HEADER_SAMPLE_MAX_LINES = 30;
const HEADER_SAMPLE_MAX_CHARS = 1500;
const BODY_SAMPLE_MAX_CHARS = 6000;

/**
 * 快速规则判断文档是否为试卷。
 * 策略：先看文件头部是否有试卷头部特征；若头部信号强，可降低题号数量门槛。
 * 若头部信号弱，则回退到“大量题号 + 试卷关键词”的原有规则。
 */
export function detectExamPaper(text) {
  if (!text || text.length < 200) return false;

  const bodySample = text.slice(0, BODY_SAMPLE_MAX_CHARS);
  const bodyLines = bodySample.split('\n');

  // 头部样本：取前 N 行，再截断到固定字符，避免把封面/目录页也当作头部
  const headerLines = bodyLines.slice(0, HEADER_SAMPLE_MAX_LINES);
  const headerSample = headerLines.join('\n').slice(0, HEADER_SAMPLE_MAX_CHARS);

  let questionCount = 0;
  for (const line of bodyLines) {
    if (QUESTION_NUMBER_PATTERN.test(line)) questionCount++;
  }

  const examKeywords = /选择|填空|解答|判断|证明|计算|得分|满分|共\s*\d+\s*分|每小题|第\s*\d+\s*页\s*共\s*\d+\s*页/;
  const hasExamKeywords = examKeywords.test(bodySample);
  const hasHeaderPattern = EXAM_HEADER_PATTERN.test(headerSample);

  // 头部信号强：有典型试卷抬头 + 至少 2 道题号，即可认为很可能是试卷
  if (hasHeaderPattern && questionCount >= 2) return true;

  // 保守规则：至少 3 道题号 + 试卷关键词
  return questionCount >= 3 && hasExamKeywords;
}

/**
 * 用 LLM 对头部样本做二次确认，区分“考试试卷/大量试题”与“教材/讲义中的少量习题”。
 * 仅当规则初筛通过且存在可用 provider 时才会调用模型。
 */
export async function detectExamPaperAsync(text, provider, options = {}) {
  // 1. 先做规则过滤，通不过直接返回 false
  if (!detectExamPaper(text)) return false;

  // 2. 没有可用模型或显式关闭 LLM 时，回退到规则结果
  if (!provider || provider.name === 'stub' || options.useLLM === false) return true;

  // 3. 取头部样本让模型判断
  const bodyLines = text.slice(0, BODY_SAMPLE_MAX_CHARS).split('\n');
  const headerSample = bodyLines
    .slice(0, HEADER_SAMPLE_MAX_LINES)
    .join('\n')
    .slice(0, HEADER_SAMPLE_MAX_CHARS);

  try {
    const response = await runLLMTask(provider, 'exam-detect-llm', {
      temperature: 0.1,
      maxTokens: 256,
      responseFormat: 'json',
      timeoutMs: options.examDetectTimeoutMs || 15000,
      _vars: { sample: headerSample }
    });

    const result = parseExamPaperDetectResponse(response);
    const isExam = !!result?.isExamPaper;
    const confidence = typeof result?.confidence === 'number' ? result.confidence : 0.5;
    const threshold = options.examDetectConfidenceThreshold || 0.7;

    return isExam && confidence >= threshold;
  } catch (e) {
    console.warn('[exam-concept-extractor] LLM 试卷判定失败，回退到规则判断:', e.message);
    return true;
  }
}

function parseExamPaperDetectResponse(response) {
  if (!response) return null;
  // 先尝试完整解析
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.isExamPaper === 'boolean') return parsed;
    } catch (e) {}
  }
  // 兜底：从文本中提取第一个合法 JSON 对象
  let start = trimmed.indexOf('{');
  while (start !== -1) {
    let end = trimmed.indexOf('}', start);
    while (end !== -1) {
      try {
        const candidate = trimmed.slice(start, end + 1);
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed.isExamPaper === 'boolean') return parsed;
      } catch (e) {}
      end = trimmed.indexOf('}', end + 1);
    }
    start = trimmed.indexOf('{', start + 1);
  }
  return null;
}

/**
 * 把试卷文本拆成大题段，再拆成单个小题。
 *
 * 会自动剔除答案/解析页内容，避免把解答步骤误当作题目。
 *
 * @param {string} text - 试卷原始文本。
 * @returns {Array<{title: string, questions: string[], buffer: string[]}>}
 *   大题分段数组，每段包含标题、小题列表和原始行缓冲。
 */
export function parseQuestions(text) {
  // 去掉答案/解析页，避免把解答步骤误当作新题目
  const solutionMatch = text.search(SOLUTION_START_PATTERN);
  const questionText = solutionMatch > 0 ? text.slice(0, solutionMatch) : text;

  const lines = questionText.split('\n');
  const sections = [];
  let currentSection = { title: '正文', questions: [], buffer: [] };

  // 第一步：按大题标题分段
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (SECTION_HEADER_PATTERN.test(trimmed)) {
      if (currentSection.questions.length > 0 || currentSection.buffer.length > 0) {
        sections.push(finishSection(currentSection));
      }
      currentSection = { title: trimmed, questions: [], buffer: [] };
    } else {
      currentSection.buffer.push(line);
    }
  }
  if (currentSection.questions.length > 0 || currentSection.buffer.length > 0) {
    sections.push(finishSection(currentSection));
  }

  // 第二步：每个大题段再拆小题
  const allQuestions = [];
  for (const section of sections) {
    const questions = splitSectionIntoQuestions(section.content);
    for (const q of questions) {
      allQuestions.push({
        sectionTitle: section.title,
        number: q.number,
        text: q.text
      });
    }
  }

  return allQuestions;
}

function finishSection(section) {
  return {
    title: section.title,
    content: section.buffer.join('\n').trim()
  };
}

function splitSectionIntoQuestions(content) {
  const lines = content.split('\n');
  const questions = [];
  let current = null;

  // 页码/页眉模式
  const pageMarkerPattern = /第\s*\d+\s*页\s*[\/／]?\s*共\s*\d+\s*页/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 跳过页码、页眉、纯数字行
    if (pageMarkerPattern.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;

    const match = trimmed.match(QUESTION_NUMBER_PATTERN);
    if (match) {
      if (current) questions.push(current);
      current = {
        number: match[0].trim(),
        text: trimmed.slice(match[0].length).trim()
      };
    } else if (current) {
      current.text += '\n' + trimmed;
    }
  }
  if (current) questions.push(current);

  return questions;
}

/**
 * 批量从试卷小题中提取考点概念。
 *
 * 将小题按批次送入 LLM 分析，每批返回该批题目涉及的考点术语。
 *
 * @param {Array<string>} questions - 试卷小题文本数组。
 * @param {Object} provider - LLM 服务提供者实例。
 * @param {Object} [options={}] - 提取选项。
 * @param {number} [options.examConceptBatchSize] - 每批送入 LLM 的小题数量。
 * @param {number} [options.maxTokens] - LLM 返回最大 token 数。
 * @returns {Promise<Array<{term: string, question: string}>>}
 *   考点概念数组，每个考点关联其来源小题。
 * @throws {Error} 当 LLM 调用失败且无回退时抛出。
 */
export async function extractConceptsFromQuestions(questions, provider, options = {}) {
  const batchSize = options.examConceptBatchSize || (isCloudProvider(provider) ? 10 : 5);
  const allConcepts = [];

  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    const questionText = batch.map((q, idx) => {
      return `题号：${q.number || idx + 1}\n题目：${q.text}`;
    }).join('\n\n---\n\n');

    try {
      const response = await runLLMTask(provider, 'exam-concept-extract', {
        temperature: 0.1,
        maxTokens: options.maxTokens || 1024,
        timeoutMs: options.timeoutMs || 120000,
        _vars: { questionText }
      });

      const concepts = parseQuestionConceptResponse(response);
      for (const c of concepts) {
        if (c && c.concept) {
          allConcepts.push({
            term: c.concept,
            score: c.importance || 1.0,
            sourceQuestion: c.questionNumber || '',
            reason: c.reason || ''
          });
          // 也加入相关概念
          if (Array.isArray(c.related)) {
            for (const r of c.related) {
              allConcepts.push({ term: r, score: 0.7, sourceQuestion: c.questionNumber || '' });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[exam-concept-extractor] 批量提取考点失败:', e.message);
    }
  }

  return deduplicateConcepts(allConcepts);
}

function parseQuestionConceptResponse(response) {
  const arr = extractValidJsonArray(response);
  if (arr && Array.isArray(arr)) return arr;

  // 兜底：逐行找 JSON 对象
  const results = [];
  const objMatches = response.match(/\{[^}]+\}/g) || [];
  for (const m of objMatches) {
    try {
      const parsed = JSON.parse(m);
      if (parsed.concept) results.push(parsed);
    } catch (e) {}
  }
  return results;
}

function deduplicateConcepts(concepts) {
  const seen = new Map();
  for (const c of concepts) {
    const key = normalizeConcept(c.term);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || c.score > existing.score) {
      seen.set(key, { ...c, term: c.term });
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score);
}

function normalizeConcept(term) {
  return term
    .toLowerCase()
    .replace(/[\s（）()\[\]【】]/g, '')
    .replace(/[：:]/g, '')
    .trim();
}

function isCloudProvider(provider) {
  if (!provider) return false;
  if (provider.name === 'stub' || provider.name === 'ollama' || provider.name === 'huggingface') return false;
  if (provider.vendor === 'ollama' || provider.vendor === 'huggingface') return false;
  return true;
}

/**
 * 试卷考点提取主入口：检测试卷 -> 解析题目 -> 提取考点。
 *
 * @param {string} text - 待分析的文档文本。
 * @param {Object} provider - LLM 服务提供者实例。
 * @param {Object} [options={}] - 提取选项（透传给子步骤）。
 * @param {Function} [options.onProgress] - 进度回调。
 * @param {number} [options.examDetectConfidenceThreshold] - 试卷判定的置信度阈值，默认 0.7。
 * @returns {Promise<Array<{term: string, question: string}>|null>}
 *   考点概念数组；若文档不是试卷则返回 null。
 */
export async function extractExamConcepts(text, provider, options = {}) {
  const onProgress = options.onProgress;
  const isExam = await detectExamPaperAsync(text, provider, options);
  if (!isExam) return null;

  if (onProgress) onProgress({ stage: 'exam-concepts', percent: 86, log: '检测到试卷，正在按题目提取考点...' });

  const questions = parseQuestions(text);
  if (questions.length === 0) return null;

  const concepts = await extractConceptsFromQuestions(questions, provider, options);
  return concepts;
}
