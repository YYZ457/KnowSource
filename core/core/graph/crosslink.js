/** @module core/graph/crosslink
 *  职责：跨文档连接（为不同文档的标题树/概念创建 cross-link 边）
 *  架构边界：core 层模块，provider 通过参数注入，不 import services 层
 */
import { textSimilarity } from '../matcher/index.js';
import { runLLMTask } from '../prompts/run-task.js';

/**
 * 归一化文本：去空格、转小写、移除常见序号前缀
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\s\-_\.，,、]/g, '')
    .replace(/^(第[一二三四五六七八九十0-9]+章|第\d+章|chapter\s*\d+|\d+\.?)/i, '');
}

/**
 * 提取关键词集合（按字符二元组 + 整词）
 */
function extractKeywords(text) {
  const normalized = normalizeText(text);
  const set = new Set();
  // 整词
  for (const word of normalized.split(/[^\u4e00-\u9fa5a-z0-9]+/)) {
    if (word.length >= 2) set.add(word);
  }
  // 中文字符二元组
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.slice(i, i + 2);
    if (/[\u4e00-\u9fa5]{2}/.test(bigram)) set.add(bigram);
  }
  return set;
}

/**
 * 计算两个集合的 Jaccard 相似度
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * 按 docId 收集文档中的 heading/entity 节点
 */
function collectDocNodes(graph, nodeTypes = ['heading', 'entity']) {
  const byDoc = new Map();
  for (const node of graph.nodes.values()) {
    if (!nodeTypes.includes(node.type)) continue;
    const docId = node.source?.docId;
    if (!docId) continue;
    if (!byDoc.has(docId)) byDoc.set(docId, []);
    byDoc.get(docId).push(node);
  }
  return byDoc;
}

/**
 * 构建文档节点索引：docId -> 文档节点，一次 O(V) 遍历，
 * 供 computeDocRelevance 复用，避免对每个文档对都做 [...graph.nodes.values()].find(...)。
 */
function buildDocNodeMap(graph) {
  const map = new Map();
  for (const n of graph.nodes.values()) {
    if (n.type === 'document' && n.source?.docId) {
      map.set(n.source.docId, n);
    }
  }
  return map;
}

/**
 * 计算文档级相关性（0-1）
 * 综合：文档名相似度、heading/entity 关键词 Jaccard、共有核心词比例
 */
function computeDocRelevance(graph, docIdA, docIdB, byDoc, docNodeMap) {
  const nodesA = byDoc.get(docIdA) || [];
  const nodesB = byDoc.get(docIdB) || [];

  // 文档名相似度：从预构建的 docNodeMap 中 O(1) 查找文档节点，
  // 避免每次都对全量节点做 [...graph.nodes.values()].find(...)（O(V)）。
  const docNodeA = docNodeMap.get(docIdA);
  const docNodeB = docNodeMap.get(docIdB);
  const nameSim = textSimilarity(docNodeA?.content || '', docNodeB?.content || '');

  // heading/entity 关键词 Jaccard
  const keywordsA = new Set();
  const keywordsB = new Set();
  for (const n of nodesA) extractKeywords(n.content).forEach(k => keywordsA.add(k));
  for (const n of nodesB) extractKeywords(n.content).forEach(k => keywordsB.add(k));
  const jaccard = jaccardSimilarity(keywordsA, keywordsB);

  // 如果文档名高度相似（如"医学微生物学..."），直接给高相关性
  if (nameSim >= 0.6) return Math.max(0.8, nameSim);

  // 综合分数：Jaccard 占主要，文档名相似度作为 boost
  return Math.min(1, jaccard * 0.9 + nameSim * 0.3);
}

/**
 * 计算两个节点的综合相似度。
 * 在传统 textSimilarity 基础上，额外强化“共享核心子串”和“互相包含”的情况，
 * 对中文短文本/破碎实体更友好。
 */
function computePairSimilarity(a, b) {
  if (a.id === b.id) return 0;
  const ca = normalizeText(a.content);
  const cb = normalizeText(b.content);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1.0;

  // 1. 完全包含
  if (ca.length >= 2 && cb.length >= 2 && (ca.includes(cb) || cb.includes(ca))) {
    const shorter = Math.min(ca.length, cb.length);
    const longer = Math.max(ca.length, cb.length);
    return 0.55 + 0.45 * (shorter / longer);
  }

  // 2. 共享最长公共子串（长度 >= 2 的中文）
  let maxCommon = 0;
  for (let i = 0; i < ca.length; i++) {
    for (let j = 0; j < cb.length; j++) {
      let k = 0;
      while (i + k < ca.length && j + k < cb.length && ca[i + k] === cb[j + k]) k++;
      if (k > maxCommon) maxCommon = k;
    }
  }
  let substringScore = 0;
  if (maxCommon >= 3) {
    substringScore = 0.5 + 0.3 * (maxCommon / Math.max(ca.length, cb.length));
  } else if (maxCommon === 2) {
    substringScore = 0.25 + 0.15 * (2 / Math.max(ca.length, cb.length));
  }

  // 3. textSimilarity（Jaccard / Dice / 字符重叠）
  const ts = textSimilarity(ca, cb);

  return Math.min(1.0, Math.max(ts, substringScore));
}

/**
 * 生成跨文档候选对，按文档相关性分配候选名额
 */
function generateCrossDocPairs(graph, options = {}) {
  const nodeTypes = options.nodeTypes || ['heading', 'entity'];
  const maxPairs = options.maxPairs || 600;
  const threshold = options.threshold ?? 0.15;
  const sourceDocIds = options.sourceDocIds;
  const targetDocIds = options.targetDocIds;

  const byDoc = collectDocNodes(graph, nodeTypes);
  // 预构建文档节点索引，供 computeDocRelevance 在 O(N²) 文档对循环中 O(1) 查找文档节点
  const docNodeMap = buildDocNodeMap(graph);
  let docIds = Array.from(byDoc.keys());

  // 如果指定了 source/target，只保留相关文档
  if (sourceDocIds?.length) {
    docIds = docIds.filter(id => sourceDocIds.includes(id));
  }
  if (targetDocIds?.length) {
    docIds = docIds.filter(id => targetDocIds.includes(id));
  }

  if (docIds.length < 2) return { pairs: [], docPairs: [] };

  // 判断 source 和 target 是否是同一集合（多选重建时常见）
  const sameSet = sourceDocIds?.length && targetDocIds?.length &&
    sourceDocIds.length === targetDocIds.length &&
    sourceDocIds.every(id => targetDocIds.includes(id));

  // 计算所有文档对的相关性并排序
  const docPairs = [];
  for (let i = 0; i < docIds.length; i++) {
    for (let j = i + 1; j < docIds.length; j++) {
      const docA = docIds[i];
      const docB = docIds[j];
      // source/target 模式下：如果同时指定了 source 和 target，要求一对分别来自两边
      // 但如果 source === target（多选重建），则允许同一集合内的所有文档对
      if (sourceDocIds?.length && targetDocIds?.length && !sameSet) {
        const aInSource = sourceDocIds.includes(docA);
        const bInSource = sourceDocIds.includes(docB);
        if (aInSource === bInSource) continue; // 必须一边一个
      }
      const relevance = computeDocRelevance(graph, docA, docB, byDoc, docNodeMap);
      docPairs.push({ docA, docB, relevance });
    }
  }
  docPairs.sort((a, b) => b.relevance - a.relevance);

  // 为每对文档分配候选名额：相关性越高，名额越多
  const allPairs = [];
  let remainingPairs = maxPairs;
  for (const dp of docPairs) {
    if (remainingPairs <= 0) break;
    const nodesA = byDoc.get(dp.docA) || [];
    const nodesB = byDoc.get(dp.docB) || [];
    if (nodesA.length === 0 || nodesB.length === 0) continue;

    // 该文档对最多候选数：至少 20 对，最多 120 对，按相关性分配
    const quota = Math.max(20, Math.min(120, Math.floor(dp.relevance * 150)));
    const pairsForDoc = [];
    for (const a of nodesA) {
      for (const b of nodesB) {
        if (a.id === b.id) continue;
        const sim = computePairSimilarity(a, b);
        if (sim < threshold) continue;
        pairsForDoc.push({ a, b, sim, docRelevance: dp.relevance });
      }
    }
    pairsForDoc.sort((x, y) => y.sim - x.sim);
    const selected = pairsForDoc.slice(0, Math.min(quota, remainingPairs));
    allPairs.push(...selected);
    remainingPairs -= selected.length;
  }

  return { pairs: allPairs, docPairs };
}

/**
 * 基于 L1 标题子树推断跨文档连接
 * 规则：两个 L1 标题文本相似，或它们子树中的节点有共享/有边相连，则在 L1 之间建立 cross-link
 */
function inferL1LinksBySubtree(graph, options = {}) {
  const threshold = options.threshold ?? 0.25;
  const simFn = options.similarityFn || ((a, b) => computePairSimilarity({ content: a }, { content: b }));
  const result = { linkCount: 0, links: [] };

  const l1Nodes = [];
  for (const node of graph.nodes.values()) {
    if (node.type === 'heading' && node.meta?.level === 1 && node.source?.docId) {
      l1Nodes.push(node);
    }
  }
  if (l1Nodes.length < 2) return result;

  const childrenMap = new Map();
  for (const edge of graph.edges.values()) {
    if (edge.type === 'hierarchy' || edge.type === 'contains') {
      const fromNode = graph.nodes.get(edge.from);
      if (fromNode && fromNode.type === 'document') continue;
      if (!childrenMap.has(edge.from)) childrenMap.set(edge.from, new Set());
      childrenMap.get(edge.from).add(edge.to);
    }
  }

  const l1Set = new Set(l1Nodes.map(n => n.id));

  function collectSubtree(rootId) {
    const visited = new Set();
    function dfs(nodeId) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const children = childrenMap.get(nodeId);
      if (children) {
        for (const child of children) dfs(child);
      }
    }
    dfs(rootId);
    return visited;
  }

  const subtreeMap = new Map();
  for (const l1 of l1Set) {
    subtreeMap.set(l1, collectSubtree(l1));
  }

  const l1ByDoc = new Map();
  for (const node of l1Nodes) {
    const docId = node.source.docId;
    if (!l1ByDoc.has(docId)) l1ByDoc.set(docId, []);
    l1ByDoc.get(docId).push(node);
  }
  const docIds = Array.from(l1ByDoc.keys());

  const existingKeys = new Set();
  for (const edge of graph.edges.values()) {
    if (edge.type === 'cross-link') {
      existingKeys.add([edge.from, edge.to].sort().join('|||'));
    }
  }

  // 预构建"非 hierarchy / 非 cross-link"边的邻接索引：nodeId -> [edge]
  // 原实现在每个 L1 对的内层循环中遍历全量边（O(E)），导致 O(D²·L²·E) 的最坏复杂度。
  // 改为只遍历 subtreeA 节点关联的边，将内层降为 O(Σ subtreeA 节点度数)。
  const nodeToEdges = new Map();
  for (const edge of graph.edges.values()) {
    if (edge.type === 'cross-link' || edge.type === 'hierarchy') continue;
    for (const ep of [edge.from, edge.to]) {
      if (!nodeToEdges.has(ep)) nodeToEdges.set(ep, []);
      nodeToEdges.get(ep).push(edge);
    }
  }

  for (let i = 0; i < docIds.length; i++) {
    for (let j = i + 1; j < docIds.length; j++) {
      for (const a of l1ByDoc.get(docIds[i])) {
        for (const b of l1ByDoc.get(docIds[j])) {
          if (a.id === b.id || a.content === b.content) continue;
          const key = [a.id, b.id].sort().join('|||');
          if (existingKeys.has(key)) continue;

          let shouldLink = false;
          let weight = 0;
          let method = '';

          const sim = simFn(a.content, b.content);
          if (sim >= threshold) {
            shouldLink = true;
            weight = sim;
            method = 'textSimilarity';
          }

          if (!shouldLink) {
            const shared = [...subtreeMap.get(a.id)].filter(x => subtreeMap.get(b.id).has(x));
            if (shared.length > 0) {
              shouldLink = true;
              weight = Math.max(sim, 0.45 + Math.min(shared.length * 0.05, 0.3));
              method = 'sharedDescendants';
            }
          }

          if (!shouldLink) {
            let crossEdgeCount = 0;
            const subtreeA = subtreeMap.get(a.id);
            const subtreeB = subtreeMap.get(b.id);
            const counted = new Set();
            for (const nodeId of subtreeA) {
              const edges = nodeToEdges.get(nodeId);
              if (!edges) continue;
              for (const edge of edges) {
                if (counted.has(edge)) continue;
                if ((subtreeA.has(edge.from) && subtreeB.has(edge.to)) ||
                    (subtreeA.has(edge.to) && subtreeB.has(edge.from))) {
                  counted.add(edge);
                  crossEdgeCount++;
                }
              }
            }
            if (crossEdgeCount > 0) {
              shouldLink = true;
              weight = Math.max(sim, 0.35 + Math.min(crossEdgeCount * 0.05, 0.3));
              method = 'subtreeEdges';
            }
          }

          if (shouldLink) {
            graph.addEdge({
              from: a.id,
              to: b.id,
              type: 'cross-link',
              weight: Math.min(weight, 1),
              evidence: { score: weight, method }
            });
            result.linkCount++;
            result.links.push({ from: a.id, to: b.id, weight: Math.min(weight, 1) });
            existingKeys.add(key);
          }
        }
      }
    }
  }

  return result;
}

/**
 * 为跨文档节点构建 cross-link 边（规则相似度版）
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {{threshold?:number, similarityFn?:function, nodeTypes?:string[], sourceDocIds?:string[], targetDocIds?:string[], maxPairs?:number, maxLinksPerDocPair?:number}} options
 * @returns {{linkCount:number, links:{from:string,to:string,weight:number}[]}}
 */
export function buildCrossLinks(graph, options = {}) {
  const threshold = options.threshold ?? 0.18;
  const result = { linkCount: 0, links: [] };
  const { pairs } = generateCrossDocPairs(graph, { ...options, maxPairs: options.maxPairs || 600 });

  const existingKeys = new Set();
  for (const edge of graph.edges.values()) {
    if (edge.type === 'cross-link') {
      existingKeys.add([edge.from, edge.to].sort().join('|||'));
    }
  }

  for (const { a, b, sim } of pairs) {
    if (sim < threshold) continue;
    const key = [a.id, b.id].sort().join('|||');
    if (existingKeys.has(key)) continue;

    const method = a.content === b.content ? 'exact-match' : 'textSimilarity';
    graph.addEdge({
      from: a.id,
      to: b.id,
      type: 'cross-link',
      weight: sim,
      evidence: { score: sim, method }
    });
    result.linkCount++;
    result.links.push({ from: a.id, to: b.id, weight: sim });
    existingKeys.add(key);
  }

  // 基于 L1 标题子树推断跨文档连接
  const subtreeResult = inferL1LinksBySubtree(graph, options);
  result.linkCount += subtreeResult.linkCount;
  result.links.push(...subtreeResult.links);

  return result;
}

/**
 * LLM 语义跨文档连线
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {{provider?:object, threshold?:number, maxPairs?:number, nodeTypes?:string[], sourceDocIds?:string[], targetDocIds?:string[]}} options
 * @returns {Promise<{linkCount:number, links:{from:string,to:string,weight:number}[], method:string}>}
 */
export async function buildCrossLinksLLM(graph, options = {}) {
  const provider = options.provider;
  if (!provider || provider.name === 'stub') {
    const r = buildCrossLinks(graph, options);
    return { ...r, method: 'rule' };
  }

  const threshold = options.threshold ?? 0.18;
  const result = { linkCount: 0, links: [], method: 'llm' };

  const { pairs, docPairs } = generateCrossDocPairs(graph, {
    ...options,
    nodeTypes: options.nodeTypes || ['heading', 'entity'],
    maxPairs: options.maxPairs || 400
  });

  if (pairs.length === 0) return result;

  // 预筛：按节点相似度 + 文档相关性综合排序，取 top-N
  pairs.sort((x, y) => {
    const scoreX = x.sim * 0.7 + x.docRelevance * 0.3;
    const scoreY = y.sim * 0.7 + y.docRelevance * 0.3;
    return scoreY - scoreX;
  });
  const candidates = pairs.slice(0, options.maxPairs || 400);

  const docInfo = docPairs.length > 0
    ? docPairs.slice(0, 10).map((d, i) =>
        `${i + 1}. ${d.docA} <--> ${d.docB}（文档相关性: ${(d.relevance * 100).toFixed(0)}%）`
      ).join('\n')
    : '（无）';

  const lines = candidates.map((c, i) =>
    `${i + 1}. [${c.a.source?.docId || '?'}] ${c.a.type}: ${c.a.content}  <-->  [${c.b.source?.docId || '?'}] ${c.b.type}: ${c.b.content}`
  ).join('\n');

  let llmResult;
  try {
    const raw = await runLLMTask(provider, 'crosslink-llm', {
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 90000,
      _vars: { docInfo, lines }
    });
    llmResult = parseCrossLinkResponse(raw, candidates.length);
  } catch (e) {
    // 区分 TASK_DISABLED（用户主动禁用）和真正的 LLM 调用失败
    if (e.code === 'TASK_DISABLED') {
      console.warn('[crosslink] LLM 跨文档连线任务已被禁用，使用规则相似度:', e.message);
    } else {
      console.warn('[crosslink] LLM 语义判断失败，回退规则:', e.message);
    }
    const r = buildCrossLinks(graph, options);
    return { ...r, method: 'rule-fallback' };
  }

  const existingKeys = new Set();
  for (const edge of graph.edges.values()) {
    if (edge.type === 'cross-link') {
      existingKeys.add([edge.from, edge.to].sort().join('|||'));
    }
  }

  for (const item of llmResult) {
    if (!item.related) continue;
    const pair = candidates[item.index];
    if (!pair) continue;
    const key = [pair.a.id, pair.b.id].sort().join('|||');
    if (existingKeys.has(key)) continue;

    graph.addEdge({
      from: pair.a.id,
      to: pair.b.id,
      type: 'cross-link',
      weight: Math.max(item.score || pair.sim, threshold),
      evidence: { score: item.score || pair.sim, method: 'llm', reason: item.reason || '' }
    });
    result.linkCount++;
    result.links.push({ from: pair.a.id, to: pair.b.id, weight: item.score || pair.sim });
    existingKeys.add(key);
  }

  // 基于 L1 标题子树推断跨文档连接
  const subtreeResult = inferL1LinksBySubtree(graph, options);
  result.linkCount += subtreeResult.linkCount;
  result.links.push(...subtreeResult.links);

  return result;
}

/**
 * 解析 LLM 跨文档连线响应
 */
function parseCrossLinkResponse(raw, count) {
  if (!raw) return [];
  let text = raw.trim();
  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) text = codeMatch[1].trim();
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return [];
  try {
    const arr = JSON.parse(arrMatch[0]);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, count).map((item, i) => ({
      index: typeof item.index === 'number' ? item.index : i,
      related: !!item.related,
      score: typeof item.score === 'number' ? item.score : 0.5,
      reason: typeof item.reason === 'string' ? item.reason : ''
    }));
  } catch (e) {
    console.warn('[crosslink] LLM 响应解析失败:', e.message);
    return [];
  }
}
