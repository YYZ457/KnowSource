<script setup>
/** GraphView — 右栏：可交互知识图谱（SVG + d3-force） */
import { ref, shallowRef, computed, watch, nextTick, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { useDocumentStore } from '@/stores/document';
import { useIdeaStore } from '@/stores/idea';
import { useUiStore } from '@/stores/ui';
import { useProjectStore } from '@/stores/project';
import { useToastStore } from '@/stores/toast';
import { useDialog } from '@/composables/useDialog';
import { readKGExtractOptions } from '@/utils/kg-options';
import { forceSimulation, forceManyBody, forceCenter, forceLink, forceCollide, forceRadial } from 'd3-force';
import GraphNodeTree from './GraphNodeTree.vue';
import GraphIdeaTree from './GraphIdeaTree.vue';

const graphStore = useGraphStore();
const docStore = useDocumentStore();
const ideaStore = useIdeaStore();
const uiStore = useUiStore();
const projectStore = useProjectStore();
const toast = useToastStore();
const dialog = useDialog();

const container = ref(null);
const mainEl = ref(null);
const svg = ref(null);
const tooltip = ref({ show: false, x: 0, y: 0, text: '' });

// 右键上下文菜单
const contextMenu = ref({ show: false, x: 0, y: 0, nodeId: null });
// 节点创建/编辑弹窗
const nodeDialog = ref({ show: false, mode: 'create', nodeId: null, parentId: null });
const nodeForm = ref({
  content: '',
  type: 'manual',
  docId: '',
  page: null,
  start: null,
  shape: 'circle',
  size: 24,
  color: '',
  parentId: ''
});

// 连线创建/删除弹窗
const edgeDialog = ref({ show: false, sourceId: null });
const edgeForm = ref({ targetId: '', type: 'related', weight: 0.8 });
const edgeDeleteDialog = ref({ show: false, nodeId: null });

// 连线模式：点击工具栏"连线"按钮进入，依次点击两个节点创建连线
const linkMode = ref(false);
const linkSourceId = ref(null);
// 标记刚完成连线模式操作，抑制紧随其后的 dblclick 弹出跳转浮窗
let justCompletedLinkAction = false;

const FONT_SIZE = 13;
const PAD_X = 16;
const PAD_Y = 10;
const MAX_LABEL_WIDTH = 240;
const MAX_LABEL_CHARS = 40;
const MAX_NODES = 120;
const CORE_NODES = 20; // 默认显示的核心节点数

// ============ CSS 变量读取辅助 ============
// SVG 元素无法直接使用 CSS 变量，需通过 getComputedStyle 获取
const FALLBACK_DOC_PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#a855f7'];
const FALLBACK_HEADING_PALETTE = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#64748b', '#475569'];
const FALLBACK_COMMUNITY_PALETTE = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#a855f7', '#ef4444'];

function getCssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

function getCssVarArray(name, fallback) {
  const raw = getCssVar(name, '');
  if (!raw) return fallback;
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

// ============ 节点颜色缓存 ============
// SVG 元素无法直接使用 CSS 变量，需通过 getComputedStyle 获取。
// 为避免每次渲染都调用 getComputedStyle（性能开销），在组件挂载时
// 一次性读取所有节点颜色变量并缓存，后续渲染直接引用缓存值。
const nodeColors = {
  selectedFill: '#facc15',
  selectedStroke: '#b45309',
  highlightFill: '#10b981',
  highlightStroke: '#059669',
  ideaFill: '#f59e0b',
  questionFill: '#ef4444',
  rootFill: '#64748b',
  conceptFill: '#6366f1',
  entityFill: '#8b5cf6',
  headingFill: '#2563eb',
  documentFill: '#3b82f6',
  defaultFill: '#64748b',
  activeStroke: '#fbbf24',
  defaultStroke: '#ffffff',
  textSelected: '#1f2937',
  textLight: '#ffffff',
};

/** 从 CSS 变量刷新节点颜色缓存，在 initResources 中调用 */
function refreshNodeColors() {
  nodeColors.selectedFill = getCssVar('--node-color-selected', '#facc15');
  nodeColors.selectedStroke = getCssVar('--node-stroke-selected', '#b45309');
  nodeColors.highlightFill = getCssVar('--node-highlight-fill', '#10b981');
  nodeColors.highlightStroke = getCssVar('--node-highlight-stroke', '#059669');
  nodeColors.ideaFill = getCssVar('--node-idea-fill', '#f59e0b');
  nodeColors.questionFill = getCssVar('--node-question-fill', '#ef4444');
  nodeColors.rootFill = getCssVar('--node-root-fill', '#64748b');
  nodeColors.conceptFill = getCssVar('--node-concept-fill', '#6366f1');
  nodeColors.entityFill = getCssVar('--node-entity-fill', '#8b5cf6');
  nodeColors.headingFill = getCssVar('--node-heading-fill', '#2563eb');
  nodeColors.documentFill = getCssVar('--node-document-fill', '#3b82f6');
  nodeColors.defaultFill = getCssVar('--node-color-default', '#64748b');
  nodeColors.activeStroke = getCssVar('--node-stroke-active', '#fbbf24');
  nodeColors.defaultStroke = getCssVar('--node-stroke-default', '#ffffff');
  nodeColors.textSelected = getCssVar('--node-text-selected', '#1f2937');
  nodeColors.textLight = getCssVar('--node-text-light', '#ffffff');
  // 同步刷新边颜色缓存，避免 edgeColor 每次渲染都调用 getComputedStyle
  refreshEdgeColors();
}

// ============ 边颜色缓存 ============
// edgeColor 在模板 v-for 中为每条边调用，若每次都走 getCssVar → getComputedStyle，
// 100+ 条边时会产生数百次 getComputedStyle 调用，严重拖慢渲染。
// 在组件挂载时一次性读取所有边颜色变量并缓存。
const edgeColors = {
  aggregated: '#94a3b8',
  crossLink: '#f43f5e',
  ideaLink: '#f59e0b',
  ideaHierarchy: '#fbbf24',
  belong: '#fcd34d',
  hierarchy: '#6366f1',
  semantic: '#64748b',
  default: '#cbd5e1',
  selected: '#2563eb',
};

function refreshEdgeColors() {
  edgeColors.aggregated = getCssVar('--edge-color-aggregated', '#94a3b8');
  edgeColors.crossLink = getCssVar('--edge-color-cross-link', '#f43f5e');
  edgeColors.ideaLink = getCssVar('--edge-color-idea-link', '#f59e0b');
  edgeColors.ideaHierarchy = getCssVar('--edge-color-idea-hierarchy', '#fbbf24');
  edgeColors.belong = getCssVar('--edge-color-belong', '#fcd34d');
  edgeColors.hierarchy = getCssVar('--edge-color-hierarchy', '#6366f1');
  edgeColors.semantic = getCssVar('--edge-color-semantic', '#64748b');
  edgeColors.default = getCssVar('--edge-color-default', '#cbd5e1');
  edgeColors.selected = getCssVar('--edge-color-selected', '#2563eb');
}

// 多文件色彩调色板（docId 哈希映射，保证同文档同色）
const DOC_COLOR_PALETTE = getCssVarArray('--node-palette-doc', FALLBACK_DOC_PALETTE);

// 标题层级颜色（L1 最突出，越深越远）
const HEADING_LEVEL_COLORS = getCssVarArray('--node-palette-heading', FALLBACK_HEADING_PALETTE);

// 社区颜色调色板（比 backend 的更柔和，保证文字可读性）
const COMMUNITY_COLOR_PALETTE = getCssVarArray('--node-palette-community', FALLBACK_COMMUNITY_PALETTE);

const docColorMap = new Map();
function getDocColor(docId) {
  if (!docId) return nodeColors.defaultFill;
  if (docColorMap.has(docId)) return docColorMap.get(docId);
  // 按文档首次出现顺序分配颜色，避免哈希冲突导致两个文档同色
  const usedColors = new Set(docColorMap.values());
  const color = DOC_COLOR_PALETTE.find(c => !usedColors.has(c)) || DOC_COLOR_PALETTE[docColorMap.size % DOC_COLOR_PALETTE.length];
  docColorMap.set(docId, color);
  return color;
}

// 标题层级映射
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

let simulation = null;
let resizeObserver = null;
let resizeTimer = null;
let measureCanvas = null;
let prevPositions = new Map();
// 缓存节点查找映射，在 buildGraphData 中更新，供 tick 回调复用，避免每帧 new Map()
const cachedNodeMap = new Map();
// 缓存 DOM 元素引用，避免 tick 回调每帧调用 querySelectorAll
let nodeElCache = null;
let linkElCache = null;
// rAF 节流标志，避免 tick 频率高于浏览器刷新率
let rafPending = false;
// 资源初始化守卫标志：防止 KeepAlive 下 onMounted + onActivated 连续触发导致重复初始化
let resourcesInitialized = false;

const nodes = shallowRef([]);
const links = shallowRef([]);
const transform = ref({ x: 0, y: 0, k: 1 });
const viewSize = ref({ width: 300, height: 300 });
const containerWidth = ref(0);
const WIDE_LAYOUT_THRESHOLD = 520; // 容器宽度大于此值时节点列表移到右侧
const isWideLayout = computed(() => containerWidth.value >= WIDE_LAYOUT_THRESHOLD);
const dragNode = ref(null);
const dragNodeEl = ref(null);
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0, tx: 0, ty: 0 });
const panMoved = ref(false);
const nodeDragMoved = ref(false);
const nodeDragStart = ref({ x: 0, y: 0 });
const expandedIds = ref(new Set());
const hasAutoFitted = ref(false);

// 下方树形列表状态：层级子节点与 link 邻居分开控制
const treeExpandedHierarchyIds = ref(new Set());
const treeExpandedLinksIds = ref(new Set());
// treeListVisible 已移入 uiStore（L-1），此处直接使用 uiStore.treeListVisible

// 节点列表分栏：文件 / Idea
const treeActiveTab = ref('files'); // 'files' | 'ideas'

// 双击跳转确认浮窗状态
const jumpConfirm = ref({ show: false, nodeId: null, x: 0, y: 0 });
// 跳转确认浮窗元素引用：用于测量实际高度，替代硬编码 POPUP_HEIGHT（M-9）
const jumpConfirmEl = ref(null);

// 添加 Idea 弹窗
const addIdeaDialog = ref({ show: false, title: '', content: '' });

// 导出菜单
const showExportMenu = ref(false);

// Idea 可见性切换 loading 状态：防止用户在异步切换期间重复点击（L-3）
const ideaToggling = ref(false);

const selectedId = computed(() => graphStore.selectedNodeId);
const highlightedIds = computed(() => graphStore.highlightedNodes);
const crossLinkCount = computed(() => graphStore.edges.filter(e => e.type === 'cross-link').length);

const activeNodeIds = computed(() => {
  const set = new Set();
  if (!selectedId.value) return set;
  set.add(selectedId.value);
  for (const l of links.value) {
    if (l.source.id === selectedId.value) set.add(l.target.id);
    if (l.target.id === selectedId.value) set.add(l.source.id);
  }
  return set;
});

/**
 * 构建下方树形列表数据：document -> 层级子节点 / link 邻居
 * 每个节点的层级子节点与 link 邻居分开存放，便于 UI 独立展开。
 */
const treeNodes = computed(() => {
  const rawNodes = graphStore.nodes || [];
  const rawEdges = graphStore.edges || [];
  if (rawNodes.length === 0) return [];

  const nodeMap = new Map(rawNodes.map(n => [n.id, n]));
  // 预计算排序键与标签，避免在 sortChildren / buildTreeNode 中重复访问嵌套属性
  // 对于大图谱（数百~数千节点），可将每次 computed 重算时的属性访问从 O(N * D) 降至 O(N)
  const sortKeyMap = new Map();
  const labelMap = new Map();
  for (const n of rawNodes) {
    sortKeyMap.set(n.id, {
      isHeading: n.type === 'heading',
      level: n.meta?.level || 0,
      start: n.meta?.start || 0,
      weight: n.meta?.pagerank || n.pagerank || n.weight || 0
    });
    labelMap.set(n.id, String(n.content || n.label || n.keyword || n.id || ''));
  }
  // 层级子节点（contains / hierarchy）
  const childMap = new Map();
  // 所有 link 邻居（任意边类型）
  const neighborMap = new Map();
  for (const e of rawEdges) {
    if (e.type === 'contains' || e.type === 'hierarchy' || e.type === 'idea-hierarchy') {
      if (!childMap.has(e.from)) childMap.set(e.from, []);
      childMap.get(e.from).push(e.to);
    }
    if (!neighborMap.has(e.from)) neighborMap.set(e.from, []);
    if (!neighborMap.has(e.to)) neighborMap.set(e.to, []);
    neighborMap.get(e.from).push(e.to);
    neighborMap.get(e.to).push(e.from);
  }

  // 直接对 ID 数组排序，使用预计算的 sortKeyMap，避免 map->filter->sort->map 链式中间数组
  function sortChildren(ids) {
    return ids
      .filter(id => nodeMap.has(id))
      .sort((a, b) => {
        const ka = sortKeyMap.get(a);
        const kb = sortKeyMap.get(b);
        // heading 按层级/位置排序
        if (ka.isHeading && kb.isHeading) {
          if (ka.level !== kb.level) return ka.level - kb.level;
          return ka.start - kb.start;
        }
        // 实体按权重/pagerank 排序
        return kb.weight - ka.weight;
      });
  }

  function buildTreeNode(id, visited = new Set(), allowLinkRecurse = true) {
    const n = nodeMap.get(id);
    if (!n || visited.has(id)) return null;
    visited.add(id);

    const key = sortKeyMap.get(id);
    const hierarchyIds = sortChildren([...new Set(childMap.get(id) || [])]);
    const allNeighborIds = new Set((neighborMap.get(id) || []).filter(x => x !== id));
    for (const hid of hierarchyIds) allNeighborIds.delete(hid);
    const linkIds = sortChildren([...allNeighborIds]);

    return {
      id: n.id,
      type: n.type,
      label: labelMap.get(id),
      level: key.level,
      weight: key.weight,
      source: n.source,
      hierarchyChildren: hierarchyIds.map(cid => buildTreeNode(cid, new Set(visited), allowLinkRecurse)).filter(Boolean),
      // link 邻居不再递归展开自己的 link 邻居，避免稠密图下组合爆炸导致页面卡死
      linkChildren: allowLinkRecurse
        ? linkIds.map(cid => buildTreeNode(cid, new Set(visited), false)).filter(Boolean)
        : []
    };
  }

  const docIds = rawNodes.filter(n => n.type === 'document').map(n => n.id);
  if (docIds.length === 0) {
    // 没有 document 节点时，以顶层 heading 为根
    const headings = rawNodes.filter(n => n.type === 'heading');
    const minLevel = Math.min(...headings.map(n => n.meta?.level || 1));
    const rootIds = headings
      .filter(n => (n.meta?.level || 1) === minLevel)
      .sort((a, b) => (a.meta?.start || 0) - (b.meta?.start || 0))
      .map(n => n.id);
    return rootIds.map(id => buildTreeNode(id)).filter(Boolean);
  }

  return docIds.map(id => buildTreeNode(id)).filter(Boolean);
});

/**
 * Idea 树：从 ideaStore 直接构建（确保已创建但未入图的 Idea 也能显示）
 * - 顶层 Idea（无 parentId 或父 Idea 不存在）作为根
 * - 父子关系由 ideaStore 的 parentId 决定
 * - 关联节点从图谱的 idea-link / belong 边补充
 */
const ideaTreeNodes = computed(() => {
  const ideas = ideaStore.ideas || [];
  if (ideas.length === 0) return [];

  const rawNodes = graphStore.nodes || [];
  const rawEdges = graphStore.edges || [];
  const nodeMap = new Map(rawNodes.map(n => [n.id, n]));

  const ideaMap = new Map(ideas.map(i => [i.id, i]));

  // 关联节点：idea-link / belong 边
  const linkMap = new Map();
  for (const e of rawEdges) {
    if ((e.type === 'idea-link' || e.type === 'belong') && ideaMap.has(e.from)) {
      if (!linkMap.has(e.from)) linkMap.set(e.from, []);
      linkMap.get(e.from).push(e.to);
    }
  }

  // 已入图的 Idea 节点映射
  const graphIdeaMap = new Map();
  for (const n of rawNodes) {
    if (n.type === 'idea' && ideaMap.has(n.id)) {
      graphIdeaMap.set(n.id, n);
    }
  }

  function sortLinkIds(ids) {
    return ids
      .map(id => nodeMap.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const wa = a.weight || 1;
        const wb = b.weight || 1;
        return wb - wa;
      })
      .map(n => n.id);
  }

  function buildIdeaNode(idea, visited = new Set(), allowLinkRecurse = true) {
    if (!idea || visited.has(idea.id)) return null;
    visited.add(idea.id);

    const graphNode = graphIdeaMap.get(idea.id);
    const includeInGraph = idea.includeInGraph !== false;

    // 子 Idea
    const childIdeas = ideas.filter(i => i.parentId === idea.id);

    // 关联节点
    const linkIds = sortLinkIds([...new Set(linkMap.get(idea.id) || [])]);

    return {
      id: idea.id,
      type: 'idea',
      label: idea.title || graphNode?.label || graphNode?.content || 'Idea',
      level: 0,
      weight: graphNode?.weight || 1,
      source: graphNode?.source || { docId: 'idea', sectionId: idea.id },
      includeInGraph,
      meta: { color: idea.color },
      hierarchyChildren: childIdeas
        .map(child => buildIdeaNode(child, new Set(visited), allowLinkRecurse))
        .filter(Boolean),
      linkChildren: allowLinkRecurse
        ? linkIds.map(cid => {
            const n = nodeMap.get(cid);
            if (!n) return null;
            return {
              id: n.id,
              type: n.type,
              label: getNodeLabel(n),
              level: n.meta?.level || 0,
              weight: n.weight || 1,
              source: n.source,
              includeInGraph: true,
              hierarchyChildren: [],
              linkChildren: []
            };
          }).filter(Boolean)
        : []
    };
  }

  // 顶层 Idea：没有父节点，或父节点不存在
  const roots = ideas.filter(i => !i.parentId || !ideaMap.has(i.parentId));
  return roots.map(i => buildIdeaNode(i)).filter(Boolean);
});

function getNodeLabel(node) {
  return String(node.content || node.label || node.keyword || node.id || '');
}

/** 从 CSS 变量 --font-sans 读取字体栈，与 body 保持一致（缓存避免频繁 getComputedStyle） */
let _cachedFontStack = null;
function getFontStack() {
  if (_cachedFontStack) return _cachedFontStack;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim();
  _cachedFontStack = css || `'Inter', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  return _cachedFontStack;
}

function measureText(text, fontSize = FONT_SIZE) {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  ctx.font = `${fontSize}px ${getFontStack()}`;
  return { width: ctx.measureText(text).width, height: fontSize * 1.25 };
}

/**
 * 按节点类型和层级返回基础尺寸和字体大小
 * document 最大，L1 次之，L2 再次，L3+ 和 entity 最小
 */
function getNodeSize(node) {
  const level = node.meta?.level || 0;
  // 用户自定义大小（直径或矩形边长），仅在显式设置且足够大时才生效，保留默认尺寸
  const customSize = node.meta?.size;
  if (customSize !== undefined && customSize !== null && customSize !== '' && Number(customSize) >= 32) {
    const s = Number(customSize);
    if (node.meta?.shape === 'circle' || node.type === 'idea') {
      return { width: s, height: s, fontSize: Math.max(10, Math.min(18, s / 3)), radius: s / 2 };
    }
    return { width: s, height: s, fontSize: Math.max(10, Math.min(18, s / 3)) };
  }
  if (node.type === 'document') return { width: 320, height: 90, fontSize: 24 };
  if (node.type === 'heading') {
    // 层级越深节点越小，文档/标题/实体形成明显的大小梯度
    if (level === 1) return { width: 260, height: 76, fontSize: 20 };
    if (level === 2) return { width: 190, height: 56, fontSize: 16 };
    if (level === 3) return { width: 140, height: 42, fontSize: 13 };
    return { width: 100, height: 34, fontSize: 12 }; // L4+
  }
  if (node.type === 'idea' || node.type === 'question') {
    const radius = node.radius || Math.max(32, Math.min(64, (node.label || node.content || '').length * 8 + 16));
    return { width: radius * 2, height: radius * 2, fontSize: 12, radius };
  }
  return { width: 96, height: 34, fontSize: 11 }; // entity 最小，默认显示更多文字
}

function truncateLabel(label) {
  const base = label.length > MAX_LABEL_CHARS ? label.slice(0, MAX_LABEL_CHARS) + '…' : label;
  if (measureText(base).width <= MAX_LABEL_WIDTH) return base;
  let low = 0;
  let high = label.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = label.slice(0, mid) + '…';
    if (measureText(candidate).width <= MAX_LABEL_WIDTH) low = mid;
    else high = mid - 1;
  }
  return label.slice(0, low) + '…';
}

/**
 * 按指定宽度和字体大小截断标签
 */
function truncateLabelByWidth(label, maxWidth, fontSize = FONT_SIZE) {
  if (!label) return '';
  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * 0.6)));
  const base = label.length > maxChars ? label.slice(0, maxChars) + '…' : label;
  if (measureText(base, fontSize).width <= maxWidth) return base;
  let low = 0;
  let high = label.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = label.slice(0, mid) + '…';
    if (measureText(candidate, fontSize).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return label.slice(0, low) + '…';
}

function getNodeFill(node) {
  // 鼠标选中节点使用高对比度的亮黄色，确保与任何文档颜色都能区分
  if (node.id === selectedId.value) return nodeColors.selectedFill;
  // 手动高亮仍用绿色；但选中节点的关联节点保持原文档颜色，避免分不清文档归属
  if (highlightedIds.value.has(node.id)) return nodeColors.highlightFill;

  // Idea 节点优先使用用户设置的颜色（从 ideaStore 实时查找，确保颜色修改立即生效）
  if (node.type === 'idea') {
    const idea = ideaStore.ideas.find(i => i.id === node.id);
    if (idea?.color) return idea.color;
    return nodeColors.ideaFill;
  }

  // 文档、标题、实体节点强制按所属文档着色，不允许被 meta.color 覆盖，
  // 保证"同一文档下所有节点同色，仅大小区分层级"。
  const docId = node.source?.docId || node.meta?.docId;
  if (docId) return getDocColor(docId);

  // Question / Root 保持特殊颜色
  if (node.type === 'question') return nodeColors.questionFill;
  if (node.type === 'root') return nodeColors.rootFill;

  // 兜底：无文档归属的自定义节点才使用 meta.color
  if (node.meta?.color) return node.meta.color;
  return nodeColors.defaultFill;
}

function getNodeTextColor(node) {
  if (node.id === selectedId.value) return nodeColors.textSelected;
  // 彩色节点统一用白字；仅当填充色很浅时才用深色
  const fill = getNodeFill(node);
  const luminance = getLuminance(fill);
  if (luminance > 0.72) return nodeColors.textSelected;
  return nodeColors.textLight;
}

function getLuminance(hex) {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map(v => parseInt(v, 16) / 255) || [0, 0, 0];
  const [r, g, b] = rgb.map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getNodeStroke(node) {
  // 选中节点使用深棕色粗边框，与亮黄填充形成强对比
  if (node.id === selectedId.value) return nodeColors.selectedStroke;
  // 手动高亮用绿色边框
  if (highlightedIds.value.has(node.id)) return nodeColors.highlightStroke;
  // 选中节点的关联节点用醒目的金色边框突出，同时保留原文档填充色
  if (selectedId.value && activeNodeIds.value.has(node.id)) return nodeColors.activeStroke;
  return nodeColors.defaultStroke;
}

function nodeOpacity(node) {
  if (!selectedId.value) return 1;
  return activeNodeIds.value.has(node.id) ? 1 : 0.25;
}

function nodeStrokeWidth(node) {
  if (node.id === selectedId.value) return 3;
  if (selectedId.value && activeNodeIds.value.has(node.id)) return 2.5;
  return 1.5;
}

function nodeFilter(node) {
  if (selectedId.value && activeNodeIds.value.has(node.id)) return 'url(#node-glow)';
  return 'url(#node-shadow)';
}

function edgeOpacity(edge) {
  // 搜索高亮：高亮节点之间的边完全显示，关联边半透明，其余边很淡
  if (highlightedIds.value.size > 0) {
    if (highlightedIds.value.has(edge.from) && highlightedIds.value.has(edge.to)) return 1;
    if (highlightedIds.value.has(edge.from) || highlightedIds.value.has(edge.to)) return 0.6;
    return 0.15;
  }
  // 聚合边在未选中时更淡，避免视觉喧宾夺主
  if (edge.aggregated && !selectedId.value) return 0.35;
  // 跨文档连线在未选中时保持较高可见度
  if (edge.type === 'cross-link' && !selectedId.value) return 0.85;
  if (!selectedId.value) return 0.55;
  const s = edge.source.id === selectedId.value;
  const t = edge.target.id === selectedId.value;
  return (s || t) ? 1 : 0.12;
}

function edgeColor(edge) {
  // 使用缓存的 CSS 变量值，避免每条边都调用 getComputedStyle
  if (edge.aggregated) return edgeColors.aggregated;
  if (edge.type === 'cross-link') return edgeColors.crossLink;
  if (edge.type === 'idea-link') return edgeColors.ideaLink;
  if (edge.type === 'idea-hierarchy') return edgeColors.ideaHierarchy;
  if (edge.type === 'belong') return edgeColors.belong;
  if (edge.type === 'hierarchy') return edgeColors.hierarchy;
  if (isSemanticEdge(edge.type)) return edgeColors.semantic;
  if (!selectedId.value) return edgeColors.default;
  const s = edge.source.id === selectedId.value;
  const t = edge.target.id === selectedId.value;
  return (s || t) ? edgeColors.selected : edgeColors.default;
}

function edgeWidth(edge) {
  // 聚合边略细
  if (edge.aggregated) return Math.max(1, Math.min(2, (edge.weight || 1) * 0.8));
  // 跨文档连线明显加粗，提高可见度
  if (edge.type === 'cross-link') return Math.max(2.5, Math.min(4.5, (edge.weight || 1) * 2));
  if (edge.type === 'idea-link') return Math.max(1.5, Math.min(2.5, (edge.weight || 1) * 2));
  // 语义边统一 1.5，层级边按权重
  if (isSemanticEdge(edge.type)) return 1.5;
  if (!selectedId.value) return Math.max(1, Math.min(3, (edge.weight || 1)));
  const s = edge.source.id === selectedId.value;
  const t = edge.target.id === selectedId.value;
  return (s || t) ? 2.5 : 1;
}

function edgeDashArray(edge) {
  // 聚合边用长虚线，提示这是折叠后的概括关系
  if (edge.aggregated) return '8 5';
  // 跨文档连线虚线
  if (edge.type === 'cross-link') return '6 4';
  // 语义相关边统一虚线
  if (isSemanticEdge(edge.type)) return '5 3';
  if (edge.type === 'idea-link') return '4 3';
  if (edge.type === 'belong') return '2 3';
  return 'none';
}

function isSemanticEdge(type) {
  return ['related', 'causes', 'part-of', 'treats', 'similar'].includes(type);
}

/**
 * 计算边的弯曲系数，供 edgePath 与 updateNodePositions 共享，
 * 避免两处曲线计算不一致导致视觉跳变。
 */
function getEdgeCurve(edge) {
  // 聚合边更直，避免折叠后的概括关系过度弯曲
  if (edge.aggregated) return 0.03;
  // 层级边轻微弯曲
  if (edge.type === 'hierarchy' || edge.type === 'contains') return 0.05;
  // 语义相关边弯曲更明显，减少直线交叉
  if (isSemanticEdge(edge.type)) return 0.15;
  // 默认轻微弯曲
  return 0.08;
}

/**
 * 计算带轻微弯曲的边路径，减少直线交叉带来的视觉混乱
 */
function edgePath(edge) {
  const sx = edge.source.x;
  const sy = edge.source.y;
  const tx = edge.target.x;
  const ty = edge.target.y;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  const curve = getEdgeCurve(edge);

  const offset = dist * curve;
  const cx = (sx + tx) / 2 - (dy / dist) * offset;
  const cy = (sy + ty) / 2 + (dx / dist) * offset;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

function updateViewSize() {
  const el = container.value;
  if (el) {
    const rect = el.getBoundingClientRect();
    containerWidth.value = Math.max(0, rect.width);
  }
  const main = mainEl.value;
  if (main) {
    const rect = main.getBoundingClientRect();
    viewSize.value = { width: Math.max(200, rect.width), height: Math.max(200, rect.height) };
  }
}

async function buildGraphForDoc(docId) {
  try {
    await graphStore.buildGraphForDoc(docId);
  } catch (err) {
    console.error('构建图谱失败:', err);
    toast.error('构建图谱失败: ' + (err.message || err));
  }
}

async function buildMissingGraphs() {
  try {
    const extractOptions = readKGExtractOptions();
    const allDocIds = docStore.documents.map(d => d.meta.docId);
    const docIdsWithGraph = new Set(
      graphStore.nodes
        .filter(n => n.source?.docId && n.type !== 'document')
        .map(n => n.source.docId)
    );
    const missing = allDocIds.filter(id => !docIdsWithGraph.has(id));
    if (missing.length === 0) {
      toast.info('所有文档已生成知识图谱');
      return;
    }
    await graphStore.buildGraph(extractOptions, missing);
    toast.success(`已为 ${missing.length} 个文档生成/补全知识图谱`);
  } catch (err) {
    console.error('补全图谱失败:', err);
    toast.error('补全图谱失败: ' + (err.message || err));
  }
}

/**
 * 计算每个节点到最近的 document 根节点的深度
 * document 深度为 0，直接子节点为 1，以此类推
 */
function computeNodeDepth(nodes, edges) {
  const depthMap = new Map();
  const docIds = new Set();
  const children = new Map(); // parent -> [children]
  for (const n of nodes) {
    if (n.type === 'document' || n.type === 'root') {
      docIds.add(n.id);
      depthMap.set(n.id, 0);
    }
  }
  for (const e of edges) {
    if (e.type === 'contains' || e.type === 'hierarchy' || e.type === 'idea-hierarchy') {
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from).push(e.to);
    }
  }
  const queue = [...docIds];
  while (queue.length > 0) {
    const cur = queue.shift();
    const curDepth = depthMap.get(cur) || 0;
    for (const child of children.get(cur) || []) {
      if (!depthMap.has(child) || depthMap.get(child) > curDepth + 1) {
        depthMap.set(child, curDepth + 1);
        queue.push(child);
      }
    }
  }
  // 未访问的节点默认深度 2
  for (const n of nodes) {
    if (!depthMap.has(n.id)) depthMap.set(n.id, 2);
  }
  return depthMap;
}

/**
 * 根据后端力导向结果计算缩放参数（仅基于可见节点）
 */
function computeBackendScale(nodes, visibleIds, viewSize) {
  const withPos = nodes.filter(n => visibleIds.has(n.id) && n.meta?.x != null && n.meta?.y != null);
  if (withPos.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of withPos) {
    minX = Math.min(minX, n.meta.x);
    minY = Math.min(minY, n.meta.y);
    maxX = Math.max(maxX, n.meta.x);
    maxY = Math.max(maxY, n.meta.y);
  }
  const graphW = Math.max(1, maxX - minX);
  const graphH = Math.max(1, maxY - minY);
  const padding = 120;
  const scale = Math.min(
    (viewSize.width - padding * 2) / graphW,
    (viewSize.height - padding * 2) / graphH,
    1.2
  );
  return {
    scale,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

/**
 * 层级径向初始布局：按深度分布到不同半径的环上，同深度按角度均匀分布
 */
function radialInitialPosition(node, level, depth, viewSize, allNodes) {
  const cx = viewSize.width / 2;
  const cy = viewSize.height / 2;
  const minDim = Math.min(viewSize.width, viewSize.height);

  if (node.type === 'document' || node.type === 'root') {
    return { x: cx, y: cy };
  }

  // 同一深度/层级的节点按 docId+type 分组，计算稳定角度
  const ringRadius = Math.min(minDim * 0.18 * (depth || 1), minDim * 0.42);

  // 用节点 id 哈希生成稳定角度，避免随机导致每次重建都抖动
  let hash = 0;
  const seed = node.id || '';
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const angle = ((Math.abs(hash) % 360) / 360) * Math.PI * 2;

  return {
    x: cx + Math.cos(angle) * ringRadius,
    y: cy + Math.sin(angle) * ringRadius
  };
}

// 计算折叠父节点的聚合边：把子树中节点与外部的联系提升到最近的可见祖先上
// simNodeMap 为 buildGraphData 中构建的模拟节点映射（含 x/y/width/height 等布局字段），
// 必须使用它而非 rawNodes，否则聚合边的 source/target 会指向缺少布局字段的原始 store 节点。
function computeAggregatedLinks(rawNodes, rawEdges, visibleIds, childMap, parentMap, simNodeMap) {
  const links = [];
  const added = new Set();
  const nodeMap = simNodeMap || new Map(rawNodes.map(n => [n.id, n]));

  // 辅助：找到 nodeId 的最近可见祖先（包含自己）
  // visited 集合用于环检测，防止 parentMap 中存在循环引用时无限递归
  function findVisibleAncestor(nodeId, visited = new Set()) {
    if (visibleIds.has(nodeId)) return nodeId;
    if (visited.has(nodeId)) return null; // 检测到环，终止递归
    visited.add(nodeId);
    const parents = parentMap.get(nodeId);
    if (!parents || parents.size === 0) return null;
    for (const pid of parents) {
      const ancestor = findVisibleAncestor(pid, visited);
      if (ancestor) return ancestor;
    }
    return null;
  }

  // 辅助：获取某节点的整个子树（包含自己）
  function collectSubtree(rootId, set = new Set()) {
    if (set.has(rootId)) return set;
    set.add(rootId);
    const children = childMap.get(rootId);
    if (children) {
      for (const cid of children) collectSubtree(cid, set);
    }
    return set;
  }

  // 对所有有隐藏后代的可见父节点做聚合
  for (const n of rawNodes) {
    if (!visibleIds.has(n.id)) continue;
    const children = childMap.get(n.id);
    if (!children || children.size === 0) continue;

    const hasHiddenChild = [...children].some(cid => !visibleIds.has(cid));
    if (!hasHiddenChild) continue;

    const subtree = collectSubtree(n.id);

    for (const e of rawEdges) {
      const fromIn = subtree.has(e.from);
      const toIn = subtree.has(e.to);
      // 完全在子树内部的边不需要聚合（内部边在展开时已显示）
      if (fromIn && toIn) continue;
      // 完全在外部的边也不需要处理
      if (!fromIn && !toIn) continue;

      const internalId = fromIn ? e.from : e.to;
      const externalId = fromIn ? e.to : e.from;

      // 外部端点映射到其最近可见祖先
      const externalVisible = findVisibleAncestor(externalId);
      if (!externalVisible || externalVisible === n.id) continue;

      // 保持原始边的方向
      const sourceId = fromIn ? n.id : externalVisible;
      const targetId = fromIn ? externalVisible : n.id;
      const key = `${sourceId}→${targetId}`;
      if (added.has(key)) continue;
      added.add(key);

      const source = nodeMap.get(sourceId);
      const target = nodeMap.get(targetId);
      if (!source || !target) continue;

      links.push({
        ...e,
        key: `agg-${key}`,
        source,
        target,
        aggregated: true
      });
    }
  }

  return links;
}

function buildGraphData() {
  const rawNodes = graphStore.nodes || [];
  const rawEdges = graphStore.edges || [];
  if (rawNodes.length === 0) {
    nodes.value = [];
    links.value = [];
    return;
  }

  // 清理已不存在节点的位置缓存，避免 prevPositions 无限增长
  const currentNodeIds = new Set(rawNodes.map(n => n.id));
  for (const key of prevPositions.keys()) {
    if (!currentNodeIds.has(key)) prevPositions.delete(key);
  }

  // 保留上次位置，避免每次重建都重新抖动
  for (const n of nodes.value) prevPositions.set(n.id, { x: n.x, y: n.y });

  // 渐进展示策略：
  // - 初始仅显示 document（文件）节点
  // - 单击节点只展开其直接层级子节点（contains/hierarchy/idea-hierarchy）
  // - 共现/语义/跨文档 link 等不在单击时展开，仅在被选中时高亮
  // - 无 document 节点时回退到 heading 骨架 + 核心实体
  const visibleIds = new Set();
  // 层级子节点/父节点映射（仅 hierarchy 类边）
  const childMap = new Map(); // parentId -> Set(childId)
  const parentMap = new Map(); // childId -> Set(parentId)
  for (const e of rawEdges) {
    if (e.type === 'contains' || e.type === 'hierarchy' || e.type === 'idea-hierarchy') {
      if (!childMap.has(e.from)) childMap.set(e.from, new Set());
      if (!parentMap.has(e.to)) parentMap.set(e.to, new Set());
      childMap.get(e.from).add(e.to);
      parentMap.get(e.to).add(e.from);
    }
  }

  const hasDocNodes = rawNodes.some(n => n.type === 'document');

  if (hasDocNodes) {
    // 根节点：document 节点和默认显示的 Idea 节点
    const roots = new Set();
    for (const n of rawNodes) {
      if (n.type === 'document') roots.add(n.id);
    }
    const ideaStoreMap = new Map(ideaStore.ideas.map(i => [i.id, i]));
    for (const n of rawNodes) {
      if (n.type === 'idea') {
        const storeIdea = ideaStoreMap.get(n.id);
        const includeInGraph = storeIdea ? storeIdea.includeInGraph !== false : true;
        if (includeInGraph) roots.add(n.id);
      }
    }
    // BFS：根节点始终可见；若某可见节点处于展开状态，则其直接层级子节点也可见
    const queue = [...roots];
    for (const id of roots) visibleIds.add(id);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (expandedIds.value.has(cur)) {
        for (const cid of childMap.get(cur) || []) {
          if (!visibleIds.has(cid)) {
            visibleIds.add(cid);
            queue.push(cid);
          }
        }
      }
    }
  } else {
    // 回退：无 document 节点时，顶层 heading 为根 + 核心实体（兼容旧数据）
    const sorted = [...rawNodes]
      .sort((a, b) => {
        const headingBoostA = a.type === 'heading' ? 1000 - (a.meta?.level || 3) * 100 : 0;
        const headingBoostB = b.type === 'heading' ? 1000 - (b.meta?.level || 3) * 100 : 0;
        const pa = headingBoostA + (a.meta?.pagerank || a.pagerank || a.weight || 0);
        const pb = headingBoostB + (b.meta?.pagerank || b.pagerank || b.weight || 0);
        return pb - pa;
      })
      .slice(0, MAX_NODES);
    const roots = new Set();
    for (const n of sorted) {
      if (n.type === 'heading' && !(parentMap.has(n.id) && parentMap.get(n.id).size > 0)) {
        roots.add(n.id);
      }
    }
    // 若没有任何顶层 heading，则取权重最高的 heading 作为根
    if (roots.size === 0) {
      for (const n of sorted) {
        if (n.type === 'heading') {
          roots.add(n.id);
          break;
        }
      }
    }
    let coreFilled = 0;
    for (const n of sorted) {
      if (n.type !== 'heading' && coreFilled < CORE_NODES) {
        roots.add(n.id);
        coreFilled++;
      }
    }
    const queue = [...roots];
    for (const id of roots) visibleIds.add(id);
    while (queue.length > 0) {
      const cur = queue.shift();
      if (expandedIds.value.has(cur)) {
        for (const cid of childMap.get(cur) || []) {
          if (!visibleIds.has(cid)) {
            visibleIds.add(cid);
            queue.push(cid);
          }
        }
      }
    }
  }

  const nodeMap = new Map();

  // 计算从 document 根出发的层级深度（用于径向布局兜底）
  const depthMap = computeNodeDepth(rawNodes, rawEdges);

  // 后端布局缩放：把 backend 计算出的 x/y 缩放到当前视图（仅基于当前可见节点）
  const backendScale = computeBackendScale(rawNodes, visibleIds, viewSize.value);

  nodes.value = rawNodes
    .filter(n => visibleIds.has(n.id))
    .map(n => {
      const label = getNodeLabel(n);
      const baseSize = getNodeSize(n);
      // 按层级字体测量文本，截断标签
      const maxLabelWidth = baseSize.width - PAD_X * 2;
      const display = truncateLabelByWidth(label, maxLabelWidth, baseSize.fontSize);
      const size = measureText(display, baseSize.fontSize);
      const prev = prevPositions.get(n.id);
      const level = n.meta?.level || 0;
      let x, y;
      if (prev) {
        x = prev.x;
        y = prev.y;
      } else if (n.meta?.x != null && n.meta?.y != null && backendScale != null) {
        // 优先使用后端力导向布局结果
        x = viewSize.value.width / 2 + (n.meta.x - backendScale.cx) * backendScale.scale;
        y = viewSize.value.height / 2 + (n.meta.y - backendScale.cy) * backendScale.scale;
      } else {
        // 兜底：按层级径向布局，减少初始重叠
        const pos = radialInitialPosition(n, level, depthMap.get(n.id) || 0, viewSize.value, rawNodes);
        x = pos.x;
        y = pos.y;
      }
      return {
        ...n,
        labelText: label,
        displayLabel: display,
        // 矩形尺寸取 max(层级基础尺寸, 文本测量尺寸 + padding)
        width: Math.max(baseSize.width, size.width + PAD_X * 2),
        height: Math.max(baseSize.height, size.height + PAD_Y * 2),
        fontSize: baseSize.fontSize,
        radius: baseSize.radius,
        shape: n.meta?.shape || n.shape || (n.type === 'idea' ? 'circle' : 'rect'),
        depth: depthMap.get(n.id) || 0,
        x,
        y,
        vx: 0,
        vy: 0
      };
    });

  nodes.value.forEach(n => nodeMap.set(n.id, n));

  // 同步更新缓存映射，供 tick 回调复用，避免每帧 new Map()
  cachedNodeMap.clear();
  nodes.value.forEach(n => cachedNodeMap.set(n.id, n));

  // 原始可见边：层级边 + 语义边，只要两端可见就显示
  const visibleLinks = rawEdges
    .filter(e => visibleIds.has(e.from) && visibleIds.has(e.to))
    .map((e, i) => ({
      ...e,
      key: `${e.from}→${e.to}-${i}`,
      source: nodeMap.get(e.from),
      target: nodeMap.get(e.to)
    }));

  // 聚合边：当某个父节点收起时，把它子树中节点与外部的联系提升到该父节点上
  // 传入 buildGraphData 中构建的 nodeMap（模拟节点，含布局字段），确保聚合边引用正确的节点对象
  const aggregatedLinks = computeAggregatedLinks(rawNodes, rawEdges, visibleIds, childMap, parentMap, nodeMap);

  links.value = [...visibleLinks, ...aggregatedLinks];
}

function refreshElCache() {
  nodeElCache = new Map();
  linkElCache = new Map();
  if (!svg.value) return;
  svg.value.querySelectorAll('.node[data-node-id]').forEach(el => {
    nodeElCache.set(el.getAttribute('data-node-id'), el);
  });
  svg.value.querySelectorAll('.graph-link').forEach(el => {
    const from = el.getAttribute('data-from');
    const to = el.getAttribute('data-to');
    // 包含边类型与聚合标志，避免同一节点对的多条不同类型边互相覆盖
    const type = el.getAttribute('data-edge-type') || '';
    const aggregated = el.getAttribute('data-aggregated') === 'true' ? '1' : '0';
    linkElCache.set(`${from}-${to}-${type}-${aggregated}`, { el, from, to });
  });
}

function updateNodePositions() {
  if (!nodeElCache || !linkElCache) return;
  // 使用缓存的 DOM 元素引用，避免每帧 querySelectorAll
  nodeElCache.forEach((el, id) => {
    const node = cachedNodeMap.get(id);
    if (node) el.setAttribute('transform', `translate(${node.x},${node.y})`);
  });
  linkElCache.forEach(({ el, from: fromId, to: toId }) => {
    const from = cachedNodeMap.get(fromId);
    const to = cachedNodeMap.get(toId);
    if (from && to) {
      // 使用与 edgePath 一致的二次贝塞尔曲线计算，避免视觉跳变
      const sx = from.x;
      const sy = from.y;
      const tx = to.x;
      const ty = to.y;
      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const curve = getEdgeCurve({ aggregated: el.getAttribute('data-aggregated') === 'true', type: el.getAttribute('data-edge-type') });
      const offset = dist * curve;
      const cx = (sx + tx) / 2 - (dy / dist) * offset;
      const cy = (sy + ty) / 2 + (dx / dist) * offset;
      el.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`);
    }
  });
}

function onTick() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    updateNodePositions();
  });
}

function initSimulation() {
  if (simulation) {
    // 复用已有 simulation，避免每次 redraw 从头开始布局
    simulation.nodes(nodes.value);
    simulation.force('link').links(links.value);
    simulation.alpha(0.3).restart();
    return;
  }
  if (nodes.value.length === 0) return;

  const minDim = Math.min(viewSize.value.width, viewSize.value.height);
  const maxDepth = Math.max(1, ...nodes.value.map(n => n.depth || 0));

  simulation = forceSimulation(nodes.value)
    .force('charge', forceManyBody()
      .strength(d => {
        // document/根节点轻微吸引，实体节点较强排斥
        if (d.type === 'document' || d.type === 'root') return -800;
        if (d.type === 'heading') return -500;
        return -300;
      })
      .distanceMax(minDim * 0.6)
    )
    .force('center', forceCenter(viewSize.value.width / 2, viewSize.value.height / 2))
    .force('link', forceLink(links.value)
      .id(d => d.id)
      .distance(d => {
        if (d.type === 'hierarchy' || d.type === 'idea-hierarchy') return Math.max(100, minDim * 0.14);
        if (d.type === 'contains') {
          // document -> heading 间距更大，缓解星型拥堵
          const sourceDepth = d.source.depth || 0;
          return sourceDepth === 0 ? Math.max(140, minDim * 0.24) : Math.max(110, minDim * 0.16);
        }
        if (d.type === 'co-occurrence' || d.type === 'semantic') return Math.max(160, minDim * 0.22);
        if (d.type === 'cross-link' || d.type === 'similar') return Math.max(180, minDim * 0.26);
        if (d.type === 'idea-link' || d.type === 'belong') return Math.max(160, minDim * 0.22);
        return Math.max(140, minDim * 0.2);
      })
      .strength(d => {
        if (d.type === 'hierarchy' || d.type === 'idea-hierarchy') return 0.85;
        if (d.type === 'contains') return 0.7;
        if (d.type === 'cross-link' || d.type === 'similar') return 0.25;
        if (d.type === 'idea-link' || d.type === 'belong') return 0.3;
        return 0.4;
      })
    )
    // 径向力：把不同深度的节点拉向不同半径的环，缓解中心拥堵
    .force('radial', forceRadial(d => {
      const depth = d.depth || 0;
      if (depth === 0) return 0;
      return Math.min(minDim * 0.18 * depth, minDim * 0.45);
    }, viewSize.value.width / 2, viewSize.value.height / 2)
      .strength(d => {
        if (d.type === 'document' || d.type === 'root') return 0.05;
        if (d.type === 'heading') return 0.25;
        return 0.12;
      })
    )
    .force('collide', forceCollide()
      .radius(d => {
        // 圆形节点用半径计算碰撞范围，矩形节点用对角线一半，确保碰撞检测与视觉形状匹配
        if (d.shape === 'circle' || d.type === 'idea') {
          return (d.radius || Math.max(d.width, d.height) / 2) + 14;
        }
        return Math.hypot(d.width, d.height) / 2 + 14;
      })
      .iterations(4)
      .strength(0.95)
    )
    .alphaDecay(0.04)
    .velocityDecay(0.85)
    .on('tick', onTick)
    .on('end', () => {
      // 首次布局结束后自动适配视图
      if (!hasAutoFitted.value) {
        hasAutoFitted.value = true;
        fitToView();
      }
    });
}

function fitToView(padding = 40) {
  if (nodes.value.length === 0) return;
  // 过滤掉坐标为 NaN 的节点，防止 NaN 经 Math.min/max 传播导致 transform 损坏
  const validNodes = nodes.value.filter(n => !isNaN(n.x) && !isNaN(n.y));
  if (validNodes.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of validNodes) {
    const rx = n.width / 2 + padding;
    const ry = n.height / 2 + padding;
    minX = Math.min(minX, n.x - rx);
    minY = Math.min(minY, n.y - ry);
    maxX = Math.max(maxX, n.x + rx);
    maxY = Math.max(maxY, n.y + ry);
  }
  const graphW = Math.max(1, maxX - minX);
  const graphH = Math.max(1, maxY - minY);
  const k = Math.min(viewSize.value.width / graphW, viewSize.value.height / graphH, 1.5);
  const x = (viewSize.value.width - (minX + maxX) * k) / 2;
  const y = (viewSize.value.height - (minY + maxY) * k) / 2;
  transform.value = { x, y, k };
}

function redraw() {
  updateViewSize();
  buildGraphData();
  initSimulation();
  nextTick(refreshElCache);
}

function localPoint(evt) {
  const rect = svg.value.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

function toWorld(p) {
  return {
    x: (p.x - transform.value.x) / transform.value.k,
    y: (p.y - transform.value.y) / transform.value.k
  };
}

function hitNode(p) {
  const wp = toWorld(p);
  for (const n of nodes.value) {
    // 圆形节点使用半径距离检测，矩形节点使用 AABB 检测，使命中区域与视觉形状一致
    if (n.shape === 'circle' || n.type === 'idea') {
      const r = (n.radius || Math.max(n.width, n.height) / 2) + 2;
      const dx = wp.x - n.x;
      const dy = wp.y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    } else {
      const halfW = n.width / 2 + 2;
      const halfH = n.height / 2 + 2;
      if (wp.x >= n.x - halfW && wp.x <= n.x + halfW && wp.y >= n.y - halfH && wp.y <= n.y + halfH) {
        return n;
      }
    }
  }
  return null;
}

function onWheel(e) {
  // preventDefault 由模板 @wheel.prevent 修饰符处理
  const p = localPoint(e);
  const delta = -e.deltaY * 0.001;
  const newK = Math.min(4, Math.max(0.3, transform.value.k * Math.exp(delta)));
  transform.value.x = p.x - (p.x - transform.value.x) * (newK / transform.value.k);
  transform.value.y = p.y - (p.y - transform.value.y) * (newK / transform.value.k);
  transform.value.k = newK;
}

function onBackgroundPointerDown(e) {
  if (e.button !== 0) return;
  isPanning.value = true;
  panMoved.value = false;
  panStart.value = { x: e.clientX, y: e.clientY, tx: transform.value.x, ty: transform.value.y };
  svg.value?.setPointerCapture?.(e.pointerId);
}

function onBackgroundClick(e) {
  if (panMoved.value) return;
  // 点击背景关闭跳转确认浮窗
  if (jumpConfirm.value.show) {
    cancelJump();
    return;
  }
  const p = localPoint(e);
  if (!hitNode(p)) {
    graphStore.selectNode(null);
  }
}

function onNodePointerDown(n, e) {
  // 仅响应左键（含触摸/笔），右键和中键不应触发拖拽
  if (e.button !== 0) return;
  e.stopPropagation();
  dragNode.value = n;
  dragNodeEl.value = e.currentTarget;
  nodeDragMoved.value = false;
  nodeDragStart.value = localPoint(e);
  if (simulation) simulation.alphaTarget(0.35).restart();
  dragNodeEl.value?.setPointerCapture?.(e.pointerId);
  // dragging class 由 Vue :class 绑定响应式管理（dragNode?.id === node.id）
}

function onPointerMove(e) {
  const p = localPoint(e);

  if (dragNode.value) {
    const moved = Math.hypot(p.x - nodeDragStart.value.x, p.y - nodeDragStart.value.y);
    if (moved > 3) nodeDragMoved.value = true;
    const wp = toWorld(p);
    dragNode.value.x = wp.x;
    dragNode.value.y = wp.y;
    // 无需手动 restart：onNodePointerDown 中已设置 alphaTarget(0.35)，
    // 模拟会持续运行直到 onPointerUp 中 alphaTarget(0) 停止。
  } else if (isPanning.value) {
    const dx = e.clientX - panStart.value.x;
    const dy = e.clientY - panStart.value.y;
    if (Math.hypot(dx, dy) > 3) panMoved.value = true;
    transform.value.x = panStart.value.tx + dx;
    transform.value.y = panStart.value.ty + dy;
  }

  // 拖拽节点或平移画布时跳过 tooltip 更新，避免 tooltip 不断闪烁
  if (dragNode.value || isPanning.value) {
    tooltip.value.show = false;
    return;
  }

  const hit = hitNode(p);
  if (hit) {
    tooltip.value = {
      show: true,
      x: e.clientX + 12,
      y: e.clientY + 12,
      text: `${hit.labelText} (${hit.type})`
    };
  } else {
    tooltip.value.show = false;
  }
}

function onPointerUp(e) {
  if (dragNode.value) {
    if (simulation) simulation.alphaTarget(0);
    dragNode.value = null;
  }
  if (dragNodeEl.value) {
    dragNodeEl.value?.releasePointerCapture?.(e.pointerId);
    dragNodeEl.value = null;
  } else {
    svg.value?.releasePointerCapture?.(e.pointerId);
  }
  isPanning.value = false;
  // 延迟重置 nodeDragMoved：click 事件在 pointerup 之后触发，
  // 若立即重置会导致 click 中无法判断是否发生过拖拽；
  // 但必须在下一个 pointerdown 之前重置（onNodePointerDown 中也会重置）。
  // 使用 setTimeout(0) 确保 click 事件先读取旧值，再清空。
  setTimeout(() => { nodeDragMoved.value = false; }, 0);
}

function expandNode(id) {
  if (expandedIds.value.has(id)) return;
  const next = new Set(expandedIds.value);
  next.add(id);
  expandedIds.value = next;
  redraw();
}

// 收起节点：移除自身、所有后代，以及因该节点展开而显示出来的邻居
function collapseNode(id) {
  if (!expandedIds.value.has(id)) return;
  const next = new Set(expandedIds.value);
  const rawEdges = graphStore.edges || [];
  const childMap = new Map();
  const neighborMap = new Map();
  for (const e of rawEdges) {
    if (e.type === 'contains' || e.type === 'hierarchy' || e.type === 'idea-hierarchy') {
      if (!childMap.has(e.from)) childMap.set(e.from, []);
      childMap.get(e.from).push(e.to);
    }
    // 所有边都视为邻居关系
    if (!neighborMap.has(e.from)) neighborMap.set(e.from, []);
    if (!neighborMap.has(e.to)) neighborMap.set(e.to, []);
    neighborMap.get(e.from).push(e.to);
    neighborMap.get(e.to).push(e.from);
  }

  // 收集所有后代（沿 contains/hierarchy 边）
  const toRemove = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift();
    const children = childMap.get(cur) || [];
    for (const cid of children) {
      if (!toRemove.has(cid)) {
        toRemove.add(cid);
        queue.push(cid);
      }
    }
  }

  // 收集因该节点展开而显示的邻居（实体/概念/问题等叶子节点）
  // 这些邻居如果没有被其他仍展开的节点覆盖，应当一起收起
  const collapsedSet = new Set(toRemove);
  const stillExpanded = new Set([...next].filter(x => !collapsedSet.has(x)));
  const neighbors = neighborMap.get(id) || [];
  for (const nid of neighbors) {
    // 仅移除非 document/heading 的叶子节点；保留文档/标题结构节点
    const n = graphStore.nodes.find(x => x.id === nid);
    if (!n || n.type === 'document' || n.type === 'heading') continue;
    // 如果该节点也被其他仍展开的节点连接，则保留
    const otherNeighbors = neighborMap.get(nid) || [];
    const covered = otherNeighbors.some(oid => stillExpanded.has(oid) && oid !== id);
    if (!covered) {
      toRemove.add(nid);
    }
  }

  for (const rid of toRemove) next.delete(rid);
  expandedIds.value = next;
  redraw();
}

// 切换展开/收起（document/heading 节点用）
function toggleNode(id) {
  if (expandedIds.value.has(id)) collapseNode(id);
  else expandNode(id);
}

function collapseAll() {
  expandedIds.value = new Set();
  treeExpandedHierarchyIds.value = new Set();
  treeExpandedLinksIds.value = new Set();
  graphStore.selectNode(null);
  redraw();
}

function expandAll() {
  const rawNodes = graphStore.nodes || [];
  // ★ 必须用 [...rawNodes] 创建副本再排序，否则原地 sort 会触发 deep watch 重置 expandedIds
  const sorted = [...rawNodes]
    .sort((a, b) => {
      const pa = a.meta?.pagerank || a.pagerank || a.weight || 0;
      const pb = b.meta?.pagerank || b.pagerank || b.weight || 0;
      return pb - pa;
    })
    .slice(0, MAX_NODES);
  const allIds = new Set(sorted.map(n => n.id));
  expandedIds.value = allIds;
  treeExpandedHierarchyIds.value = new Set(allIds);
  treeExpandedLinksIds.value = new Set(allIds);
  redraw();
}

function expandSelectedNeighbors() {
  const id = selectedId.value;
  if (!id) return;
  expandNode(id);
}

let clickTimer = null;

function onNodeContextMenu(n, event) {
  event.preventDefault();
  event.stopPropagation();
  // 使用 fixed 定位，坐标直接取自视口（clientX/clientY），不受父容器 overflow 裁剪
  // 边界检测：确保菜单不超出视口
  const menuWidth = 200;
  const menuHeight = 300;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
  contextMenu.value = {
    show: true,
    x,
    y,
    nodeId: n.id
  };
}

function closeContextMenu() {
  contextMenu.value.show = false;
}

function resetNodeForm(parentId = '') {
  nodeForm.value = {
    content: '',
    type: 'manual',
    docId: '',
    page: null,
    start: null,
    shape: '', // 空表示使用默认形状
    size: null, // null 表示使用默认尺寸
    color: '',
    parentId: parentId || ''
  };
}

function openCreateNodeDialog(parentId = '') {
  closeContextMenu();
  resetNodeForm(parentId);
  nodeDialog.value = { show: true, mode: 'create', nodeId: null, parentId: parentId || null };
}

function openAddChildNodeDialog() {
  openCreateNodeDialog(contextMenu.value.nodeId);
}

function openEditNodeDialog() {
  const node = graphStore.nodes.find(n => n.id === contextMenu.value.nodeId);
  if (!node) return;
  closeContextMenu();
  nodeForm.value = {
    content: node.content || '',
    type: node.type || 'manual',
    docId: node.source?.docId || '',
    page: node.source?.page || null,
    start: node.source?.start || null,
    shape: node.meta?.shape || '',
    size: node.meta?.size !== undefined ? node.meta.size : null,
    color: node.meta?.color || '',
    parentId: ''
  };
  nodeDialog.value = { show: true, mode: 'edit', nodeId: node.id, parentId: null };
}

function onTreeContextMenu(item, event) {
  // 使用 fixed 定位，坐标直接取自视口（clientX/clientY），不受父容器 overflow 裁剪
  // 边界检测：确保菜单不超出视口
  const menuWidth = 200;
  const menuHeight = 300;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
  contextMenu.value = {
    show: true,
    x,
    y,
    nodeId: item.id
  };
}

async function saveNode() {
  const meta = { updatedBy: 'manual' };
  if (nodeForm.value.shape) meta.shape = nodeForm.value.shape;
  if (nodeForm.value.size !== null && nodeForm.value.size !== undefined && nodeForm.value.size !== '' && Number(nodeForm.value.size) >= 32) {
    meta.size = Number(nodeForm.value.size);
  }
  if (nodeForm.value.color) meta.color = nodeForm.value.color;

  const payload = {
    content: nodeForm.value.content,
    type: nodeForm.value.type || 'manual',
    source: {},
    meta
  };
  if (nodeForm.value.docId) {
    payload.source.docId = nodeForm.value.docId;
    if (nodeForm.value.page) payload.source.page = Number(nodeForm.value.page);
    if (nodeForm.value.start !== null && nodeForm.value.start !== '') {
      payload.source.start = Number(nodeForm.value.start);
    }
  }

  try {
    if (nodeDialog.value.mode === 'create') {
      const node = await graphStore.addNode(payload);
      // 如果指定了父节点，自动建立 hierarchy 边
      const parentId = nodeForm.value.parentId || nodeDialog.value.parentId;
      if (parentId) {
        await graphStore.addEdge({ from: parentId, to: node.id, type: 'hierarchy', weight: 1 });
      }
      toast.success('节点已创建');
    } else {
      await graphStore.updateNode(nodeDialog.value.nodeId, payload);
      toast.success('节点已更新');
    }
    nodeDialog.value.show = false;
    // 无需手动 redraw()：store 数据变化会触发 watch 自动重绘
  } catch (e) {
    toast.error(e.message || '保存失败');
  }
}

async function deleteNodeFromContextMenu() {
  const id = contextMenu.value.nodeId;
  closeContextMenu();
  if (!id) return;
  const node = graphStore.nodes.find(n => n.id === id);
  const ok = await dialog.confirm('删除确认', `确定要删除节点"${node?.content || id}"吗？`, { danger: true });
  if (!ok) return;
  try {
    await graphStore.removeNode(id);
    toast.success('节点已删除');
    // 无需手动 redraw()：store 数据变化会触发 watch 自动重绘
  } catch (e) {
    toast.error(e.message || '删除失败');
  }
}

function openAddEdgeDialog() {
  const sourceId = contextMenu.value.nodeId;
  closeContextMenu();
  if (!sourceId) return;
  edgeForm.value = { targetId: '', type: 'related', weight: 0.8 };
  edgeDialog.value = { show: true, sourceId };
}

async function saveEdge() {
  const sourceId = edgeDialog.value.sourceId;
  const { targetId, type, weight } = edgeForm.value;
  if (!sourceId || !targetId) {
    toast.warning('请选择目标节点');
    return;
  }
  if (sourceId === targetId) {
    toast.warning('不能连接节点自身');
    return;
  }
  // 避免重复添加完全相同的关系
  const exists = graphStore.edges.some(e => e.from === sourceId && e.to === targetId && e.type === type);
  if (exists) {
    toast.warning('该关系已存在');
    return;
  }
  try {
    await graphStore.addEdge({ from: sourceId, to: targetId, type, weight: Number(weight) || 0.8 });
    edgeDialog.value.show = false;
    toast.success('连线已添加');
    // 无需手动 redraw()：store 数据变化会触发 watch 自动重绘
  } catch (e) {
    toast.error(e.message || '添加连线失败');
  }
}

function openDeleteEdgeDialog() {
  const nodeId = contextMenu.value.nodeId;
  closeContextMenu();
  if (!nodeId) return;
  edgeDeleteDialog.value = { show: true, nodeId };
}

/** 删除连线弹窗中当前节点的关联边列表（computed 缓存，避免模板中重复调用） */
const edgesForDeletion = computed(() => {
  const nodeId = edgeDeleteDialog.value.nodeId;
  if (!nodeId) return [];
  const related = [];
  for (const e of graphStore.edges) {
    if (e.from === nodeId) {
      const target = graphStore.nodes.find(n => n.id === e.to);
      related.push({ ...e, display: `→ ${target?.content || e.to} [${e.type}, ${(e.weight || 0).toFixed(1)}]` });
    } else if (e.to === nodeId) {
      const source = graphStore.nodes.find(n => n.id === e.from);
      related.push({ ...e, display: `← ${source?.content || e.from} [${e.type}, ${(e.weight || 0).toFixed(1)}]` });
    }
  }
  return related;
});

async function deleteEdge(edge) {
  const ok = await dialog.confirm('删除确认', `确定删除连线"${edge.display}"吗？`, { danger: true });
  if (!ok) return;
  try {
    await graphStore.removeEdge(edge.from, edge.to, edge.type);
    toast.success('连线已删除');
    // 无需手动 redraw()：store 数据变化会触发 watch 自动重绘
  } catch (e) {
    toast.error(e.message || '删除连线失败');
  }
}

/** 切换连线模式 */
function toggleLinkMode() {
  linkMode.value = !linkMode.value;
  linkSourceId.value = null;
  if (linkMode.value) {
    toast.info('连线模式：依次点击两个节点创建连线');
  }
}

function onNodeClick(n) {
  if (nodeDragMoved.value) return;

  // 连线模式：点击节点直接创建连线，不走展开/收起逻辑
  if (linkMode.value) {
    if (!linkSourceId.value) {
      // 第一次点击：选中源节点
      linkSourceId.value = n.id;
      toast.info(`已选中源节点，请点击目标节点`);
    } else if (linkSourceId.value === n.id) {
      // 点击同一个节点：取消选择
      linkSourceId.value = null;
      toast.info('已取消选择');
    } else {
      // 第二次点击：创建连线
      const sourceId = linkSourceId.value;
      const exists = graphStore.edges.some(e => e.from === sourceId && e.to === n.id);
      if (!exists) {
        graphStore.addEdge({ from: sourceId, to: n.id, type: 'related', weight: 0.8 })
          .then(() => toast.success('连线已添加'))
          .catch(err => toast.error(err.message || '添加连线失败'));
      } else {
        toast.warning('该连线已存在');
      }
      linkSourceId.value = null;
      linkMode.value = false;
      // 标记刚完成连线操作，抑制紧随其后的 dblclick 弹出跳转浮窗
      justCompletedLinkAction = true;
      setTimeout(() => { justCompletedLinkAction = false; }, 350);
    }
    return;
  }

  // 双击延迟检测：避免 dblclick 前的两次 click 导致 document/heading 抖动（expand→collapse）
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    return;
  }
  clickTimer = setTimeout(() => {
    clickTimer = null;
    graphStore.selectNode(n.id);
    // 单击行为：document/heading 切换展开/收起；entity/idea 仅选中（跳转走双击确认）
    if (n.type === 'document' || n.type === 'heading') {
      toggleNode(n.id);
    }
  }, 220);
}

/**
 * 双击节点：弹出跳转确认浮窗（定位在节点右侧，空间不足时左侧）
 * 各级节点都可双击跳转
 */
function onNodeDblClick(n, event) {
  if (nodeDragMoved.value) return;
  // 连线模式刚完成操作时抑制双击跳转浮窗，避免交互冲突
  if (justCompletedLinkAction) return;
  // Idea 节点双击：展开/收起子级和关联节点，不弹跳转窗
  if (n.type === 'idea') {
    expandNode(n.id);
    return;
  }
  // 计算节点中心在视口中的屏幕坐标
  const svgEl = svg.value;
  if (!svgEl) return;
  const rect = svgEl.getBoundingClientRect();
  const screenX = rect.left + transform.value.x + n.x * transform.value.k;
  const screenY = rect.top + transform.value.y + n.y * transform.value.k;
  const nodeHalfW = (n.width || 100) / 2 * transform.value.k;
  // 浮窗定位在节点右侧（节点右边缘 + 12px），右侧空间不足时定位在左侧
  const POPUP_WIDTH = 160;
  const containerRect = container.value ? container.value.getBoundingClientRect() : rect;
  const rightSpace = containerRect.right - (screenX + nodeHalfW);
  let popupX, popupY;
  if (rightSpace >= POPUP_WIDTH + 16) {
    popupX = screenX + nodeHalfW + 12;
  } else {
    popupX = screenX - nodeHalfW - POPUP_WIDTH - 12;
  }
  popupY = screenY - 20; // 略微上移，让浮窗中心对齐节点
  // 转为相对于 container 的坐标
  const localX = popupX - containerRect.left;
  const rawLocalY = popupY - containerRect.top;
  // 垂直方向边界保护：避免浮窗被 overflow:hidden 裁剪
  // 先用估算高度定位，渲染后用浮窗实际高度修正（M-9）
  const POPUP_HEIGHT_ESTIMATE = 70;
  const clampY = (h) => Math.max(8, Math.min(containerRect.height - h - 8, rawLocalY));
  const localY = clampY(POPUP_HEIGHT_ESTIMATE);
  jumpConfirm.value = { show: true, nodeId: n.id, x: localX, y: localY };
  // 浮窗渲染后测量实际高度，按真实高度重新修正垂直定位，避免被裁剪
  nextTick(() => {
    const el = jumpConfirmEl.value;
    // 仅当浮窗仍指向当前节点时才修正，避免快速连续双击导致错位
    if (!el || jumpConfirm.value.nodeId !== n.id) return;
    const actualHeight = el.offsetHeight;
    const clampedY = clampY(actualHeight);
    if (clampedY !== jumpConfirm.value.y) {
      jumpConfirm.value = { ...jumpConfirm.value, y: clampedY };
    }
  });
}

/**
 * 确认跳转：执行跳转逻辑（idea 跳 idea 面板，其他跳 PDF 对应页）
 */
function confirmJump() {
  const nodeId = jumpConfirm.value.nodeId;
  jumpConfirm.value = { show: false, nodeId: null, x: 0, y: 0 };
  if (!nodeId) return;
  const n = (graphStore.nodes || []).find(x => x.id === nodeId);
  if (!n) return;
  graphStore.selectNode(n.id);
  if (n.type === 'idea' && n.source?.ideaId) {
    ideaStore.setActive(n.source.ideaId);
    uiStore.setRightTab('idea');
  } else if (n.source?.docId) {
    // 优先使用 keyword（原始实体词，source.start 基于它计算），
    // 其次 content/label（可能是短语标签，在原文中不一定精确匹配）
    const keyword = n.meta?.keyword || n.keyword || n.content || n.label || n.id;
    // 优先用 source.page，回退到 meta.page，再回退到 meta.pages[0]
    const rawPage = n.source.page ?? n.meta?.page ?? (Array.isArray(n.meta?.pages) && n.meta.pages.length > 0 ? n.meta.pages[0] : 0);
    const page = rawPage && rawPage > 1 ? rawPage : 0;
    const start = n.source?.start ?? n.meta?.start ?? 0;
    docStore.setActive(n.source.docId, { page, keyword, start });
    ideaStore.setActive(null);
    if (!uiStore.leftPanelVisible) uiStore.toggleLeftPanel();
    uiStore.setRightTab('graph');
  }
}

/**
 * 取消跳转：关闭浮窗
 */
function cancelJump() {
  jumpConfirm.value = { show: false, nodeId: null, x: 0, y: 0 };
}

/**
 * 将指定节点移到图谱视图中心并高亮
 */
function focusNode(id) {
  const n = nodes.value.find(x => x.id === id);
  if (!n) return;
  graphStore.selectNode(id);
  const k = transform.value.k || 1;
  transform.value.x = viewSize.value.width / 2 - n.x * k;
  transform.value.y = viewSize.value.height / 2 - n.y * k;
}

function isTreeHierarchyExpanded(id) {
  return treeExpandedHierarchyIds.value.has(id);
}

function isTreeLinksExpanded(id) {
  return treeExpandedLinksIds.value.has(id);
}

function syncGraphExpandFromTree(item) {
  const hasAnyExpanded = isTreeHierarchyExpanded(item.id) || isTreeLinksExpanded(item.id);
  const isGraphExpanded = expandedIds.value.has(item.id);
  if (hasAnyExpanded && !isGraphExpanded) {
    expandNode(item.id);
  } else if (!hasAnyExpanded && isGraphExpanded) {
    collapseNode(item.id);
  }
}

function toggleTreeHierarchy(item) {
  const next = new Set(treeExpandedHierarchyIds.value);
  if (next.has(item.id)) {
    next.delete(item.id);
  } else {
    next.add(item.id);
  }
  treeExpandedHierarchyIds.value = next;
  syncGraphExpandFromTree(item);
}

function toggleTreeLinks(item) {
  const next = new Set(treeExpandedLinksIds.value);
  if (next.has(item.id)) {
    next.delete(item.id);
  } else {
    next.add(item.id);
  }
  treeExpandedLinksIds.value = next;
  syncGraphExpandFromTree(item);
}

function onTreeItemClick(item) {
  graphStore.selectNode(item.id);
  const hasChildren = (item.hierarchyChildren?.length || 0) + (item.linkChildren?.length || 0) > 0;
  if (!nodes.value.some(n => n.id === item.id) && hasChildren) {
    expandNode(item.id);
  }
  focusNode(item.id);
}

/** 切换 Idea 是否在图谱中显示 */
async function toggleIdeaVisibility(item) {
  // 防止异步切换期间重复点击（L-3）
  if (ideaToggling.value) return;
  const newVisible = item.includeInGraph === false; // toggle
  ideaToggling.value = true;
  try {
    await ideaStore.updateIdea(item.id, { includeInGraph: newVisible });
    await graphStore.loadGraph();
  } catch (e) {
    toast.error('切换显示失败');
  } finally {
    ideaToggling.value = false;
  }
}

function openAddIdeaDialog() {
  addIdeaDialog.value = { show: true, title: '', content: '' };
}

function closeAddIdeaDialog() {
  addIdeaDialog.value.show = false;
  addIdeaDialog.value.title = '';
  addIdeaDialog.value.content = '';
}

async function submitAddIdea() {
  const title = addIdeaDialog.value.title.trim();
  const content = addIdeaDialog.value.content.trim();
  if (!title && !content) return;
  try {
    await ideaStore.addIdea({
      title: title || '未命名 Idea',
      content,
      includeInGraph: true
    });
    closeAddIdeaDialog();
    await graphStore.loadGraph();
  } catch (e) {
    toast.error('添加节点失败');
  }
}

function onTreeItemDblClick(item) {
  const n = (graphStore.nodes || []).find(x => x.id === item.id);
  if (!n) return;
  // Idea 节点双击：展开/收起子级和关联，不跳转
  if (item.type === 'idea') {
    toggleTreeHierarchy(item);
    toggleTreeLinks(item);
    return;
  }
  // 直接跳转，不弹确认窗
  graphStore.selectNode(n.id);
  if (n.source?.docId) {
    // 优先使用 keyword（原始实体词，source.start 基于它计算）
    const keyword = n.meta?.keyword || n.keyword || n.content || n.label || n.id;
    const rawPage = n.source.page ?? n.meta?.page ?? (Array.isArray(n.meta?.pages) && n.meta.pages.length > 0 ? n.meta.pages[0] : 0);
    const page = rawPage && rawPage > 1 ? rawPage : 0;
    const start = n.source?.start ?? n.meta?.start ?? 0;
    docStore.setActive(n.source.docId, { page, keyword, start });
    ideaStore.setActive(null);
    if (!uiStore.leftPanelVisible) uiStore.toggleLeftPanel();
    uiStore.setRightTab('graph');
  }
}

// 初始化资源（D3 模拟、ResizeObserver、window 事件监听）
// 幂等：多次调用不会重复创建资源，适配 KeepAlive 下 onMounted + onActivated 连续触发的场景
function initResources() {
  // 守卫：已初始化则直接返回，避免 onMounted + onActivated 双重触发导致重复创建
  if (resourcesInitialized) return;
  resourcesInitialized = true;

  // 缓存节点颜色 CSS 变量，避免每次渲染都调用 getComputedStyle
  refreshNodeColors();
  updateViewSize();
  buildGraphData();
  initSimulation();
  nextTick(refreshElCache);

  // ResizeObserver：仅在尚未创建时新建，避免重复创建导致泄漏
  if (!resizeObserver && window.ResizeObserver && mainEl.value) {
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        updateViewSize();
        if (simulation) {
          simulation.force('center', forceCenter(viewSize.value.width / 2, viewSize.value.height / 2));
          simulation.alpha(0.3).restart();
        }
      }, 150);
    });
    resizeObserver.observe(mainEl.value);
  }

  // Esc 键关闭跳转确认浮窗
  window.addEventListener('keydown', onKeyDown);

  // 响应顶部菜单的图谱操作
  window.addEventListener('app:export-graph', onExportGraphFromMenu);
  window.addEventListener('app:zoom-graph', onZoomGraphFromMenu);
  window.addEventListener('app:fit-graph', onFitGraphFromMenu);
}

// 清理资源（停止 D3 模拟、断开 ResizeObserver、移除 window 事件监听）
function cleanupResources() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  // 不清除 prevPositions：保留节点位置缓存，切回 Tab 时可平滑恢复布局，
  // 仅在 buildGraphData 中按需清理已不存在的节点位置。
  nodeElCache = null;
  linkElCache = null;
  if (simulation) {
    simulation.on('tick', null).on('end', null);
    simulation.stop();
    simulation = null;
  }
  if (resizeTimer) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('app:export-graph', onExportGraphFromMenu);
  window.removeEventListener('app:zoom-graph', onZoomGraphFromMenu);
  window.removeEventListener('app:fit-graph', onFitGraphFromMenu);
  // 重置守卫标志，允许下次切入 Tab 时重新初始化
  resourcesInitialized = false;
}

onMounted(() => {
  initResources();
});

// KeepAlive 缓存：切入 Tab 时重新初始化资源
onActivated(() => {
  initResources();
});

// KeepAlive 缓存：切出 Tab 时清理资源，避免 D3 模拟后台空转、事件监听器泄漏
onDeactivated(() => {
  cleanupResources();
});

onUnmounted(() => {
  cleanupResources();
});

function onExportGraphFromMenu() {
  showExportMenu.value = true;
}

function onZoomGraphFromMenu(e) {
  const scale = e.detail;
  if (!scale || !svg.value) return;
  const rect = svg.value.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const newK = Math.min(4, Math.max(0.3, transform.value.k * scale));
  transform.value.x = cx - (cx - transform.value.x) * (newK / transform.value.k);
  transform.value.y = cy - (cy - transform.value.y) * (newK / transform.value.k);
  transform.value.k = newK;
}

function onFitGraphFromMenu() {
  fitToView();
}

function onKeyDown(e) {
  if (e.key !== 'Escape') return;
  // 优先处理双击跳转确认浮窗
  if (jumpConfirm.value.show) {
    cancelJump();
    return;
  }
  // 各模态框支持 ESC 关闭
  if (nodeDialog.value.show) {
    nodeDialog.value.show = false;
    return;
  }
  if (edgeDialog.value.show) {
    edgeDialog.value.show = false;
    return;
  }
  if (edgeDeleteDialog.value.show) {
    edgeDeleteDialog.value.show = false;
    return;
  }
  if (addIdeaDialog.value.show) {
    closeAddIdeaDialog();
    return;
  }
  if (contextMenu.value.show) {
    contextMenu.value.show = false;
    return;
  }
  if (showExportMenu.value) {
    showExportMenu.value = false;
    return;
  }
}

/* === 图谱导出 === */

/**
 * 克隆 SVG 并设置显式尺寸，确保导出为图片时能正确渲染。
 * 原始 SVG 使用 CSS width:100%，序列化后缺少 width/height/viewBox 属性，
 * 导致浏览器加载为 Image 时无法确定渲染尺寸，PNG 导出可能空白。
 */
function cloneSvgForExport(svgEl) {
  const clone = svgEl.cloneNode(true);
  const rect = svgEl.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // 设置背景色，避免 PNG/SVG 导出后背景透明
  clone.style.backgroundColor = getCssVar('--graph-export-bg', '#ffffff');
  return { clone, w, h };
}

function exportAsPNG() {
  showExportMenu.value = false;
  const svgEl = svg.value;
  if (!svgEl) return;
  const { clone, w, h } = cloneSvgForExport(svgEl);
  const svgData = new XMLSerializer().serializeToString(clone);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  img.onload = () => {
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.scale(2, 2);
    ctx.fillStyle = getCssVar('--graph-export-bg', '#ffffff');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      const pngUrl = URL.createObjectURL(blob);
      a.href = pngUrl;
      a.download = `知源-知识图谱-${new Date().toISOString().slice(0,10)}.png`;
      a.click();
      a.remove();
      // 延迟释放 blob URL，确保下载已触发
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast.error('导出 PNG 失败：无法加载 SVG 图像，请重试。');
  };
  img.src = url;
}

function exportAsSVG() {
  showExportMenu.value = false;
  const svgEl = svg.value;
  if (!svgEl) return;
  try {
    const { clone } = cloneSvgForExport(svgEl);
    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    const svgUrl = URL.createObjectURL(blob);
    a.href = svgUrl;
    a.download = `知源-知识图谱-${new Date().toISOString().slice(0,10)}.svg`;
    a.click();
    a.remove();
    // 延迟释放 blob URL，确保下载已触发
    setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
  } catch (e) {
    console.error('导出 SVG 失败:', e);
    toast.error('导出 SVG 失败，请重试');
  }
}

function exportAsJSON() {
  showExportMenu.value = false;
  try {
    const data = {
      nodes: graphStore.nodes,
      edges: graphStore.edges,
      exportedAt: new Date().toISOString(),
      version: '2.1.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const jsonUrl = URL.createObjectURL(blob);
    a.href = jsonUrl;
    a.download = `知源-知识图谱-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    a.remove();
    // 延迟释放 blob URL，确保下载已触发
    setTimeout(() => URL.revokeObjectURL(jsonUrl), 1000);
  } catch (e) {
    console.error('导出 JSON 失败:', e);
    toast.error('导出 JSON 失败，请重试');
  }
}

let prevDocIds = new Set();

// 项目切换时清理文档颜色缓存和节点位置缓存，避免 Map 持续增长导致内存泄漏
watch(() => projectStore.currentProjectId, () => {
  docColorMap.clear();
  prevPositions.clear();
});

watch([() => graphStore.nodes, () => graphStore.edges], () => {
  // 仅在文档集合实际变化时重置展开状态，避免每次节点更新都重置
  // 注意：不使用 deep:true，避免 expandAll 中 sort 等操作触发意外重置
  const docNodes = (graphStore.nodes || []).filter(n => n.type === 'document');
  const currentDocIds = new Set(docNodes.map(n => n.id));
  const docSetChanged = currentDocIds.size !== prevDocIds.size ||
    [...currentDocIds].some(id => !prevDocIds.has(id));
  if (docSetChanged) {
    // 自动展开单文档场景，让用户直接看到提取出的知识点；多文档保持收起避免混乱
    if (docNodes.length === 1) {
      expandedIds.value = new Set(docNodes.map(n => n.id));
    } else {
      expandedIds.value = new Set();
    }
    treeExpandedHierarchyIds.value = new Set();
    treeExpandedLinksIds.value = new Set();
    hasAutoFitted.value = false;
  }
  prevDocIds = currentDocIds;
  redraw();
}, { deep: false });
</script>

<template>
  <div ref="container" class="graph-view" :class="{ 'wide-layout': isWideLayout }">
    <div ref="mainEl" class="graph-main">
      <div class="graph-header">
      <span role="status" aria-live="polite">节点: {{ nodes.length }} / {{ graphStore.nodeCount }} | 边: {{ links.length }} / {{ graphStore.edgeCount }} | 跨文档连线: {{ crossLinkCount }}</span>
      <div class="graph-actions">
        <button class="graph-tool" title="手动添加节点" aria-label="添加节点" :disabled="graphStore.building" @click="openCreateNodeDialog">+ 添加节点</button>
        <button class="graph-tool" :class="{ active: linkMode }" :title="linkMode ? '连线模式中：点击两个节点创建连线（再次点击退出）' : '点击两个节点创建连线'" aria-label="添加连线" @click="toggleLinkMode">{{ linkMode ? '取消连线' : '连线' }}</button>
        <button class="graph-tool" title="收起为仅文件节点" aria-label="收起全部节点" @click="collapseAll">收起全部</button>
        <button class="graph-tool" title="适配视图" aria-label="适配视图" @click="fitToView">适配视图</button>
        <div class="graph-export-menu">
          <button class="graph-tool" aria-label="导出图谱" :disabled="graphStore.nodes.length === 0" @click="showExportMenu = !showExportMenu">导出</button>
          <div v-if="showExportMenu" class="export-dropdown-backdrop" @click="showExportMenu = false"></div>
          <div v-if="showExportMenu" class="export-dropdown">
            <button aria-label="导出为 PNG 图片" @click="exportAsPNG">导出为 PNG</button>
            <button aria-label="导出为 SVG 矢量图" @click="exportAsSVG">导出为 SVG</button>
            <button aria-label="导出为 JSON 数据" @click="exportAsJSON">导出为 JSON</button>
          </div>
        </div>
        <span class="hint">{{ linkMode ? (linkSourceId ? '🔗 点击目标节点完成连线（点击源节点取消）' : '🔗 点击源节点开始连线') : '单击展开 / 双击跳转 / 滚轮缩放 / 拖拽平移 / 右键节点查看更多操作' }}</span>
      </div>
    </div>

    <div v-if="graphStore.building" class="graph-loading" role="status" aria-live="polite">
      <div class="progress-bar" role="progressbar" :aria-valuenow="graphStore.buildProgress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="graphStore.buildProgress.log || '图谱构建中'">
        <div class="progress-fill" :style="{ width: graphStore.buildProgress.percent + '%' }" />
      </div>
      <div class="progress-text">
        {{ graphStore.buildProgress.log }}
        <span v-if="graphStore.buildProgress.chunkCount > 0" class="progress-chunks">
          （{{ graphStore.buildProgress.chunkIndex }}/{{ graphStore.buildProgress.chunkCount }} 块）
        </span>
      </div>
    </div>

    <svg
      ref="svg"
      class="graph-svg"
      role="img"
      :aria-label="`知识图谱可视化：${nodes.length} 个节点，${links.length} 条边。单击展开节点，双击跳转文档，滚轮缩放，拖拽平移。`"
      @wheel.prevent="onWheel"
      @pointerdown="onBackgroundPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @click="onBackgroundClick"
    >
      <defs>
        <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.12)" />
        </filter>
        <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feFlood flood-color="#fbbf24" flood-opacity="0.75" result="glowColor" />
          <feComposite in="glowColor" in2="coloredBlur" operator="in" result="softGlow" />
          <feMerge>
            <feMergeNode in="softGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g :transform="`translate(${transform.x}, ${transform.y}) scale(${transform.k})`">
        <!-- 边 -->
        <g class="edges">
          <path
            v-for="edge in links"
            :key="edge.key"
            class="graph-link"
            :data-from="edge.source.id"
            :data-to="edge.target.id"
            :data-edge-type="edge.type"
            :data-aggregated="edge.aggregated ? 'true' : null"
            :d="edgePath(edge)"
            fill="none"
            :stroke="edgeColor(edge)"
            :stroke-width="edgeWidth(edge)"
            :stroke-dasharray="edgeDashArray(edge)"
            :opacity="edgeOpacity(edge)"
            stroke-linecap="round"
          />
        </g>

        <!-- 节点 -->
        <g class="nodes">
          <g
            v-for="node in nodes"
            :key="node.id"
            class="node"
            :class="{ dragging: dragNode?.id === node.id, 'link-source': linkSourceId === node.id }"
            :data-node-id="node.id"
            :transform="`translate(${node.x}, ${node.y})`"
            :opacity="nodeOpacity(node)"
            @pointerdown.stop="onNodePointerDown(node, $event)"
            @click.stop="onNodeClick(node)"
            @dblclick.stop="onNodeDblClick(node, $event)"
            @contextmenu.stop.prevent="onNodeContextMenu(node, $event)"
          >
            <circle
              v-if="node.shape === 'circle' || node.type === 'idea'"
              :r="node.radius || Math.max(node.width, node.height) / 2"
              :fill="getNodeFill(node)"
              :stroke="getNodeStroke(node)"
              :stroke-width="nodeStrokeWidth(node)"
              :filter="nodeFilter(node)"
            />
            <rect
              v-else-if="node.shape === 'rect'"
              :x="-node.width / 2"
              :y="-node.height / 2"
              :width="node.width"
              :height="node.height"
              rx="8"
              ry="8"
              :fill="getNodeFill(node)"
              :stroke="getNodeStroke(node)"
              :stroke-width="nodeStrokeWidth(node)"
              :filter="nodeFilter(node)"
            />
            <polygon
              v-else-if="node.shape === 'diamond'"
              :points="`${0},${-node.height/2} ${node.width/2},${0} ${0},${node.height/2} ${-node.width/2},${0}`"
              :fill="getNodeFill(node)"
              :stroke="getNodeStroke(node)"
              :stroke-width="nodeStrokeWidth(node)"
              :filter="nodeFilter(node)"
            />
            <text
              dy="0.35em"
              text-anchor="middle"
              :fill="getNodeTextColor(node)"
              :font-size="node.fontSize"
              font-weight="500"
              pointer-events="none"
            >{{ node.displayLabel }}</text>
          </g>
        </g>
      </g>

    </svg>

    <!-- 空状态：大图标 + 提示 + 构建按钮 -->
    <div v-if="nodes.length === 0 && !graphStore.building" class="graph-empty-state" role="status">
      <span class="empty-icon" aria-hidden="true">🕸️</span>
      <p class="empty-title">暂无图谱数据</p>
      <!-- 构建失败时显示错误信息，引导用户重试 -->
      <p v-if="graphStore.buildProgress.stage === 'error'" class="empty-error">{{ graphStore.buildProgress.log }}</p>
      <p v-else class="empty-hint">导入文档后将自动构建知识图谱，或点击下方按钮手动构建</p>
      <button class="btn-primary empty-action" :aria-label="graphStore.buildProgress.stage === 'error' ? '重新构建图谱' : '构建图谱'" @click="buildMissingGraphs" :disabled="graphStore.building">
        {{ graphStore.buildProgress.stage === 'error' ? '重新构建' : '构建图谱' }}
      </button>
    </div>

    <div v-if="graphStore.selectedNode" class="node-detail">
      <button class="node-detail-close" title="关闭" aria-label="关闭节点详情" @click="graphStore.selectNode(null)">×</button>
      <h4>{{ graphStore.selectedNode.content || graphStore.selectedNode.label || graphStore.selectedNode.keyword || graphStore.selectedNode.id }}</h4>
      <p>类型: {{ graphStore.selectedNode.type }}{{ graphStore.selectedNode.meta?.level ? ` / 层级 ${graphStore.selectedNode.meta.level}` : '' }}</p>
      <p>权重: {{ graphStore.selectedNode.weight || 0 }}</p>
    </div>

    <div v-if="tooltip.show" class="graph-tooltip" role="tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
      {{ tooltip.text }}
    </div>

    <!-- 双击跳转确认浮窗 -->
    <transition name="jump-pop">
      <div v-if="jumpConfirm.show" ref="jumpConfirmEl" class="jump-confirm" :style="{ left: jumpConfirm.x + 'px', top: jumpConfirm.y + 'px' }">
        <span class="jump-confirm-text">跳转到该节点？</span>
        <div class="jump-confirm-actions">
          <button class="jump-confirm-btn" @click.stop="confirmJump">跳转</button>
          <button class="jump-confirm-cancel" @click.stop="cancelJump">取消</button>
        </div>
      </div>
    </transition>

    <!-- 节点右键上下文菜单 -->
    <transition name="jump-pop">
      <div v-if="contextMenu.show" class="context-menu" role="menu" aria-label="节点操作菜单" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <button type="button" class="context-menu-item" role="menuitem" @click="openAddChildNodeDialog">添加子节点</button>
        <button type="button" class="context-menu-item" role="menuitem" @click="openEditNodeDialog">编辑节点</button>
        <button type="button" class="context-menu-item" role="menuitem" @click="openAddEdgeDialog">添加连线</button>
        <button type="button" class="context-menu-item" role="menuitem" @click="openDeleteEdgeDialog">删除连线</button>
        <button type="button" class="context-menu-item danger" role="menuitem" @click="deleteNodeFromContextMenu">删除节点</button>
      </div>
    </transition>

    <!-- 创建/编辑节点弹窗 -->
    <Teleport to="body">
      <div v-if="nodeDialog.show" class="modal-overlay" @click.self="nodeDialog.show = false">
        <div class="modal-card node-modal" role="dialog" aria-modal="true" aria-labelledby="node-dialog-title">
          <h3 id="node-dialog-title">{{ nodeDialog.mode === 'create' ? '添加节点' : '编辑节点' }}</h3>
          <div class="form-row">
            <label for="node-content">节点内容</label>
            <input id="node-content" v-model="nodeForm.content" type="text" placeholder="输入知识点、概念或标题" @keydown.enter="saveNode" />
          </div>
          <div class="form-row">
            <label for="node-type">节点类型</label>
            <select id="node-type" v-model="nodeForm.type">
              <option value="manual">手动节点</option>
              <option value="concept">概念</option>
              <option value="entity">实体</option>
              <option value="heading">标题</option>
            </select>
          </div>
          <div v-if="nodeDialog.mode === 'create'" class="form-row">
            <label for="node-parent">父节点（可选）</label>
            <select id="node-parent" v-model="nodeForm.parentId">
              <option value="">无</option>
              <option v-for="n in graphStore.nodes" :key="n.id" :value="n.id">{{ n.content }}</option>
            </select>
          </div>
          <div class="form-row inline">
            <label for="node-shape">形状</label>
            <select id="node-shape" v-model="nodeForm.shape">
              <option value="">默认</option>
              <option value="circle">圆形</option>
              <option value="rect">方形</option>
              <option value="diamond">菱形</option>
            </select>
            <label for="node-size">大小</label>
            <input id="node-size" v-model.number="nodeForm.size" type="number" min="32" max="120" placeholder="默认" />
            <label for="node-color">颜色</label>
            <input id="node-color" v-model="nodeForm.color" type="color" />
          </div>
          <div class="form-row">
            <label for="node-doc">关联文档</label>
            <select id="node-doc" v-model="nodeForm.docId">
              <option value="">不关联文档</option>
              <option v-for="doc in docStore.documents" :key="doc.meta.docId" :value="doc.meta.docId">{{ doc.meta.name }}</option>
            </select>
          </div>
          <div class="form-row inline">
            <label for="node-page">页码</label>
            <input id="node-page" v-model.number="nodeForm.page" type="number" min="1" placeholder="页码" />
            <label for="node-start">字符偏移</label>
            <input id="node-start" v-model.number="nodeForm.start" type="number" min="0" placeholder="偏移" />
          </div>
          <div class="modal-actions">
            <button class="btn-primary" @click="saveNode">保存</button>
            <button class="btn-text" @click="nodeDialog.show = false">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 添加连线弹窗 -->
    <Teleport to="body">
      <div v-if="edgeDialog.show" class="modal-overlay" @click.self="edgeDialog.show = false">
        <div class="modal-card edge-modal" role="dialog" aria-modal="true" aria-labelledby="edge-dialog-title">
          <h3 id="edge-dialog-title">添加连线</h3>
          <div class="form-row">
            <label for="edge-source">源节点</label>
            <input id="edge-source" :value="graphStore.nodes.find(n => n.id === edgeDialog.sourceId)?.content || edgeDialog.sourceId" disabled />
          </div>
          <div class="form-row">
            <label for="edge-target">目标节点</label>
            <select id="edge-target" v-model="edgeForm.targetId">
              <option value="" disabled>请选择目标节点</option>
              <option v-for="n in graphStore.nodes.filter(n => n.id !== edgeDialog.sourceId)" :key="n.id" :value="n.id">{{ n.content }}</option>
            </select>
          </div>
          <div class="form-row">
            <label for="edge-type">关系类型</label>
            <select id="edge-type" v-model="edgeForm.type">
              <option value="related">related（语义相关）</option>
              <option value="hierarchy">hierarchy（上下位）</option>
              <option value="causes">causes（因果）</option>
              <option value="part-of">part-of（组成）</option>
              <option value="treats">treats（治疗）</option>
              <option value="similar">similar（相似）</option>
            </select>
          </div>
          <div class="form-row">
            <label for="edge-weight">权重</label>
            <input id="edge-weight" v-model.number="edgeForm.weight" type="number" min="0" max="1" step="0.1" />
          </div>
          <div class="modal-actions">
            <button class="btn-primary" @click="saveEdge">添加</button>
            <button class="btn-text" @click="edgeDialog.show = false">取消</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 删除连线弹窗 -->
    <Teleport to="body">
      <div v-if="edgeDeleteDialog.show" class="modal-overlay" @click.self="edgeDeleteDialog.show = false">
        <div class="modal-card edge-modal" role="dialog" aria-modal="true" aria-labelledby="edge-delete-dialog-title">
          <h3 id="edge-delete-dialog-title">删除连线</h3>
          <div v-if="edgesForDeletion.length === 0" class="empty-edges">
            该节点没有关联连线
          </div>
          <div v-else class="edge-delete-list">
            <div
              v-for="edge in edgesForDeletion"
              :key="`${edge.from}-${edge.to}-${edge.type}`"
              class="edge-delete-item"
            >
              <span class="edge-delete-label">{{ edge.display }}</span>
              <button class="btn-danger-small" @click="deleteEdge(edge)">删除</button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-text" @click="edgeDeleteDialog.show = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 点击空白处关闭上下文菜单 -->
    <div v-if="contextMenu.show" class="context-menu-backdrop" @click="closeContextMenu"></div>

      <button
        v-if="!uiStore.treeListVisible && (treeNodes.length || ideaTreeNodes.length)"
        class="graph-tree-toggle"
        aria-label="显示节点列表"
        @click="uiStore.treeListVisible = true"
      >节点列表</button>
    </div>

    <!-- 节点列表：窄屏在底部，宽屏在右侧 -->
    <div v-if="uiStore.treeListVisible && (treeNodes.length || ideaTreeNodes.length)" class="graph-tree-panel">
      <div class="graph-tree-header">
        <div class="graph-tree-tabs">
          <button class="graph-tree-tab" :class="{active: treeActiveTab==='files'}" aria-label="切换到文件节点列表" @click="treeActiveTab='files'">文件</button>
          <button class="graph-tree-tab" :class="{active: treeActiveTab==='ideas'}" aria-label="切换到 Idea 节点列表" @click="treeActiveTab='ideas'">Idea</button>
        </div>
        <div class="graph-tree-actions">
          <button v-if="treeActiveTab==='files'" class="graph-tool" title="为尚未生成图谱的文档批量生成" aria-label="补全图谱" @click="buildMissingGraphs" :disabled="graphStore.building">{{ graphStore.building ? '补全中...' : '补全图谱' }}</button>
          <button class="graph-tool" title="全部展开" aria-label="全部展开" @click="expandAll" :disabled="graphStore.building || graphStore.nodes.length === 0">全部展开</button>
          <button class="graph-tool" title="收起列表" aria-label="隐藏节点列表" @click="uiStore.treeListVisible = false">隐藏</button>
        </div>
      </div>
      <div v-if="treeActiveTab==='files'" class="graph-tree-list" role="tree" aria-label="文档知识图谱树">
        <GraphNodeTree
          v-for="item in treeNodes"
          :key="item.id"
          :item="item"
          :selected-id="selectedId"
          :expanded-hierarchy-ids="treeExpandedHierarchyIds"
          :expanded-links-ids="treeExpandedLinksIds"
          @select="onTreeItemClick"
          @toggle-hierarchy="toggleTreeHierarchy"
          @toggle-links="toggleTreeLinks"
          @dblclick="onTreeItemDblClick"
          @build-graph="buildGraphForDoc"
          @contextmenu="onTreeContextMenu"
        />
        <div v-if="treeNodes.length===0" class="graph-tree-empty">暂无文档节点</div>
      </div>
      <div v-if="treeActiveTab==='ideas'" class="graph-tree-list" role="tree" aria-label="Idea 与图谱关联树">
        <GraphIdeaTree
          v-for="item in ideaTreeNodes"
          :key="item.id"
          :item="item"
          :selected-id="selectedId"
          :expanded-hierarchy-ids="treeExpandedHierarchyIds"
          :expanded-links-ids="treeExpandedLinksIds"
          :idea-toggling="ideaToggling"
          @select="onTreeItemClick"
          @toggle-hierarchy="toggleTreeHierarchy"
          @toggle-links="toggleTreeLinks"
          @dblclick="onTreeItemDblClick"
          @toggle-visibility="toggleIdeaVisibility"
        />
        <div v-if="ideaTreeNodes.length===0" class="graph-tree-empty">暂无 Idea</div>
        <div class="graph-tree-footer">
          <button class="graph-tool add-idea-btn" aria-label="添加 Idea" @click="openAddIdeaDialog">+ 添加 Idea</button>
        </div>
      </div>
    </div>

    <!-- 添加 Idea 弹窗 -->
    <Teleport to="body">
      <div v-if="addIdeaDialog.show" class="modal-overlay" @click.self="closeAddIdeaDialog">
        <div class="modal-card idea-modal" role="dialog" aria-modal="true" aria-labelledby="add-idea-dialog-title">
          <h3 id="add-idea-dialog-title">添加 Idea</h3>
          <input
            v-model="addIdeaDialog.title"
            placeholder="Idea 标题"
            aria-label="Idea 标题"
            @keyup.enter="submitAddIdea"
          />
          <textarea
            v-model="addIdeaDialog.content"
            placeholder="记录你的想法..."
            aria-label="Idea 内容"
            rows="3"
          />
          <div class="modal-actions">
            <button class="btn-primary" @click="submitAddIdea">保存</button>
            <button class="btn-text" @click="closeAddIdeaDialog">取消</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.graph-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  position: relative;
}
.graph-view.wide-layout {
  flex-direction: row;
}
.graph-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  position: relative;
}
/* 空状态覆盖层 */
.graph-empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
  pointer-events: none;
}
.graph-empty-state .empty-icon {
  font-size: 56px;
  opacity: 0.4;
}
.graph-empty-state .empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}
.graph-empty-state .empty-hint {
  font-size: 13px;
  color: var(--text-tertiary);
  max-width: 300px;
  line-height: 1.6;
  margin: 0;
}
/* 构建失败错误提示 */
.graph-empty-state .empty-error {
  font-size: 13px;
  color: var(--danger, #ef4444);
  max-width: 320px;
  line-height: 1.6;
  margin: 0;
  word-break: break-word;
}
.graph-empty-state .empty-action {
  pointer-events: auto;
  margin-top: 6px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
}
.graph-header {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.graph-header .hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 10px;
}
.graph-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.graph-tool {
  padding: 4px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.graph-tool:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.graph-tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.graph-tool.active {
  background: var(--accent-bg, rgba(59, 130, 246, 0.1));
  color: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
}
.graph-svg {
  flex: 1;
  width: 100%;
  min-height: 0;
  background: var(--bg-primary);
  cursor: grab;
  touch-action: none;
}
.graph-svg:active {
  cursor: grabbing;
}
.node {
  cursor: pointer;
  transition: opacity 0.2s;
}
.node:hover {
  opacity: 0.88;
}
.node.dragging {
  cursor: grabbing;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
}
.node.link-source {
  filter: drop-shadow(0 0 8px var(--accent, #3b82f6));
}
.node.link-source circle,
.node.link-source rect {
  stroke: var(--accent, #3b82f6);
  stroke-width: 3px;
}
.graph-loading {
  position: absolute;
  top: 48px;
  left: 16px;
  right: 16px;
  z-index: 10;
  background: color-mix(in srgb, var(--bg-primary, #fff) 95%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.progress-bar {
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.progress-text {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.progress-chunks {
  color: var(--accent);
  font-weight: 500;
}
.node-detail {
  position: relative;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.node-detail-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 4px);
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.node-detail-close:hover {
  background: var(--bg-hover, #f1f5f9);
  color: var(--text-primary);
}
.node-detail h4 {
  color: var(--accent);
  margin-bottom: 6px;
  font-size: 13px;
}
.node-detail p {
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.graph-tooltip {
  position: fixed;
  pointer-events: none;
  background: rgba(31, 41, 55, 0.95);
  color: #fff;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  z-index: var(--z-tooltip);
  box-shadow: var(--shadow);
  max-width: 200px;
}

/* 双击跳转确认浮窗 */
.jump-confirm {
  position: absolute;
  z-index: var(--z-sticky);
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  width: 160px;
  pointer-events: auto;
}
.jump-confirm-text {
  display: block;
  font-size: 12px;
  color: var(--text-primary, #1f2937);
  margin-bottom: 8px;
  white-space: nowrap;
}
.jump-confirm-actions {
  display: flex;
  gap: 6px;
}
.jump-confirm-btn,
.jump-confirm-cancel {
  flex: 1;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.jump-confirm-btn {
  background: var(--accent, #3b82f6);
  color: #fff;
  border-color: var(--accent, #3b82f6);
}
.jump-confirm-btn:hover {
  background: var(--accent-dark, #1d4ed8);
}
.jump-confirm-cancel {
  background: var(--bg-secondary, #f3f4f6);
  color: var(--text-secondary, #6b7280);
  border-color: var(--border, #e5e7eb);
}
.jump-confirm-cancel:hover {
  background: var(--bg-hover, #e5e7eb);
  color: var(--text-primary, #1f2937);
}

/* 跳转确认浮窗丝滑动画 */
.jump-pop-enter-active,
.jump-pop-leave-active {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
  transform-origin: left center;
}
.jump-pop-enter-from,
.jump-pop-leave-to {
  transform: scale(0.85) translateY(-4px);
  opacity: 0;
}

/* 节点列表：窄屏在底部，宽屏在右侧 */
.graph-tree-panel {
  flex-basis: 240px;
  width: 100%;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  overflow: hidden;
  transition: flex-basis 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              border 0.35s ease;
}
.graph-view.wide-layout .graph-tree-panel {
  flex-basis: 260px;
  border-top: none;
  border-left: 1px solid var(--border);
}
.graph-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.graph-tree-tabs {
  display: flex;
  gap: 2px;
  background: var(--bg-tertiary, rgba(0,0,0,0.04));
  border-radius: 7px;
  padding: 2px;
}
.graph-tree-tab {
  padding: 4px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  border-radius: 5px;
  border-bottom: none;
  transition: all 0.15s;
}
.graph-tree-tab:hover {
  background: var(--bg-hover);
}
.graph-tree-tab.active {
  color: var(--accent, #3b82f6);
  background: var(--bg-primary, #fff);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.graph-tree-empty {
  padding: 32px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
.graph-tree-footer {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.add-idea-btn {
  width: 100%;
  justify-content: center;
  font-weight: 500;
}
.graph-tree-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 添加 Idea 弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.modal-card {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  min-width: 360px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2), 0 0 0 1px rgba(99, 102, 241, 0.05);
  animation: scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.modal-card h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-card h3::before {
  content: '';
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: var(--accent, #3b82f6);
}
.modal-card input,
.modal-card textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
}
.modal-card textarea {
  resize: vertical;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.btn-primary {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: var(--accent, #3b82f6);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-text {
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.btn-text:hover {
  background: var(--bg-hover);
}
.graph-tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}
.graph-tree-toggle {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 50;
  padding: 5px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  box-shadow: var(--shadow);
}
.graph-tree-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* 导出菜单 */
.graph-export-menu {
  position: relative;
}
.export-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}
.export-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  z-index: var(--z-dropdown);
  min-width: 140px;
}
.export-dropdown button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.export-dropdown button:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

/* .context-menu / .context-menu-item 基础样式已统一到 ide.css，
   此处仅保留组件特定的 min-width 覆盖。 */
.context-menu {
  min-width: 120px;
}
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-overlay) - 1);
}

.node-modal {
  width: 420px;
  max-width: 90vw;
}
.node-modal .form-row {
  margin-bottom: 12px;
}
.node-modal .form-row.inline {
  display: flex;
  align-items: center;
  gap: 10px;
}
.node-modal .form-row.inline label {
  flex-shrink: 0;
}
.node-modal .form-row.inline input,
.node-modal .form-row.inline select {
  width: 90px;
}
.node-modal .form-row.inline input[type="color"] {
  width: 40px;
  height: 28px;
  padding: 0;
  border: none;
}
.node-modal label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.node-modal input,
.node-modal select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  font-size: 13px;
}
.node-modal .modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.edge-modal {
  width: 420px;
  max-width: 90vw;
}
.edge-modal .form-row {
  margin-bottom: 12px;
}
.edge-modal label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.edge-modal input,
.edge-modal select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  font-size: 13px;
}
.edge-modal input:disabled {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.edge-delete-list {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.edge-delete-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.edge-delete-label {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  padding-right: 10px;
}
.btn-danger-small {
  padding: 4px 10px;
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-danger-small:hover {
  background: var(--danger-border);
}
.empty-edges {
  padding: 20px 0;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ============ 响应式样式 ============ */

/* 中等屏幕（max-width: 1200px）*/
@media (max-width: 1200px) {
  /* 图谱头部：统计信息缩小 */
  .graph-header {
    font-size: 11px;
    padding: 8px 10px;
  }
  .graph-header .hint {
    display: none;
  }
  /* 图谱工具按钮缩小 */
  .graph-tool {
    padding: 3px 6px;
    font-size: 10px;
  }
  /* 节点列表面板：窄一些 */
  .graph-view.wide-layout .graph-tree-panel {
    flex-basis: 220px;
  }
}

/* 小屏幕（max-width: 768px）*/
@media (max-width: 768px) {
  /* 图谱头部：允许换行 */
  .graph-header {
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
  }
  .graph-header > span {
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  /* 图谱操作区：换行排列 */
  .graph-actions {
    flex-wrap: wrap;
    gap: 3px;
  }
  .graph-tool {
    padding: 3px 5px;
    font-size: 10px;
  }
  /* 图谱 SVG 文字在小屏略小 */
  .graph-svg text {
    font-size: 11px;
  }
  /* 节点列表面板：全宽显示在底部 */
  .graph-tree-panel {
    flex-basis: 100% !important;
    border-left: none !important;
    border-top: 1px solid var(--border);
    max-height: 40%;
  }
  .graph-view.wide-layout .graph-tree-panel {
    flex-basis: 100% !important;
    border-left: none !important;
    border-top: 1px solid var(--border);
  }
  /* 节点列表标签：紧凑 */
  .graph-tree-tab {
    padding: 3px 10px;
    font-size: 11px;
  }
  .graph-tree-header {
    padding: 4px 8px;
    font-size: 11px;
  }
  /* 节点详情：紧凑 */
  .node-detail {
    padding: 8px 10px;
    font-size: 11px;
  }
  .node-detail h4 {
    font-size: 12px;
  }
  /* 图谱加载提示：全宽 */
  .graph-loading {
    top: 40px;
    left: 8px;
    right: 8px;
    padding: 8px 12px;
  }
  /* 弹窗：全宽 */
  .node-modal,
  .edge-modal {
    width: 92vw;
    max-width: 92vw;
  }
  .modal-card {
    min-width: auto;
    padding: 16px;
  }
  /* 跳转确认浮窗：紧凑 */
  .jump-confirm {
    width: 140px;
    padding: 8px 10px;
  }
  /* 空状态：紧凑 */
  .graph-empty-state .empty-icon {
    font-size: 40px;
  }
  .graph-empty-state .empty-title {
    font-size: 14px;
  }
  .graph-empty-state .empty-hint {
    font-size: 12px;
    max-width: 240px;
  }
}

/* 超小屏幕（max-width: 480px）*/
@media (max-width: 480px) {
  /* 图谱头部：极简 */
  .graph-header > span {
    font-size: 9px;
  }
  .graph-tool {
    padding: 2px 4px;
    font-size: 9px;
  }
  /* 图谱 SVG 文字在超小屏更小 */
  .graph-svg text {
    font-size: 10px;
  }
  /* 节点列表标签：最小 */
  .graph-tree-tab {
    padding: 3px 8px;
    font-size: 10px;
  }
}
.edge-modal .modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
