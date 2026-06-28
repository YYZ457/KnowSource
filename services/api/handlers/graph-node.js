/** @module services/api/handlers/graph-node
 *  图谱节点与边的人工增删改
 */
import { randomUUID } from 'crypto';
import { storage, setGraph, isProjectSwitching } from '../../storage.js';

/**
 * 有效的边类型集合
 * 涵盖手动创建、自动抽取、跨文档关联、Idea 关联等所有合法边类型
 */
const VALID_EDGE_TYPES = new Set([
  // 手动创建
  'manual',
  // 无向边类型（来自 edge.js UNDIRECTED_TYPES）
  'similar', 'related', 'cross-link', 'co-occurrence', 'semantic', 'relates', 'also-known-as',
  // 层级/包含关系
  'belong', 'contains', 'hierarchy', 'includes',
  // Idea 关联
  'idea-hierarchy', 'idea-link',
  // 语义关系（unsupervised.js 模式匹配生成）
  'is', 'of', 'affects', 'refers-to', 'enables', 'examines',
  // 其他合法类型
  'derive', 'cite'
]);

/**
 * 有效的节点类型集合
 * 涵盖手动创建、自动抽取、文档/标题/实体、Idea 等所有合法节点类型
 */
const VALID_NODE_TYPES = new Set([
  'concept',    // 概念节点（图谱构建器默认类型）
  'entity',     // 实体节点（pipeline 无监督抽取）
  'heading',    // 标题节点（pipeline 标题检测）
  'document',   // 文档顶层节点
  'idea',       // Idea 节点（idea.js 同步入图）
  'manual'      // 手动创建节点
]);

/**
 * 互斥锁：通过 Promise 链串行化所有 CRUD 写操作，
 * 避免并发"读取-修改-写入"导致的数据丢失。
 * 即使当前操作是同步的，此锁也能在未来引入异步逻辑时提供保护。
 */
let crudChain = Promise.resolve();
function withCrudLock(fn) {
  const p = crudChain.then(fn, fn);
  // 无论上一次操作成功或失败，都继续执行下一次
  crudChain = p.then(() => undefined, () => undefined);
  return p;
}

/**
 * 检查图谱是否正在构建中。
 * 构建期间（graph-build.js 设置 storage.building = true）拒绝所有 CRUD 写操作，
 * 避免构建完成后覆盖用户的手动修改。
 */
function checkNotBuilding() {
  if (storage.building) {
    return { success: false, error: '图谱正在构建中，无法修改节点/边，请稍后再试' };
  }
  return null;
}

function validateNodeInput(input) {
  if (!input || typeof input !== 'object') return '参数为空';
  if (!input.content || typeof input.content !== 'string' || !input.content.trim()) {
    return '节点内容不能为空';
  }
  // 验证 type：如果提供了 type，必须是有效值
  if (input.type !== undefined && input.type !== null && input.type !== '') {
    if (typeof input.type !== 'string' || !VALID_NODE_TYPES.has(input.type)) {
      return `无效的节点类型: ${input.type}，有效类型为: ${Array.from(VALID_NODE_TYPES).join(', ')}`;
    }
  }
  return null;
}

function normalizeSource(source = {}) {
  const out = {};
  if (source.docId) out.docId = source.docId;
  if (source.sectionId) out.sectionId = source.sectionId;
  if (typeof source.page === 'number' && source.page > 0) out.page = source.page;
  if (typeof source.start === 'number') out.start = source.start;
  if (typeof source.end === 'number') out.end = source.end;
  return out;
}

export function listNodes({ type } = {}) {
  const nodes = storage.graph?.nodes || [];
  if (type) return nodes.filter(n => n.type === type);
  return nodes;
}

export async function createNode({ type = 'concept', content, source = {}, meta = {}, weight = 1 } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  const err = validateNodeInput({ type, content });
  if (err) return { success: false, error: err };

  return withCrudLock(() => {
    // 在锁内再次检查构建标志，防止等待锁期间构建开始
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const id = `manual-${randomUUID().slice(0, 8)}`;
    const node = {
      id,
      type,
      content: content.trim(),
      source: normalizeSource(source),
      meta: {
        ...meta,
        createdBy: 'manual',
        createdAt: Date.now()
      },
      weight: typeof weight === 'number' ? weight : 1,
      embedding: null,
      aliases: []
    };

    // 不可变更新：单次赋值完成读取-写入，避免 await 点之间上下文切换导致数据丢失
    storage.graph.nodes = [...(storage.graph?.nodes || []), node];

    return { success: true, node };
  });
}

export async function updateNode({ id, content, source, meta, weight } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!id) return { success: false, error: '缺少节点 id' };

  return withCrudLock(() => {
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const currentNodes = storage.graph?.nodes || [];
    const existing = currentNodes.find(n => n.id === id);
    if (!existing) return { success: false, error: '节点不存在' };

    const node = { ...existing };
    if (content !== undefined) node.content = content.trim();
    if (source !== undefined) node.source = normalizeSource(source);
    if (weight !== undefined) node.weight = weight;
    if (meta !== undefined) {
      node.meta = { ...node.meta, ...meta, updatedAt: Date.now() };
    }

    // 不可变更新：单次赋值完成读取-写入，避免竞态条件
    storage.graph.nodes = currentNodes.map(n => n.id === id ? node : n);
    return { success: true, node };
  });
}

export async function deleteNode({ id } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!id) return { success: false, error: '缺少节点 id' };

  return withCrudLock(() => {
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const currentNodes = storage.graph?.nodes || [];
    if (!currentNodes.some(n => n.id === id)) {
      return { success: false, error: '节点不存在' };
    }
    const currentEdges = storage.graph?.edges || [];
    // 不可变更新：单次赋值完成读取-写入，避免竞态条件
    storage.graph.nodes = currentNodes.filter(n => n.id !== id);
    storage.graph.edges = currentEdges.filter(e => e.from !== id && e.to !== id);
    return { success: true, deletedId: id };
  });
}

export async function createEdge({ from, to, type = 'manual', weight = 1, evidence = {} } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!from || !to) return { success: false, error: '边的 from/to 不能为空' };
  if (!VALID_EDGE_TYPES.has(type)) {
    return { success: false, error: `无效的边类型: ${type}，有效类型为: ${Array.from(VALID_EDGE_TYPES).join(', ')}` };
  }

  return withCrudLock(() => {
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const nodes = storage.graph?.nodes || [];
    if (!nodes.some(n => n.id === from)) return { success: false, error: 'from 节点不存在' };
    if (!nodes.some(n => n.id === to)) return { success: false, error: 'to 节点不存在' };

    const edges = storage.graph?.edges || [];
    // 检查重复边（from + to + type 相同视为重复）
    const isDuplicate = edges.some(e =>
      e.from === from && e.to === to && e.type === type
    );
    if (isDuplicate) return { success: false, error: '边已存在（from/to/type 重复）' };

    const edge = {
      from,
      to,
      type,
      weight: typeof weight === 'number' ? weight : 1,
      evidence: { ...evidence, createdBy: 'manual', createdAt: Date.now() }
    };

    // 不可变更新：单次赋值完成读取-写入，避免竞态条件
    storage.graph.edges = [...edges, edge];
    return { success: true, edge };
  });
}

export async function deleteEdge({ from, to, type } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!from || !to) return { success: false, error: '边的 from/to 不能为空' };

  return withCrudLock(() => {
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const existing = storage.graph?.edges || [];
    // 检查是否存在匹配的边，与 deleteNode 行为一致：不存在则返回错误
    const matched = existing.filter(e => {
      if (e.from !== from || e.to !== to) return false;
      if (type && e.type !== type) return false;
      return true;
    });
    if (matched.length === 0) {
      return { success: false, error: '边不存在' };
    }
    // 不可变更新：单次赋值完成读取-写入，避免竞态条件
    storage.graph.edges = existing.filter(e => {
      if (e.from !== from || e.to !== to) return true;
      if (type && e.type !== type) return true;
      return false;
    });
    return { success: true, deletedCount: matched.length };
  });
}

/**
 * 更新边的属性（type / weight / evidence）
 * 通过 from + to + type（可选）定位边，更新指定字段
 * @param {string} from - 边的起点节点 id
 * @param {string} to - 边的终点节点 id
 * @param {string} [type] - 边的类型（用于区分同 from/to 的多条边，不传则匹配所有）
 * @param {string} [newType] - 新的边类型（需在 VALID_EDGE_TYPES 中）
 * @param {number} [weight] - 新的权重
 * @param {object} [evidence] - 新的证据信息（整体替换）
 * @returns {Promise<{success: boolean, updated?: Array, error?: string}>}
 */
export async function updateEdge({ from, to, type, newType, weight, evidence } = {}) {
  if (isProjectSwitching()) {
    return { success: false, error: '项目正在切换中，请稍后再试' };
  }
  if (!from || !to) return { success: false, error: '边的 from/to 不能为空' };
  if (newType !== undefined && !VALID_EDGE_TYPES.has(newType)) {
    return { success: false, error: `无效的边类型: ${newType}，有效类型为: ${Array.from(VALID_EDGE_TYPES).join(', ')}` };
  }

  return withCrudLock(() => {
    const blocked = checkNotBuilding();
    if (blocked) return blocked;

    const existing = storage.graph?.edges || [];
    // 查找匹配的边
    const matched = existing.filter(e => {
      if (e.from !== from || e.to !== to) return false;
      if (type && e.type !== type) return false;
      return true;
    });
    if (matched.length === 0) {
      return { success: false, error: '边不存在' };
    }

    // 如果要修改 type，检查新 type 是否与已有边冲突（排除自身）
    if (newType !== undefined && newType !== type) {
      const conflict = existing.some(e =>
        e.from === from && e.to === to && e.type === newType &&
        !(type ? e.type === type : false)
      );
      if (conflict) {
        return { success: false, error: '更新后的边已存在（from/to/newType 重复）' };
      }
    }

    // 不可变更新：构建新边数组
    const updatedEdges = [];
    const newEdges = existing.map(e => {
      const isMatch = e.from === from && e.to === to && (!type || e.type === type);
      if (!isMatch) return e;

      const updated = { ...e };
      if (newType !== undefined) updated.type = newType;
      if (weight !== undefined) updated.weight = typeof weight === 'number' ? weight : e.weight;
      if (evidence !== undefined) {
        updated.evidence = { ...evidence, updatedAt: Date.now() };
      }
      updatedEdges.push(updated);
      return updated;
    });

    // 不可变更新：单次赋值完成读取-写入，避免竞态条件
    storage.graph.edges = newEdges;
    return { success: true, updated: updatedEdges };
  });
}
