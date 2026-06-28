/** @module services/api/handlers/idea
 *  职责：Idea 增删改查 + 推荐 + 图谱联动
 *  重构：支持父子树形嵌套、Idea 树整体入图、自动关联已有节点
 */
import { storage, isProjectSwitching } from '../../storage.js';
import { recommendNodes } from '../../../core/idea/recommend.js';
import { textSimilarity } from '../../../core/matcher/index.js';
import { tokenize } from '../../../core/extractor/index.js';
import { embed } from '../../embedding-provider.js';
import { randomUUID } from 'node:crypto';

export function listIdeas() {
  return Array.from(storage.ideas.values());
}

export function createIdea({ title, content, relatedNodeIds = [], folder = '', includeInGraph = true, color = '', parentId = null } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  const id = 'idea-' + randomUUID().slice(0, 8);
  const idea = {
    id,
    title: title || '未命名 Idea',
    content: content || '',
    relatedNodeIds: relatedNodeIds || [],
    references: [],
    relations: [],
    folder: folder || '',
    parentId: parentId || null,
    includeInGraph: includeInGraph !== false,
    color: color || '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  storage.ideas.set(id, idea);
  syncIdeaToGraph(idea);
  // 如果有父节点，同步父节点以建立父子边
  if (parentId && storage.ideas.has(parentId)) {
    syncIdeaToGraph(storage.ideas.get(parentId));
  }
  return { success: true, data: idea };
}

export function updateIdea({ id, ...patch } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!id || !storage.ideas.has(id)) {
    return { success: false, error: 'Idea 不存在' };
  }
  const idea = storage.ideas.get(id);
  const oldParentId = idea.parentId;
  // 白名单过滤：只允许更新指定字段，防止覆盖 id、createdAt 等受保护字段
  const ALLOWED_FIELDS = ['title', 'content', 'relatedNodeIds', 'folder', 'parentId', 'includeInGraph', 'color'];
  const safePatch = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in patch) {
      safePatch[key] = patch[key];
    }
  }
  Object.assign(idea, safePatch, { updatedAt: Date.now() });
  storage.ideas.set(id, idea);
  syncIdeaToGraph(idea);
  // 如果父节点变了，同步新旧父节点
  if (oldParentId !== idea.parentId) {
    if (oldParentId && storage.ideas.has(oldParentId)) {
      syncIdeaToGraph(storage.ideas.get(oldParentId));
    }
    if (idea.parentId && storage.ideas.has(idea.parentId)) {
      syncIdeaToGraph(storage.ideas.get(idea.parentId));
    }
  }
  return { success: true, data: idea };
}

export function deleteIdea({ id } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!id || !storage.ideas.has(id)) {
    return { success: false, error: 'Idea 不存在' };
  }

  // 先构建 parentId -> [childIds] 索引（O(K)），避免 BFS 中对每个节点全量扫描
  const childrenIndex = new Map();
  for (const idea of storage.ideas.values()) {
    if (idea.parentId) {
      if (!childrenIndex.has(idea.parentId)) {
        childrenIndex.set(idea.parentId, []);
      }
      childrenIndex.get(idea.parentId).push(idea.id);
    }
  }

  // 基于索引进行 BFS 收集所有后代 id（O(K)），总复杂度降为 O(K)
  const allIds = new Set();
  const queue = [id];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (allIds.has(currentId)) continue;
    allIds.add(currentId);
    // 通过索引查找直接子节点，无需全量扫描
    const children = childrenIndex.get(currentId);
    if (children) {
      for (const childId of children) {
        if (!allIds.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  // 从图谱中批量移除所有 Idea 节点及关联边
  if (storage.graph && storage.graph.nodes) {
    const newNodes = storage.graph.nodes.filter(n => !allIds.has(n.id));
    const newEdges = storage.graph.edges.filter(e => !allIds.has(e.from) && !allIds.has(e.to));
    // 使用整体替换确保触发 Proxy 的 set 拦截，从而触发持久化
    storage.graph.nodes = newNodes;
    storage.graph.edges = newEdges;
    // stats 是嵌套对象，直接修改其属性不会被外层 Proxy 拦截，
    // 需整体替换 stats 引用以触发 set 拦截
    storage.graph.stats = {
      ...storage.graph.stats,
      nodeCount: newNodes.length,
      edgeCount: newEdges.length
    };
  }

  // 批量删除所有 Idea
  for (const ideaId of allIds) {
    storage.ideas.delete(ideaId);
  }

  return { success: true, id, deletedCount: allIds.size };
}

export async function recommendIdeaNodes({ id, topN = 5 } = {}) {
  if (!id || !storage.ideas.has(id)) {
    return { success: false, error: 'Idea 不存在' };
  }
  const idea = storage.ideas.get(id);
  const documents = Array.from(storage.documents.values()).map(d => ({
    meta: { docId: d.docId, name: d.meta?.name || d.name || '未命名文档' },
    sections: d.sections || [],
    rawText: d.rawText || ''
  }));
  const graph = storage.graph?.nodes?.length
    ? { nodes: Object.fromEntries(storage.graph.nodes.map(n => [n.id, n])), edges: storage.graph.edges }
    : null;
  const recommendations = await recommendNodes(idea, {
    documents,
    graph,
    embedFn: embed,
    topN
  });
  return { success: true, recommendations };
}

export function linkIdeaToNode({ ideaId, nodeId } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!ideaId || !storage.ideas.has(ideaId)) {
    return { success: false, error: 'Idea 不存在' };
  }
  if (!nodeId) {
    return { success: false, error: '缺少节点 ID' };
  }
  const idea = storage.ideas.get(ideaId);
  if (!idea.relatedNodeIds.includes(nodeId)) {
    // 不可变操作：创建新数组而非直接 push，避免原地修改导致并发竞态
    idea.relatedNodeIds = [...idea.relatedNodeIds, nodeId];
    idea.updatedAt = Date.now();
  }
  storage.ideas.set(ideaId, idea);
  syncIdeaToGraph(idea);
  return { success: true, idea };
}

export function unlinkIdeaFromNode({ ideaId, nodeId } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!ideaId || !storage.ideas.has(ideaId)) {
    return { success: false, error: 'Idea 不存在' };
  }
  const idea = storage.ideas.get(ideaId);
  idea.relatedNodeIds = idea.relatedNodeIds.filter(id => id !== nodeId);
  idea.updatedAt = Date.now();
  storage.ideas.set(ideaId, idea);
  syncIdeaToGraph(idea);
  return { success: true, idea };
}

/**
 * 将 Idea 同步到图谱中（直接操作 storage.graph 数组，避免序列化丢失字段）：
 * 1. 作为圆形节点展示
 * 2. 与手动关联的节点建立 belong 边
 * 3. 与父/子 Idea 建立 idea-hierarchy 边
 * 4. 自动检测与已有图谱节点的关联，建立 idea-link 边
 */
function syncIdeaToGraph(idea, keywordIndex = null) {
  if (!storage.graph || !storage.graph.nodes) return;
  let nodes = storage.graph.nodes;
  let edges = storage.graph.edges;

  const idx = nodes.findIndex(n => n.id === idea.id);

  // 如果 Idea 不再加入图谱，移除现有节点
  if (!idea.includeInGraph) {
    if (idx >= 0) {
      storage.graph.nodes = storage.graph.nodes.filter((_, i) => i !== idx);
      // 移除相关边
      storage.graph.edges = storage.graph.edges.filter(e => e.from !== idea.id && e.to !== idea.id);
    }
    return;
  }

  // 确保 Idea 节点存在，渲染为圆形
  const label = idea.title || 'Idea';
  const radius = Math.max(32, Math.min(64, label.length * 8 + 16));
  const ideaNode = {
    id: idea.id,
    label,
    type: 'idea',
    ideaId: idea.id,
    source: { docId: 'idea', sectionId: idea.id },
    content: idea.content || label,
    color: idea.color || '#f59e0b',
    shape: 'circle',
    radius,
    level: 0,
    weight: 1,
    meta: { ideaId: idea.id, parentId: idea.parentId }
  };

  if (idx >= 0) {
    // 更新已有节点，保留位置信息（不可变更新）
    const existing = nodes[idx];
    ideaNode.x = existing.x;
    ideaNode.y = existing.y;
    ideaNode.vx = existing.vx;
    ideaNode.vy = existing.vy;
    nodes = nodes.map((n, i) => (i === idx ? { ...existing, ...ideaNode } : n));
  } else {
    nodes = [...nodes, ideaNode];
  }

  // 清理该 Idea 的旧 belong / idea-hierarchy / idea-link 边（不可变过滤）
  edges = edges.filter(e => !(
    (e.from === idea.id && (e.type === 'belong' || e.type === 'idea-hierarchy' || e.type === 'idea-link')) ||
    (e.to === idea.id && e.type === 'idea-hierarchy')
  ));

  // 收集需要新增的边
  const newEdges = [];

  // 1. 同步手动关联的 belong 边
  for (const nodeId of idea.relatedNodeIds) {
    if (nodes.some(n => n.id === nodeId)) {
      newEdges.push({ from: idea.id, to: nodeId, type: 'belong', weight: 1, evidence: { ideaId: idea.id, method: 'manual' } });
    }
  }

  // 2. 父子 Idea 之间建立 idea-hierarchy 边
  if (idea.parentId && nodes.some(n => n.id === idea.parentId)) {
    newEdges.push({ from: idea.parentId, to: idea.id, type: 'idea-hierarchy', weight: 1, evidence: { method: 'parent-child' } });
  }
  const childIdeas = Array.from(storage.ideas.values()).filter(i => i.parentId === idea.id);
  for (const child of childIdeas) {
    if (nodes.some(n => n.id === child.id)) {
      newEdges.push({ from: idea.id, to: child.id, type: 'idea-hierarchy', weight: 1, evidence: { method: 'parent-child' } });
    }
  }

  // 3. 自动关联：扫描已有图谱节点，找与 Idea 标题/内容相似的，建立 idea-link 边
  const autoEdges = autoAssociateIdeaToGraph(nodes, idea, keywordIndex);
  newEdges.push(...autoEdges);

  // 合并新旧边（不可变拼接）
  edges = [...edges, ...newEdges];

  // 写回 storage（创建新数组引用以触发持久化/响应式）
  storage.graph.nodes = nodes;
  storage.graph.edges = edges;

  // 更新统计
  // 重要：必须整体替换 stats 引用而非直接修改其属性。
  // storage.graph 是 watchObject Proxy 包装的，仅拦截顶层属性的 set/deleteProperty。
  // 直接修改 storage.graph.stats.nodeCount 不会触发 Proxy 的 set 拦截，
  // 导致 graphVersion 不递增、scheduleGraphSave 不触发（虽然 nodes/edges 赋值已触发保存，
  // 但 stats 变更不会被独立检测，属于脆弱写法）。整体替换确保与 deleteIdea 保持一致。
  if (storage.graph.stats) {
    storage.graph.stats = {
      ...storage.graph.stats,
      nodeCount: nodes.length,
      edgeCount: edges.length
    };
  }
}

/**
 * 为非 Idea 节点构建关键词倒排索引，用于加速 autoAssociateIdeaToGraph 的候选过滤。
 * 索引结构：{ index: Map<keyword, Set<nodeId>>, nodeMap: Map<nodeId, node>, nodeTexts: Map<nodeId, string> }
 * 仅索引非 idea 节点（heading/entity/document），因为这些节点在 syncAllIdeasToGraph 期间不变。
 * @param {Array} nodes — 图谱节点数组
 * @returns {{index:Map,nodeMap:Map,nodeTexts:Map}}
 */
function buildNodeKeywordIndex(nodes) {
  const index = new Map();      // keyword -> Set<nodeId>
  const nodeMap = new Map();    // nodeId -> node（用于查 type）
  const nodeTexts = new Map();  // nodeId -> text（用于 textSimilarity）
  for (const node of nodes) {
    if (node.type === 'idea') continue;
    const text = node.content || node.label || '';
    if (!text || text.length < 2) continue;
    nodeMap.set(node.id, node);
    nodeTexts.set(node.id, text);
    // 使用与 textSimilarity 相同的 tokenizer，保证一致性
    const uniqueTokens = new Set(tokenize(text));
    // 同时索引单个中文字符，确保 textSimilarity 中 charJaccard 分量
    // （基于字符级重叠）也能命中候选节点，避免索引路径遗漏
    for (const ch of text) {
      if (/[\u4e00-\u9fa5]/.test(ch)) uniqueTokens.add(ch);
    }
    for (const token of uniqueTokens) {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token).add(node.id);
    }
  }
  return { index, nodeMap, nodeTexts };
}

/**
 * 使用关键词索引从 idea 文本中筛选候选节点 ID 集合。
 * 按共享 token 数降序排列，最多返回 maxCandidates 个。
 * @returns {Array<{nodeId:string, score:number}>} 候选节点列表
 */
function filterCandidatesByIndex(keywordIndex, ideaText, maxCandidates) {
  const ideaTokens = new Set(tokenize(ideaText));
  // 与 buildNodeKeywordIndex 保持一致：也加入单个中文字符，
  // 确保 charJaccard 命中的节点能进入候选集
  for (const ch of ideaText) {
    if (/[\u4e00-\u9fa5]/.test(ch)) ideaTokens.add(ch);
  }
  const candidateScores = new Map(); // nodeId -> shared token count
  for (const token of ideaTokens) {
    const nodeIds = keywordIndex.index.get(token);
    if (nodeIds) {
      for (const nodeId of nodeIds) {
        candidateScores.set(nodeId, (candidateScores.get(nodeId) || 0) + 1);
      }
    }
  }
  // 按共享 token 数降序，取 top candidates
  const sorted = [...candidateScores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, maxCandidates).map(([nodeId, score]) => ({ nodeId, score }));
}

/**
 * 自动检测 Idea 与已有图谱节点（heading/entity/document）的关联
 * 使用 textSimilarity 计算相似度，超过阈值则建立 idea-link 边
 * 返回需要新增的边数组（不直接修改传入的 edges 数组）
 *
 * 性能优化：对大图谱使用关键词倒排索引过滤候选集，将复杂度从 O(nodes) 降至 O(candidates)。
 * - 当传入 keywordIndex 时（syncAllIdeasToGraph 场景），直接复用索引
 * - 当未传入且 nodes > 200 时，临时构建索引
 * - 当 nodes <= 200 时，直接遍历（小图谱开销可忽略）
 * @param {Array} nodes — 图谱节点数组
 * @param {Object} idea — Idea 对象
 * @param {{index:Map,nodeMap:Map,nodeTexts:Map}|null} keywordIndex — 可选的关键词索引
 */
function autoAssociateIdeaToGraph(nodes, idea, keywordIndex = null) {
  const ideaText = (idea.title + ' ' + (idea.content || '')).trim();
  if (!ideaText) return [];

  const threshold = 0.25;
  const maxLinks = 10;
  const maxCandidates = 100; // 限制候选节点数量，避免大图谱性能问题
  const candidates = [];

  // 决定是否使用关键词索引
  // 当图谱较大（>200 节点）或已传入索引时，使用索引过滤候选集
  let activeIndex = keywordIndex;
  if (!activeIndex && nodes.length > 200) {
    activeIndex = buildNodeKeywordIndex(nodes);
  }

  if (activeIndex) {
    // 使用关键词索引过滤候选集，仅对候选节点计算 textSimilarity
    const filtered = filterCandidatesByIndex(activeIndex, ideaText, maxCandidates);
    for (const { nodeId } of filtered) {
      if (nodeId === idea.id) continue;
      if (idea.relatedNodeIds.includes(nodeId)) continue;
      const nodeText = activeIndex.nodeTexts.get(nodeId);
      if (!nodeText) continue;
      const sim = textSimilarity(ideaText, nodeText);
      if (sim >= threshold) {
        const node = activeIndex.nodeMap.get(nodeId);
        candidates.push({ nodeId, sim, nodeType: node?.type });
      }
    }
  } else {
    // 图谱较小，直接遍历所有节点
    for (const node of nodes) {
      // 跳过自身、其他 Idea 节点
      if (node.id === idea.id) continue;
      if (node.type === 'idea') continue;
      // 跳过已手动关联的
      if (idea.relatedNodeIds.includes(node.id)) continue;

      const nodeText = node.content || node.label || '';
      if (!nodeText || nodeText.length < 2) continue;

      const sim = textSimilarity(ideaText, nodeText);
      if (sim >= threshold) {
        candidates.push({ nodeId: node.id, sim, nodeType: node.type });
      }
    }
  }

  // 按相似度降序，取 top-N，返回新边数组（不可变）
  candidates.sort((a, b) => b.sim - a.sim);
  return candidates.slice(0, maxLinks).map(c => ({
    from: idea.id,
    to: c.nodeId,
    type: 'idea-link',
    weight: c.sim,
    evidence: { ideaId: idea.id, method: 'auto-associate', score: c.sim, nodeType: c.nodeType }
  }));
}

/**
 * 全量重建图谱后，重新同步所有 Idea 节点到图谱
 * 性能优化：构建一次关键词索引，供所有 Idea 的 autoAssociateIdeaToGraph 复用，
 * 将复杂度从 O(ideas x nodes) 降至 O(nodes + ideas x candidates)。
 */
export function syncAllIdeasToGraph() {
  if (!storage.graph || !storage.graph.nodes) return;
  const ideas = Array.from(storage.ideas.values());
  // 先按层级排序：父节点先入图，子节点后入图（确保父子边能建立）
  const sorted = sortIdeasByDepth(ideas);
  // 构建一次关键词索引（仅含非 idea 节点，这些节点在同步期间不变）
  const keywordIndex = buildNodeKeywordIndex(storage.graph.nodes);
  let count = 0;
  for (const idea of sorted) {
    if (idea.includeInGraph) {
      syncIdeaToGraph(idea, keywordIndex);
      count++;
    }
  }
}

/** 按 Idea 树深度排序（根节点在前） */
function sortIdeasByDepth(ideas) {
  const ideaMap = new Map(ideas.map(i => [i.id, i]));
  const depthCache = new Map();

  function getDepth(id) {
    if (depthCache.has(id)) return depthCache.get(id);
    const idea = ideaMap.get(id);
    if (!idea || !idea.parentId || !ideaMap.has(idea.parentId)) {
      depthCache.set(id, 0);
      return 0;
    }
    const d = getDepth(idea.parentId) + 1;
    depthCache.set(id, d);
    return d;
  }

  return ideas.sort((a, b) => getDepth(a.id) - getDepth(b.id));
}
