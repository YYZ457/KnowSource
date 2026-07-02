/** @module core/graph/full-extract
 * 职责：云端 LLM 全文一次性抽取——标题树 + 实体 + 关系 + 特异性评分
 *
 * 适用场景：云端强模型（deepseek-chat / GPT-4o / Claude 等），上下文窗口 ≥ 32K
 * 优势：一次调用替代 4+ 次分步调用（标题检测→术语抽取→特异性评分→关系推断），
 *       LLM 能看到全文上下文，结果更准确，API 成本更低
 *
 * 注意：本地模型（ollama / huggingface）不启用全文抽取，始终走专门优化的分步管线。
 */
import { runLLMTask } from '../prompts/run-task.js';

// ============================================================
// 响应解析
// ============================================================

/**
 * 从 LLM 响应中提取 JSON。
 *
 * 依次尝试直接解析、markdown 代码块提取、首尾花括号截取三种策略，
 * 以兼容 LLM 返回中包含多余文本或包裹在代码块中的情况。
 *
 * @param {string} response - LLM 原始响应文本。
 * @returns {Object|null} 解析成功的 JSON 对象；全部失败时返回 null。
 */
function extractJSON(response) {
  if (!response || typeof response !== 'string') return null;

  // 尝试直接解析
  try {
    return JSON.parse(response);
  } catch {
    // 继续
  }

  // 尝试从 markdown 代码块中提取
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // 继续
    }
  }

  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = response.indexOf('{');
  const lastBrace = response.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonStr = response.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonStr);
    } catch {
      // 继续
    }
  }

  return null;
}

/**
 * 验证并规范化抽取结果。
 *
 * 对 LLM 返回的原始 JSON 做字段校验、去重、数量裁剪，
 * 并为标题/实体补全位置偏移等元信息。
 *
 * @param {Object} raw - LLM 返回的原始 JSON 对象。
 * @param {string} text - 原始文档文本（用于位置定位）。
 * @param {Object} [opts={}] - 规范化选项。
 * @param {number} [opts.maxTerms=40] - 保留的最大实体术语数。
 * @param {number} [opts.maxHeadings=30] - 保留的最大标题数。
 * @param {number} [opts.specificityThreshold] - 特异性阈值，低于此值的术语会被过滤。
 * @returns {{headings: Array, entities: Array, relationships: Array}}
 *   规范化后的 { headings, entities, relationships } 结构。
 */
function normalizeResult(raw, text, opts = {}) {
  const maxTerms = opts.maxTerms ?? 40;
  const maxHeadings = opts.maxHeadings ?? 30;
  const threshold = opts.specificityThreshold ?? 4;

  const headings = [];
  const entities = [];
  const relationships = [];

  // 规范化标题
  if (Array.isArray(raw.headings)) {
    for (const h of raw.headings) {
      if (!h || typeof h !== 'object') continue;
      const title = String(h.title || '').trim();
      if (!title || title.length > 100) continue;
      const level = Math.max(1, Math.min(6, parseInt(h.level) || 1));
      // LLM 返回的 start 经常不准确（默认返回 0），用 indexOf 校正
      let start = parseInt(h.start);
      if (!Number.isFinite(start) || start < 0) start = -1;
      // 验证 start 位置是否确实包含标题文本
      if (start >= 0 && text.slice(start, start + title.length).indexOf(title) < 0) {
        start = -1; // 位置不匹配，重新查找
      }
      if (start < 0) start = text.indexOf(title);
      if (start < 0) start = 0;
      headings.push({ title, level, start });
      if (headings.length >= maxHeadings) break;
    }
  }

  // 规范化实体
  if (Array.isArray(raw.entities)) {
    for (const e of raw.entities) {
      if (!e || typeof e !== 'object') continue;
      const term = String(e.term || '').trim();
      if (!term || term.length > 50) continue;
      const specificity = Math.max(1, Math.min(10, parseInt(e.specificity) || 5));
      const isGeneric = e.isGeneric !== undefined ? Boolean(e.isGeneric) : specificity <= threshold;
      // LLM 返回的 start 经常不准确（默认返回 0），用 indexOf 校正
      let start = parseInt(e.start);
      if (!Number.isFinite(start) || start < 0) start = -1;
      // 验证 start 位置是否确实包含实体文本
      if (start >= 0 && text.slice(start, start + term.length).indexOf(term) < 0) {
        start = -1; // 位置不匹配，重新查找
      }
      if (start < 0) start = text.indexOf(term);
      if (start < 0) start = 0;
      const heading = String(e.heading || '').trim();
      const type = String(e.type || 'concept').trim();
      entities.push({ term, specificity, isGeneric, start, heading, type });
      if (entities.length >= maxTerms) break;
    }
  }

  // 规范化关系：所有关系统一为 related，保持简洁
  if (Array.isArray(raw.relationships)) {
    for (const r of raw.relationships) {
      if (!r || typeof r !== 'object') continue;
      const from = String(r.from || '').trim();
      const to = String(r.to || '').trim();
      if (!from || !to) continue;
      const type = 'related';
      const weight = Math.max(0, Math.min(1, parseFloat(r.weight) || 0.5));
      relationships.push({ from, to, type, weight });
    }
  }

  return { headings, entities, relationships };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 使用云端 LLM 全文一次性抽取标题树+实体+关系+特异性
 *
 * @param {string} text - 完整文档文本
 * @param {object} provider - LLM provider（需支持 complete + capabilities）
 * @param {object} options - 配置选项
 * @param {number} options.maxTerms - 最大实体数（默认 40）
 * @param {number} options.maxHeadings - 最大标题数（默认 30）
 * @param {number} options.specificityThreshold - 泛化词阈值（默认 4）
 * @param {number} options.timeoutMs - 超时（默认 180000 = 3分钟）
 * @param {number} options.maxContextChars - 最大上下文字符数（默认 60000）
 * @returns {Promise<{headings:Array, entities:Array, relationships:Array}>}
 */
export async function extractFullGraphFromDocument(text, provider, options = {}) {
  // 默认上下文：200k 字符。当前主流云端模型（GPT-4o 128k/200k，Claude 3.5 200k，
  // DeepSeek-V3/R1 128k/200k，Gemini 1M 等）均能容纳，留有安全余量。
  const maxContextChars = options.maxContextChars ?? 200000;
  const timeoutMs = options.timeoutMs ?? 300000;
  const maxTerms = options.maxTerms ?? 40;
  const maxHeadings = options.maxHeadings ?? 30;
  const threshold = options.specificityThreshold ?? 4;

  // 检查文本是否适合全文抽取
  if (text.length > maxContextChars) {
    throw new Error(`文本过长（${text.length} > ${maxContextChars}），请使用分步管线`);
  }

  // 在文本中每 1000 字符插入 [offset:N] 偏移标记，帮助 LLM 定位实体位置
  const markedChunks = [];
  const chunkSize = 1000;
  for (let i = 0; i < text.length; i += chunkSize) {
    markedChunks.push(`[offset:${i}]${text.slice(i, i + chunkSize)}`);
  }
  const markedText = markedChunks.join('');

  const response = await runLLMTask(provider, 'full-graph-extract', {
    temperature: 0.1,
    maxTokens: 8192,
    timeoutMs,
    responseFormat: 'json',
    _vars: { maxTerms, maxHeadings, threshold, textLength: text.length, markedText }
  });

  const raw = extractJSON(response);
  if (!raw) {
    throw new Error('LLM 返回内容无法解析为 JSON');
  }

  const result = normalizeResult(raw, text, { maxTerms, maxHeadings, specificityThreshold: threshold });

  // 第二轮 LLM 调用：专门推断实体间关系（补充第一轮未覆盖的关系）
  try {
    const round2Relations = await inferRelationshipsRound2(result.entities, text, provider, {
      timeoutMs: options.timeoutMs ?? 120000,
      existingRelationships: result.relationships
    });
    if (round2Relations.length > 0) {
      const existingKeys = new Set(result.relationships.map(r => `${r.from}|||${r.to}|||${r.type}`));
      let added = 0;
      for (const r of round2Relations) {
        const key = `${r.from}|||${r.to}|||${r.type}`;
        if (!existingKeys.has(key)) {
          result.relationships.push(r);
          existingKeys.add(key);
          added++;
        }
      }
    }
  } catch (e) {
    if (e.code === 'TASK_DISABLED') {
      console.warn('[full-extract] 第二轮关系推断任务已被禁用:', e.message);
    } else {
      console.warn(`[full-extract] 第二轮关系推断失败:`, e.message);
    }
  }

  return result;
}

/**
 * 第二轮 LLM 调用：专门推断实体间关系。
 *
 * 将实体列表 + 原文片段交给 LLM，让它补充第一轮未覆盖的关系，
 * 并自动去重（排除已存在的关系）。
 *
 * @param {Array<Object>} entities - 第一轮抽取到的实体数组。
 * @param {string} text - 原始文档文本。
 * @param {Object} provider - LLM 服务提供者实例。
 * @param {Object} [options={}] - 推断选项。
 * @param {number} [options.timeoutMs=120000] - 请求超时毫秒数。
 * @param {Array<Object>} [options.existingRelationships] - 已有关系列表，用于去重。
 * @returns {Promise<Array<Object>>} 新增的关系数组（已去重）。
 */
async function inferRelationshipsRound2(entities, text, provider, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const existingRelationships = options.existingRelationships || [];

  // 只对非泛化实体做关系推断
  const specificEntities = entities.filter(e => !e.isGeneric);
  if (specificEntities.length < 2) return [];

  const entityList = specificEntities.map((e, i) =>
    `${i + 1}. ${e.term} (类型: ${e.type}, 所属: ${e.heading || '无'})`
  ).join('\n');

  const existingRelStr = existingRelationships.length > 0
    ? `\n已有关系（不要重复）：\n${existingRelationships.map(r => `${r.from} → ${r.to} (${r.type})`).join('\n')}`
    : '';

  const textExcerpt = text.slice(0, 8000);

  const response = await runLLMTask(provider, 'relation-infer-r2', {
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs,
    responseFormat: 'json',
    _vars: { entityCount: specificEntities.length, entityList, existingRelStr, textExcerpt }
  });

  const raw = extractJSON(response);
  if (!raw || !Array.isArray(raw.relationships)) return [];

  const validEntityNames = new Set(specificEntities.map(e => e.term));
  const relationships = [];
  for (const r of raw.relationships) {
    if (!r || typeof r !== 'object') continue;
    const from = String(r.from || '').trim();
    const to = String(r.to || '').trim();
    if (!from || !to || !validEntityNames.has(from) || !validEntityNames.has(to)) continue;
    if (from === to) continue;
    const type = 'related';
    const weight = Math.max(0, Math.min(1, parseFloat(r.weight) || 0.5));
    relationships.push({ from, to, type, weight });
  }

  return relationships;
}

/**
 * 判断 provider 是否支持全文抽取
 *
 * 规则：
 * - stub / ollama / huggingface 等本地模型不支持全文抽取，始终走分步管线
 * - 仅云端强模型（openai-compatible 等）在文本不太长时启用全文抽取
 */
export function canUseFullExtract(provider, textLength, options = {}) {
  if (!provider || provider.name === 'stub') return false;
  // 本地模型（ollama / huggingface）统一走专门优化的分步管线，不启用全文抽取
  if (provider.name === 'ollama' || provider.name === 'huggingface') return false;
  const maxContextChars = options.maxContextChars ?? 60000;
  // 云端强模型 + 文本不太长
  if (provider.capabilities?.qualityLevel === 'strong' && textLength <= maxContextChars) {
    return true;
  }
  // 中等质量云端模型也可以尝试，但上下文要更小（默认 32k）
  if (provider.capabilities?.qualityLevel === 'medium' && textLength <= Math.min(maxContextChars, 32000)) {
    return true;
  }
  return false;
}

/**
 * 将全文抽取结果转换为图谱节点和边
 * @param {object} extracted - extractFullGraphFromDocument 的返回
 * @param {string} docId - 文档 ID
 * @param {string} docName - 文档名称
 * @returns {{nodes:Array, edges:Array}}
 */
export function convertToGraph(extracted, docId, docName) {
  const { headings, entities, relationships } = extracted;
  const nodes = [];
  const edges = [];

  // 文档节点
  const docNodeId = `doc-${docId}`;
  nodes.push({
    id: docNodeId,
    type: 'document',
    label: docName,
    content: docName,
    weight: 1,
    source: { docId, page: 0 },
    meta: { docId, level: 0 }
  });

  // 标题节点 + 层级边
  // 用 title + start 组合作为key，保留所有同名标题映射，避免重名标题覆盖导致实体归属错误
  const headingIdMap = new Map(); // title -> [{ nodeId, start }]
  const headingNodes = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nodeId = `h_${docId}_${i}`;
    // 保留所有同名标题映射，按 start 区分
    if (!headingIdMap.has(h.title)) {
      headingIdMap.set(h.title, []);
    }
    headingIdMap.get(h.title).push({ nodeId, start: h.start });
    headingNodes.push({
      id: nodeId,
      type: 'heading',
      label: h.title,
      content: h.title,
      weight: 1,
      source: { docId, page: 1, start: h.start },
      meta: { level: h.level, start: h.start, page: 1 }
    });
    nodes.push(headingNodes[headingNodes.length - 1]);
  }

  // 标题层级关系：按 level 构建父子关系
  const headingStack = [];
  for (const hn of headingNodes) {
    const level = hn.meta.level;
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].meta.level >= level) {
      headingStack.pop();
    }
    if (headingStack.length > 0) {
      const parent = headingStack[headingStack.length - 1];
      edges.push({
        from: parent.id,
        to: hn.id,
        type: 'contains',
        weight: 1,
        source: 'full-extract',
        evidence: 'heading-hierarchy'
      });
    } else {
      // 顶层标题挂到 document 节点
      edges.push({
        from: docNodeId,
        to: hn.id,
        type: 'contains',
        weight: 1,
        source: 'full-extract',
        evidence: 'document-heading'
      });
    }
    headingStack.push(hn);
  }

  // 实体节点
  // 用实体索引i作为key的一部分，避免同名实体nodeId映射被覆盖
  const entityIdMap = new Map(); // term -> [nodeId, ...]
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const nodeId = `e_${docId}_${i}`;
    if (!entityIdMap.has(e.term)) {
      entityIdMap.set(e.term, []);
    }
    entityIdMap.get(e.term).push(nodeId);

    // 找到所属标题节点（从所有同名标题中找最近的）
    let parentHeadingId = null;
    if (e.heading && headingIdMap.has(e.heading)) {
      const candidates = headingIdMap.get(e.heading);
      let bestCandidate = candidates[0];
      let bestDist = Infinity;
      for (const c of candidates) {
        const dist = Math.abs(c.start - e.start);
        if (dist < bestDist) {
          bestDist = dist;
          bestCandidate = c;
        }
      }
      parentHeadingId = bestCandidate.nodeId;
    }

    nodes.push({
      id: nodeId,
      type: e.type || 'entity',
      label: e.term,
      content: e.term,
      keyword: e.term,
      weight: e.specificity,
      source: { docId, page: 1, start: e.start },
      meta: {
        keyword: e.term,
        specificity: e.specificity,
        isGeneric: e.isGeneric,
        type: e.type,
        start: e.start,
        page: 1,
        heading: e.heading || ''
      }
    });

    // 实体 → 所属标题（contains 边）
    if (parentHeadingId) {
      edges.push({
        from: parentHeadingId,
        to: nodeId,
        type: 'contains',
        weight: 1,
        source: 'full-extract',
        evidence: 'heading-entity'
      });
    } else {
      // 无标题归属的实体直接挂到 document
      edges.push({
        from: docNodeId,
        to: nodeId,
        type: 'contains',
        weight: 0.5,
        source: 'full-extract',
        evidence: 'document-entity'
      });
    }
  }

  // 实体间关系
  for (const r of relationships) {
    const fromIds = entityIdMap.get(r.from);
    const toIds = entityIdMap.get(r.to);
    if (!fromIds || !toIds || fromIds.length === 0 || toIds.length === 0) continue;
    const fromId = fromIds[0]; // 使用第一个匹配的实体节点
    const toId = toIds[0];
    if (fromId === toId) continue;
    // 所有关系统一为 related，保持简洁
    edges.push({
      from: fromId,
      to: toId,
      type: 'related',
      weight: r.weight,
      source: 'full-extract',
      evidence: 'llm-relationship'
    });
  }

  return { nodes, edges };
}
