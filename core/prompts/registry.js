/**
 * @module core/prompts/registry
 * 职责：LLM 任务元数据注册表 + 内置模板 + 用户自定义模板 + 任务禁用 + 模板渲染
 *
 * 设计要点：
 * - 内置模板定义在 templates.js 中，启动时即可展示，无需等待运行时捕获
 * - 用户在 PromptLab 中直接编辑模板（替换内置模板，而非额外的"覆盖"层）
 * - 运行时通过 renderTemplate 将 {{var}} 占位符替换为实际值
 * - 本模块属于 core 层，不依赖 services 或 Electron/DOM
 */
import { TEMPLATES, getBuiltinTemplate } from './templates.js';

/** @type {Map<string, {system?:string, user?:string}>} 用户自定义模板（替换内置模板） */
const userOverrides = new Map();

/** @type {Set<string>} 被用户禁用的任务 */
const disabledTasks = new Set();

/**
 * 全部 LLM 任务元数据。id 与 runLLMTask 调用处传入的 taskId 一一对应。
 * variables 列出该任务模板中可用的变量占位符，供 UI 展示与模板渲染使用。
 */
export const TASKS = [
  { id: 'doc-type-detect', name: '文档类型识别', category: '抽取', file: 'core/graph/llm-extractor.js', description: '判断文档类型(教材/试卷/论文/笔记/幻灯片)与学科领域', variables: ['sample'] },
  { id: 'cloud-term-extract', name: '云端术语抽取', category: '抽取', file: 'core/graph/llm-extractor.js', description: '云端模型按页批量提取关键知识点与专业术语', variables: ['batchText', 'domainHint'] },
  { id: 'term-refine', name: '术语质量二次校验', category: '抽取', file: 'core/graph/llm-extractor.js', description: '审核已抽取术语是否为领域核心术语，精炼或丢弃', variables: ['topicHint', 'termList'] },
  { id: 'chunk-term-extract', name: '分块术语抽取(弱模型)', category: '抽取', file: 'core/graph/llm-extractor.js', description: '弱/中模型对分块文本提取术语，内联 prompt + stop 序列', variables: ['chunk', 'countHint'] },
  { id: 'chunk-term-extract-strong', name: '分块术语抽取(强模型)', category: '抽取', file: 'core/graph/llm-extractor.js', description: '强模型对分块文本提取术语，system + few-shot 示例', variables: ['chunk', 'maxTerms'] },
  { id: 'specificity-scoring', name: '术语特异性评分', category: '抽取', file: 'core/graph/llm-extractor.js', description: '为候选术语打分(1-10)判断是否泛化词', variables: ['batchText'] },
  { id: 'llm-chunking', name: 'LLM 智能分块', category: '抽取', file: 'core/graph/llm-extractor.js', description: '根据段落摘要决定语义切分点', variables: ['summariesText'] },
  { id: 'term-normalize', name: '术语多轮规范化', category: '抽取', file: 'core/graph/llm-extractor.js', description: '同义合并与过滤，多轮迭代直到数量稳定', variables: ['batchJson'] },
  { id: 'full-graph-extract', name: '全文图谱抽取', category: '建图', file: 'core/graph/full-extract.js', description: '一次性从完整文档提取标题树、实体、关系', variables: ['maxTerms', 'maxHeadings', 'threshold', 'textLength', 'markedText'] },
  { id: 'relation-infer-r2', name: '第二轮关系推断', category: '建图', file: 'core/graph/full-extract.js', description: '基于实体列表与原文推断更多语义关系', variables: ['entityCount', 'entityList', 'existingRelStr', 'textExcerpt'] },
  { id: 'crosslink-llm', name: '跨文档语义连线', category: '建图', file: 'core/graph/crosslink.js', description: '判断不同文档的术语/标题对是否语义相关', variables: ['docInfo', 'lines'] },
  { id: 'exam-detect-llm', name: '试卷检测二次确认', category: '考题', file: 'core/extractor/exam-concept-extractor.js', description: 'LLM 判断文本片段来自试卷还是教材/讲义', variables: ['sample'] },
  { id: 'exam-concept-extract', name: '考题概念抽取', category: '考题', file: 'core/extractor/exam-concept-extractor.js', description: '分析每道试题考查的知识点/考点概念', variables: ['questionText'] },
  { id: 'cloud-heading-extract', name: '云端标题识别', category: '结构', file: 'core/extractor/llm-headings.js', description: '按页批量识别文档结构性标题与层级', variables: ['startPage', 'endPage', 'batchText'] },
  { id: 'heading-refine', name: '标题精炼判断', category: '结构', file: 'core/extractor/llm-headings.js', description: '根据上下文判断候选标题是否为真标题并修正层级', variables: ['blocks'] },
  { id: 'heading-discover', name: '标题补充发现', category: '结构', file: 'core/extractor/llm-headings.js', description: '判断可疑行是否为标题/章节名', variables: ['suspiciousBlocks'] }
];

const taskMap = new Map(TASKS.map(t => [t.id, t]));

/** 获取任务元数据 */
export function getTask(taskId) {
  return taskMap.get(taskId) || null;
}

/** 获取全部任务列表 */
export function getTaskList() {
  return TASKS.map(t => ({ ...t }));
}

// ============================================================
// 用户自定义模板管理
// ============================================================

/** 设置用户自定义模板（整体替换） */
export function setUserOverrides(overrides) {
  userOverrides.clear();
  if (!overrides || typeof overrides !== 'object') return;
  for (const [id, val] of Object.entries(overrides)) {
    if (val && typeof val === 'object') {
      userOverrides.set(id, { system: val.system ?? undefined, user: val.user ?? undefined });
    }
  }
}

/** 获取当前用户自定义模板（用于持久化） */
export function getUserOverrides() {
  const obj = {};
  for (const [id, val] of userOverrides.entries()) {
    obj[id] = val;
  }
  return obj;
}

/** 设置单个任务的自定义模板 */
export function setUserOverride(taskId, override) {
  userOverrides.set(taskId, { system: override?.system ?? undefined, user: override?.user ?? undefined });
}

/** 判断指定任务是否存在用户自定义模板 */
export function hasUserOverride(taskId) {
  return userOverrides.has(taskId);
}

/** 重置单个任务模板（恢复内置） */
export function resetUserOverride(taskId) {
  userOverrides.delete(taskId);
}

/** 重置全部自定义模板 */
export function resetAllOverrides() {
  userOverrides.clear();
}

// ============================================================
// 任务禁用管理
// ============================================================

/** 设置被禁用的任务集合（整体替换） */
export function setDisabledTasks(ids) {
  disabledTasks.clear();
  if (!Array.isArray(ids)) return;
  for (const id of ids) disabledTasks.add(id);
}

/** 获取被禁用的任务 id 列表 */
export function getDisabledTaskIds() {
  return Array.from(disabledTasks);
}

/** 判断任务是否被禁用 */
export function isDisabled(taskId) {
  return disabledTasks.has(taskId);
}

// ============================================================
// 模板渲染与解析
// ============================================================

/**
 * 渲染模板：将 {{varName}} 替换为 vars[varName]。
 * 支持 {{varName}} 和 {{ varName }} 两种写法；未找到的变量保持原样。
 *
 * @param {string} template - 含 {{var}} 占位符的模板字符串。
 * @param {Object} [vars={}] - 变量名到值的映射。
 * @returns {string} 渲染后的字符串。
 */
export function renderTemplate(template, vars = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => {
    const val = vars[name];
    if (val === undefined || val === null) return match;
    return String(val);
  });
}

/**
 * 获取任务的有效模板（用户自定义优先，否则内置）
 * @param {string} taskId
 * @returns {{system:string, user:string}}
 */
export function getEffectiveTemplate(taskId) {
  const override = userOverrides.get(taskId);
  if (override) {
    const builtin = getBuiltinTemplate(taskId) || { system: '', user: '' };
    return {
      system: override.system != null ? override.system : builtin.system,
      user: override.user != null ? override.user : builtin.user
    };
  }
  return getBuiltinTemplate(taskId) || { system: '', user: '' };
}

/**
 * 解析提示词：取有效模板（用户自定义或内置），用 vars 渲染占位符
 * @param {string} taskId
 * @param {{vars?:Object}} [opts]
 * @returns {{system:string, user:string}} 渲染后的提示词
 */
export function resolvePrompt(taskId, { vars = {} } = {}) {
  const template = getEffectiveTemplate(taskId);
  return {
    system: renderTemplate(template.system, vars),
    user: renderTemplate(template.user, vars)
  };
}

/**
 * 获取全部内置模板（供 UI 展示，启动时即可返回）
 * @returns {Object<string, {system:string, user:string}>}
 */
export function getDefaultPrompts() {
  const obj = {};
  for (const id of Object.keys(TEMPLATES)) {
    obj[id] = { system: TEMPLATES[id].system || '', user: TEMPLATES[id].user || '' };
  }
  return obj;
}
