/** @module services/api/handlers/graph-build
 *  职责：POST /graph/build — 触发图谱构建
 */
import { runPipeline } from '../../../core/pipeline/index.js';
import { KnowledgeGraph, mergeConcepts } from '../../../core/graph/index.js';
import { buildCrossLinks, buildCrossLinksLLM } from '../../../core/graph/crosslink.js';
import { validateExtractedNodesAndEdges } from '../../../core/graph/llm-extractor.js';
import { storage, setGraph, getCurrentProjectId } from '../../storage.js';
import { getKGProvider } from '../../llm-provider.js';
import { syncAllIdeasToGraph } from './idea.js';

// 模块级构建锁：确保同一时刻只有一个图谱构建/重建任务在运行。
// 与 storage.building 不同，此变量在 finally 中无条件重置，
// 避免项目切换后 storage.building 未被重置导致后续构建被永久阻塞。
let buildInProgress = false;

/**
 * 快照当前图中的 cross-link 边 key 集合
 */
function snapshotCrossLinkKeys(graph) {
  const keys = new Set();
  for (const [key, edge] of graph.edges) {
    if (edge.type === 'cross-link') keys.add(key);
  }
  return keys;
}

/**
 * 校验本次新增的 cross-link 边，移除无效/悬空边
 * @returns {number} 校验后保留的有效 cross-link 数量
 */
function validateNewCrossLinks(graph, beforeKeys, context) {
  const newLinks = [];
  for (const [key, edge] of graph.edges) {
    if (edge.type !== 'cross-link') continue;
    if (beforeKeys.has(key)) continue;
    newLinks.push({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      weight: edge.weight,
      evidence: edge.evidence,
      source: edge.source || 'crosslink'
    });
  }

  const currentNodes = Array.from(graph.nodes.values()).map(n => ({
    id: n.id,
    type: n.type,
    content: n.content,
    source: n.source,
    weight: n.weight
  }));

  const { validEdges, droppedCount, errors } = validateExtractedNodesAndEdges(currentNodes, newLinks, null);

  if (droppedCount > 0) {
    const validKeys = new Set(validEdges.map(e => {
      const [a, b] = [e.from, e.to].sort();
      return `${a}|${b}|cross-link`;
    }));
    const keysToRemove = [];
    for (const [key, edge] of graph.edges) {
      if (edge.type !== 'cross-link') continue;
      if (beforeKeys.has(key)) continue;
      const [a, b] = [edge.from, edge.to].sort();
      const k = `${a}|${b}|cross-link`;
      if (!validKeys.has(k)) keysToRemove.push(key);
    }
    for (const key of keysToRemove) graph.edges.delete(key);
    console.warn(`[graph-build] ${context}: 清理 ${keysToRemove.length} 条无效 cross-link，原因：${errors.join('; ')}`);
  }

  return validEdges.length;
}

export async function graphBuildHandler({ documents, docIds, options } = {}) {
  // 并发检查：防止重复构建（模块级锁 + storage 标志双重保护）
  if (buildInProgress || storage.building) {
    return { success: false, error: '图谱构建正在进行中，请等待完成' };
  }
  // 记录构建开始时的项目 ID，构建过程中若项目被切换/删除则丢弃结果
  const startProjectId = getCurrentProjectId();
  const opts = options || {};
  const taskId = 'graph-build-' + Date.now();
  storage.resetTaskProgress(taskId);
  // 标记图谱正在构建中，阻止 CRUD handler 并发修改导致数据丢失
  buildInProgress = true;
  storage.building = true;
  try {

  // 如果传入 documents，用它们构建；否则用注册表的文档
  let docs = documents;
  if (!docs && storage.documents.size > 0) {
    docs = Array.from(storage.documents.values()).map(d => ({
      docId: d.docId,
      name: d.name,
      content: d.rawText,
      type: d.type,
      fontSizeStats: d.fontSizeStats || [],
      bookmarks: d.bookmarks || []
    }));
  }

  // 如果指定了 docIds，只保留对应文档（支持为单个文档增量生成图谱）
  const isIncremental = !!(docIds && docIds.length > 0);
  if (isIncremental) {
    const idSet = new Set(docIds);
    docs = (docs || []).filter(d => idSet.has(d.docId));
  }

  if (!docs || docs.length === 0) {
    storage.setTaskProgress({ stage: 'error', percent: 100, log: '没有可用的文档' });
    const message = docIds && docIds.length > 0
      ? `未找到指定的文档：${docIds.join(', ')}`
      : '没有可用的文档';
    return { success: false, error: message, nodes: [], edges: [] };
  }

  // 估算总文本长度和分块数，用于进度展示
  const totalTextLen = docs.reduce((s, d) => s + (d.content || '').length, 0);
  const chunkSize = (opts.extractOptions && opts.extractOptions.chunkSize) || 2500;
  const estimatedChunks = Math.max(1, Math.ceil(totalTextLen / chunkSize));
  const docNames = docs.map(d => d.name || d.docId).join(', ');
  storage.setTaskProgress({
    stage: 'start',
    percent: 5,
    log: isIncremental
      ? `开始重新构建「${docNames}」的知识图谱（预计 ${estimatedChunks} 个分块）...`
      : `开始构建知识图谱（${docs.length} 个文档，预计 ${estimatedChunks} 个分块）...`,
    chunkCount: estimatedChunks
  });

  // 运行管线 — 传入真实 onProgress 回调，更新共享存储
  const kgProvider = getKGProvider();
  const result = await runPipeline(docs, {
    onProgress: (p) => {
      storage.setTaskProgress({
        stage: p.stage || 'buildGraph',
        percent: Math.min(95, Math.max(5, p.percent || 0)),
        log: p.log || '',
        chunkIndex: p.chunkIndex || 0,
        chunkCount: p.chunkCount || estimatedChunks
      });
    },
    provider: kgProvider,
    extractOptions: opts.extractOptions || { maxTerms: 80 },
    minSeedTerms: opts.minSeedTerms
  });

  // 收集 pipeline 中已发生的跨文档关联错误
  const crossLinkErrors = Array.isArray(result.crossLinkErrors) ? [...result.crossLinkErrors] : [];

  // 构建过程中项目可能被切换/删除，检查项目一致性，避免结果写入错误项目
  if (getCurrentProjectId() !== startProjectId) {
    storage.setTaskProgress({ stage: 'error', percent: 100, log: '项目已切换，构建结果已丢弃' });
    return { success: false, error: '项目已切换，构建结果已丢弃', nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
  }

  storage.setTaskProgress({ stage: 'merge', percent: 96, log: '合并概念与跨文档连接...' });

  // 转为 KnowledgeGraph
  const globalGraph = new KnowledgeGraph();
  for (const node of result.graph.nodes) {
    globalGraph.addNode(node);
  }
  for (const edge of result.graph.edges) {
    globalGraph.addEdge(edge);
  }

  // 概念合并（仅合并 type='concept' 节点，不影响按文档独立的 entity/heading）
  const mergeResult = mergeConcepts(globalGraph, { threshold: opts.mergeThreshold || 0.85 });

  // 跨文档连接已在 pipeline 中完成（按 heading/entity 分别连接），不再重复执行
  const serialized = globalGraph.serialize();

  // 如果是为单个/部分文档增量生成，合并到已有图谱（按节点 id 去重）
  if (isIncremental && storage.graph && storage.graph.nodes) {
    const idSet = new Set(docIds);

    // Save old state for rollback
    const oldNodes = [...storage.graph.nodes];
    const oldEdges = [...storage.graph.edges];
    const oldStats = storage.graph.stats ? { ...storage.graph.stats } : {};
    const oldProvider = storage.graph.provider;

    try {
      // 先清理这些文档旧的节点和边，避免配置变更后残留旧实体/旧标题
      const newNodes = oldNodes.filter(n => {
        // 保留文档节点本身；只清理属于本次重建文档的非文档节点（标题、实体等）
        if (n.type === 'document') return true;
        const nodeDocId = n.source?.docId || n.meta?.docId;
        if (!nodeDocId) return true;
        return !idSet.has(nodeDocId);
      });
      // 清理悬挂边：任一端点已被移除（属于本次重建文档的非文档节点）的边
      const nodeIdSet = new Set(newNodes.map(n => n.id));
      const newEdges = oldEdges.filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to));

      const existingNodeIds = new Set(newNodes.map(n => n.id));
      const existingEdgeKeys = new Set(
        newEdges.map(e => [e.from, e.to, e.type].join('|||'))
      );
      for (const node of serialized.nodes) {
        if (!existingNodeIds.has(node.id)) {
          newNodes.push(node);
          existingNodeIds.add(node.id);
        }
      }
      for (const edge of serialized.edges) {
        const key = [edge.from, edge.to, edge.type].join('|||');
        if (!existingEdgeKeys.has(key)) {
          newEdges.push(edge);
          existingEdgeKeys.add(key);
        }
      }
      // 更新统计
      // crossLinks 暂设为 0，统一在最终跨文档关联计算完成后设置准确值
      const newStats = {
        ...oldStats,
        nodeCount: newNodes.length,
        edgeCount: newEdges.length,
        mergedCount: (oldStats?.mergedCount || 0) + mergeResult.mergedCount,
        crossLinks: 0
      };
      // Only replace on success
      setGraph({ nodes: newNodes, edges: newEdges, stats: newStats, provider: oldProvider });
    } catch (e) {
      // Restore old state
      setGraph({ nodes: oldNodes, edges: oldEdges, stats: oldStats, provider: oldProvider });
      throw e;
    }
  } else {
    // 全量重建
    setGraph({
      nodes: serialized.nodes,
      edges: serialized.edges,
      stats: {
        ...globalGraph.stats(),
        mergedCount: mergeResult.mergedCount,
        crossLinks: serialized.edges.filter(e => e.type === 'cross-link').length
      },
      provider: kgProvider?.config || { provider: 'stub', model: '' }
    });
  }

  // 跨文档关联：
  // - 全量重建时 pipeline 已处理所有文档，这里再执行一次可确保不遗漏（buildCrossLinks 会自动去重）
  // - 增量构建时 pipeline 只处理部分文档，必须在这里补做新文档与已有文档的跨文档关联
  storage.setTaskProgress({ stage: 'crossLink', percent: 97, log: '计算跨文档关联...' });
  try {
    const finalGraph = new KnowledgeGraph();
    for (const node of storage.graph.nodes) finalGraph.addNode(node);
    for (const edge of storage.graph.edges) finalGraph.addEdge(edge);

    // 优先使用 LLM 做语义跨文档关联，无可用模型时回退到规则相似度
    const provider = getKGProvider();
    const threshold = opts.crossLinkThreshold || 0.25;
    const baseOptions = {
      threshold,
      nodeTypes: ['heading', 'entity'],
      maxPairs: opts.crossLinkMaxPairs || 200
    };
    let crossLinkCount = 0;
    const crossLinkBeforeKeys = snapshotCrossLinkKeys(finalGraph);
    if (provider && provider.name !== 'stub') {
      const llmResult = await buildCrossLinksLLM(finalGraph, {
        provider, ...baseOptions, timeoutMs: 90000
      });
      crossLinkCount = llmResult.linkCount;
      if (crossLinkCount < 3) {
        crossLinkErrors.push({
          stage: 'crossLink-llm-fallback',
          message: `LLM 跨文档关联仅产生 ${crossLinkCount} 条边，已回退到规则相似度`
        });
        const ruleResult = buildCrossLinks(finalGraph, baseOptions);
        crossLinkCount = ruleResult.linkCount;
      }
    } else {
      const ruleResult = buildCrossLinks(finalGraph, baseOptions);
      crossLinkCount = ruleResult.linkCount;
    }

    // ★ 校验本次新增的 cross-link，过滤悬空/非法边
    crossLinkCount = validateNewCrossLinks(finalGraph, crossLinkBeforeKeys, 'graphBuildHandler');

    // 跨文档关联计算包含异步操作，完成后再次检查项目一致性
    if (getCurrentProjectId() !== startProjectId) {
      console.warn('[graph-build] 跨文档关联计算期间项目已切换，丢弃结果');
      storage.setTaskProgress({ stage: 'error', percent: 100, log: '项目已切换，构建结果已丢弃' });
      return { success: false, error: '项目已切换，构建结果已丢弃', nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }

    // 不通过 KnowledgeGraph.serialize() 覆盖原始节点数组，
    // 避免 GraphNode.toJSON() 往返时丢失节点扩展字段
    // （label, color, shape, radius, x, y, vx, vy, level, ideaId 等）
    // 仅用序列化后的边更新 edges（包含原有边 + 新计算的 cross-link 边）
    const serializedFinal = finalGraph.serialize();
    storage.graph.edges = serializedFinal.edges;
    storage.graph.stats = {
      ...storage.graph.stats,
      nodeCount: storage.graph.nodes.length,
      edgeCount: storage.graph.edges.length,
      crossLinks: serializedFinal.edges.filter(e => e.type === 'cross-link').length
    };
  } catch (e) {
    console.warn('[graph-build] 跨文档关联失败:', e.message);
    crossLinkErrors.push({ stage: 'crossLink', message: e.message });
  }

  // 全量重建或增量构建后，重新同步所有 Idea 节点到图谱
  // （全量重建会覆盖图谱导致 Idea 节点丢失；增量构建后图谱变化也需要重新计算自动关联）
  syncAllIdeasToGraph();

  storage.setTaskProgress({
    stage: 'done',
    percent: 100,
    log: isIncremental
      ? `「${docNames}」重建完成：${storage.graph.nodes.length} 节点，${storage.graph.edges.length} 边`
      : `构建完成：${storage.graph.nodes.length} 节点，${storage.graph.edges.length} 边`
  });

  return {
    nodes: storage.graph.nodes,
    edges: storage.graph.edges,
    stats: storage.graph.stats,
    provider: kgProvider?.config || { provider: 'stub', model: '' },
    crossLinkErrors: crossLinkErrors.length > 0 ? crossLinkErrors : undefined
  };
  } finally {
    // 模块级锁始终释放，确保即使项目切换也不会永久阻塞后续构建
    buildInProgress = false;
    // 仅当项目未切换时才清除 storage 标志，避免影响新项目的构建状态
    if (getCurrentProjectId() === startProjectId) {
      storage.building = false;
    }
  }
}

/**
 * 仅重新计算跨文档关联（cross-link），不重新解析文档
 * POST /graph/crosslinks/rebuild
 */
export async function rebuildCrossLinksHandler({ options } = {}) {
  // 并发检查：防止重复构建（模块级锁 + storage 标志双重保护）
  if (buildInProgress || storage.building) {
    return { success: false, error: '图谱构建正在进行中，请等待完成' };
  }
  // 记录构建开始时的项目 ID，构建过程中若项目被切换/删除则丢弃结果
  const startProjectId = getCurrentProjectId();
  const opts = options || {};
  const taskId = 'crosslinks-rebuild-' + Date.now();
  storage.resetTaskProgress(taskId);

  if (!storage.graph || !storage.graph.nodes || storage.graph.nodes.length === 0) {
    storage.setTaskProgress({ stage: 'error', percent: 100, log: '当前没有知识图谱' });
    return { success: false, error: '当前没有知识图谱', nodes: [], edges: [] };
  }

  storage.setTaskProgress({ stage: 'crossLink', percent: 10, log: '正在重新计算跨文档关联...' });

  // 标记图谱正在构建中，阻止 CRUD handler 并发修改导致数据丢失
  buildInProgress = true;
  storage.building = true;
  try {
    const finalGraph = new KnowledgeGraph();
    for (const node of storage.graph.nodes) finalGraph.addNode(node);
    for (const edge of storage.graph.edges) finalGraph.addEdge(edge);

    const provider = getKGProvider();
    const threshold = opts.crossLinkThreshold || 0.25;
    const baseOptions = {
      threshold,
      nodeTypes: ['heading', 'entity'],
      sourceDocIds: opts.sourceDocIds,
      targetDocIds: opts.targetDocIds,
      maxPairs: opts.crossLinkMaxPairs || 200
    };
    let totalLinkCount = 0;
    let methodUsed = 'rule';

    // 快照清理前的 cross-link 边，用于后续校验新增边
    const crossLinkBeforeKeys = snapshotCrossLinkKeys(finalGraph);

    // 如果指定了 source/target（多选重建模式），只清理这些文档相关的旧 cross-link
    const affectedDocIds = new Set([
      ...(opts.sourceDocIds || []),
      ...(opts.targetDocIds || [])
    ]);
    for (const edge of [...finalGraph.edges.values()]) {
      if (edge.type !== 'cross-link') continue;
      if (affectedDocIds.size === 0) {
        finalGraph.removeEdge(edge.from, edge.to, 'cross-link');
      } else {
        const fromNode = finalGraph.nodes.get(edge.from);
        const toNode = finalGraph.nodes.get(edge.to);
        const fromDocId = fromNode?.source?.docId;
        const toDocId = toNode?.source?.docId;
        if (affectedDocIds.has(fromDocId) || affectedDocIds.has(toDocId)) {
          finalGraph.removeEdge(edge.from, edge.to, 'cross-link');
        }
      }
    }

    if (provider && provider.name !== 'stub') {
      // 有 LLM 时：一次调用同时处理 heading + entity
      const llmResult = await buildCrossLinksLLM(finalGraph, {
        provider,
        ...baseOptions,
        timeoutMs: 90000
      });
      totalLinkCount = llmResult.linkCount;
      methodUsed = 'llm';

      // LLM 结果过少时，补充规则相似度连接
      if (totalLinkCount < 3) {
        const ruleResult = buildCrossLinks(finalGraph, baseOptions);
        totalLinkCount = ruleResult.linkCount;
        methodUsed = 'llm+rule-fallback';
      }
    } else {
      // 无 LLM 时：规则相似度
      const ruleResult = buildCrossLinks(finalGraph, baseOptions);
      totalLinkCount = ruleResult.linkCount;
    }

    // ★ 校验本次新增的 cross-link，过滤悬空/非法边
    totalLinkCount = validateNewCrossLinks(finalGraph, crossLinkBeforeKeys, 'rebuildCrossLinksHandler');

    // 跨文档关联计算包含异步操作，完成后检查项目一致性，避免结果写入错误项目
    if (getCurrentProjectId() !== startProjectId) {
      console.warn('[rebuildCrossLinks] 计算期间项目已切换，丢弃结果');
      storage.setTaskProgress({ stage: 'error', percent: 100, log: '项目已切换，构建结果已丢弃' });
      return { success: false, error: '项目已切换，构建结果已丢弃', nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
    }

    // 不通过 KnowledgeGraph.serialize() 覆盖原始节点数组，
    // 避免 GraphNode.toJSON() 往返时丢失节点扩展字段
    // （label, color, shape, radius, x, y, vx, vy, level, ideaId 等）
    // 仅用序列化后的边更新 edges（包含原有边 + 新计算的 cross-link 边）
    const serializedFinal = finalGraph.serialize();
    storage.graph.edges = serializedFinal.edges;
    storage.graph.stats = {
      ...storage.graph.stats,
      nodeCount: storage.graph.nodes.length,
      edgeCount: storage.graph.edges.length,
      crossLinks: serializedFinal.edges.filter(e => e.type === 'cross-link').length
    };

    // 重新同步 Idea 节点关联
    syncAllIdeasToGraph();

    storage.setTaskProgress({
      stage: 'done',
      percent: 100,
      log: `跨文档关联重建完成：${totalLinkCount} 条 cross-link`
    });

    return {
      success: true,
      nodes: storage.graph.nodes,
      edges: storage.graph.edges,
      stats: storage.graph.stats,
      crossLinks: totalLinkCount,
      method: methodUsed
    };
  } catch (e) {
    console.error('[rebuildCrossLinks] 失败:', e);
    storage.setTaskProgress({ stage: 'error', percent: 100, log: '跨文档关联重建失败：' + e.message });
    return { success: false, error: e.message, nodes: storage.graph.nodes, edges: storage.graph.edges };
  } finally {
    // 模块级锁始终释放，确保即使项目切换也不会永久阻塞后续构建
    buildInProgress = false;
    // 仅当项目未切换时才清除 storage 标志，避免影响新项目的构建状态
    if (getCurrentProjectId() === startProjectId) {
      storage.building = false;
    }
  }
}
