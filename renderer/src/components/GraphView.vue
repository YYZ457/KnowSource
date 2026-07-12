<template>
  <div class="graph-view">
    <!-- ===== Toolbar ===== -->
    <div class="graph-toolbar">
      <div class="toolbar-section toolbar-left">
        <div class="doc-select-wrap">
          <label class="select-label">选择文档</label>
          <select
            class="doc-select"
            v-model="selectedDocIds"
            multiple
            :size="Math.min(4, Math.max(2, docs.length))"
          >
            <option v-for="doc in docs" :key="doc.id" :value="doc.id">
              {{ doc.title || doc.name || doc.id }}
            </option>
          </select>
        </div>
        <button
          class="btn btn--primary btn--build"
          @click="handleBuild"
          :disabled="graphStore.building"
          :aria-label="graphStore.building ? '正在构建图谱' : '构建知识图谱'"
        >
          <span v-if="graphStore.building" class="spinner"></span>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {{ graphStore.building ? '构建中...' : '构建图谱' }}
        </button>
        <button class="btn btn--sm" @click="handleClear" :disabled="graphStore.building || !graphStore.nodes.length" aria-label="清空图谱">
          清空
        </button>
        <button class="btn btn--sm btn--add" @click="handleAddNode" title="添加节点">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          添加节点
        </button>
        <div class="toolbar-divider"></div>
        <button class="btn btn--sm btn--expand" @click="expandAll" title="全部展开" :disabled="!graphStore.nodes.length">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          全部展开
        </button>
        <button class="btn btn--sm btn--collapse" @click="collapseAll" title="全部收起" :disabled="!graphStore.nodes.length">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          全部收起
        </button>
        <button v-if="!legendVisible && graphStore.nodes.length" class="btn btn--sm btn--legend" @click="legendVisible = true" title="显示图例">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="11" y2="8"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/><circle cx="16" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/></svg>
          图例
        </button>
      </div>

      <div class="toolbar-section toolbar-right">
        <div class="stat-chip">
          <span class="stat-dot stat-dot--node"></span>
          <span class="stat-label">节点</span>
          <span class="stat-value">{{ currentNodes.length }}/{{ graphStore.nodes.length }}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-dot stat-dot--edge"></span>
          <span class="stat-label">关系</span>
          <span class="stat-value">{{ currentLinks.length }}/{{ graphStore.edges.length }}</span>
        </div>
        <div class="zoom-controls">
          <button class="zoom-btn" @click="zoomIn" title="放大" aria-label="放大图谱">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <span class="zoom-level">{{ Math.round(currentZoom * 100) }}%</span>
          <button class="zoom-btn" @click="zoomOut" title="缩小" aria-label="缩小图谱">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="zoom-btn" @click="resetZoom" title="重置视图" aria-label="重置缩放">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 9 8 9"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ===== Build Progress ===== -->
    <transition name="fade">
      <div v-if="graphStore.building" class="build-progress">
        <div class="progress-content">
          <div class="progress-ring">
            <span class="spinner spinner--lg"></span>
          </div>
          <div class="progress-text">
            <div class="progress-title">{{ graphStore.buildProgress || '正在构建知识图谱' }}</div>
            <div class="progress-percent" v-if="graphStore.buildPercent > 0">{{ Math.round(graphStore.buildPercent) }}%</div>
            <div class="progress-bar">
              <div class="progress-bar-fill" :style="{ width: Math.max(graphStore.buildPercent, 3) + '%' }"></div>
            </div>
            <div class="progress-log" v-if="graphStore.buildLog">{{ graphStore.buildLog }}</div>
          </div>
        </div>
      </div>
    </transition>

    <!-- ===== Graph Canvas ===== -->
    <div class="graph-canvas" ref="canvasRef">
      <svg ref="svgRef" class="graph-svg">
        <defs>
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
          </filter>
        </defs>
        <g ref="mainGRef" class="main-g"></g>
      </svg>

      <!-- Legend -->
      <div v-if="graphStore.nodes.length && legendVisible" class="graph-legend">
        <button class="legend-close" @click="legendVisible = false" title="关闭图例">&times;</button>
        <div class="legend-title">图例</div>
        <div class="legend-section">
          <div class="legend-subtitle">形状</div>
          <div class="legend-item">
            <svg width="20" height="14"><rect x="1" y="1" width="18" height="12" rx="2" fill="var(--text-3)" opacity="0.5"/></svg>
            <span class="legend-label">文档/实体</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="14"><rect x="1" y="1" width="18" height="12" rx="7" fill="var(--rose)" opacity="0.5"/></svg>
            <span class="legend-label">灵感</span>
          </div>
        </div>
        <div class="legend-section">
          <div class="legend-subtitle">颜色 = 所属文档</div>
          <div class="legend-item" v-for="doc in docColors" :key="doc.id">
            <span class="legend-color" :style="{ background: doc.color }"></span>
            <span class="legend-label">{{ doc.name }}</span>
          </div>
        </div>
        <div class="legend-section">
          <div class="legend-subtitle">大小 = 重要程度</div>
          <div class="legend-item legend-size-demo">
            <svg width="60" height="20">
              <rect x="0" y="8" width="16" height="12" rx="2" fill="var(--text-3)" opacity="0.4"/>
              <rect x="22" y="4" width="22" height="16" rx="2" fill="var(--text-3)" opacity="0.5"/>
              <rect x="50" y="0" width="28" height="20" rx="2" fill="var(--text-3)" opacity="0.6"/>
            </svg>
            <span class="legend-label">低 → 高</span>
          </div>
        </div>
        <div class="legend-section">
          <div class="legend-subtitle">边框 = 层级</div>
          <div class="legend-item">
            <svg width="20" height="14"><rect x="1" y="1" width="18" height="12" rx="2" fill="var(--text-3)" opacity="0.5" stroke-width="3"/></svg>
            <span class="legend-label">粗 = 文档/标题</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="14"><rect x="1" y="1" width="18" height="12" rx="2" fill="var(--text-3)" opacity="0.3" stroke-width="1"/></svg>
            <span class="legend-label">细 = 概念/实体</span>
          </div>
        </div>
        <div class="legend-section legend-interactions">
          <div class="legend-subtitle">交互</div>
          <div class="legend-item"><span class="legend-label">单击 = 展开/收起子节点</span></div>
          <div class="legend-item"><span class="legend-label">双击 = 跳转到原文档</span></div>
          <div class="legend-item"><span class="legend-label">右键 = 编辑/删除</span></div>
        </div>
      </div>
    </div>

    <!-- ===== Empty State ===== -->
    <transition name="fade">
      <div v-if="!graphStore.nodes.length && !graphStore.building" class="empty-state graph-empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
          <line x1="10" y1="6.5" x2="14" y2="6.5" stroke-dasharray="2 2"/>
          <line x1="6.5" y1="10" x2="6.5" y2="14" stroke-dasharray="2 2"/>
        </svg>
        <p class="empty-title">暂无知识图谱数据</p>
        <p class="empty-hint">选择上方文档并点击「构建图谱」生成可视化</p>
      </div>
    </transition>

    <!-- ===== Node Edit Dialog ===== -->
    <transition name="fade">
      <div v-if="editDialog.show" class="edit-dialog-overlay" @click.self="closeEditDialog">
        <div class="edit-dialog">
          <div class="edit-dialog-header">
            <h3>{{ editDialog.isNew ? '添加节点' : '编辑节点' }}</h3>
            <button class="edit-dialog-close" @click="closeEditDialog">&times;</button>
          </div>
          <div class="edit-dialog-body">
            <div class="edit-field">
              <label>节点名称</label>
              <input v-model="editDialog.label" type="text" placeholder="输入节点名称" ref="editInputRef" />
            </div>
            <div class="edit-field">
              <label>节点类型</label>
              <select v-model="editDialog.type">
                <option value="entity">实体</option>
                <option value="concept">概念</option>
                <option value="heading">标题</option>
                <option value="idea">灵感</option>
                <option value="document">文档</option>
                <option value="manual">手册</option>
              </select>
            </div>
            <div class="edit-field">
              <label>所属文档</label>
              <select v-model="editDialog.docId">
                <option value="">无</option>
                <option v-for="doc in docs" :key="doc.id" :value="doc.id">{{ doc.name }}</option>
              </select>
            </div>
          </div>
          <div class="edit-dialog-footer">
            <button class="btn btn--sm" @click="closeEditDialog">取消</button>
            <button class="btn btn--primary btn--sm" @click="saveEditDialog">保存</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- ===== Context Menu ===== -->
    <transition name="fade">
      <div v-if="contextMenu.show" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }">
        <div class="context-menu-item" @click="handleContextEdit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑节点
        </div>
        <div class="context-menu-item context-menu-item--danger" @click="handleContextDelete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除节点
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { drag } from 'd3-drag'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import { useGraphStore, useDocsStore, useUiStore } from '../stores'
import { graphApi } from '../api/client'

const graphStore = useGraphStore()
const docsStore = useDocsStore()
const uiStore = useUiStore()

// ===== Document color palette =====
const DOC_COLORS = [
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#10b981', // emerald
  '#f43f5e', // rose
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
]

function getDocColor(docId) {
  if (!docId) return '#64748b' // slate for no-doc nodes
  const idx = docsStore.documents.findIndex(d => d.id === docId)
  if (idx < 0) return '#64748b'
  return DOC_COLORS[idx % DOC_COLORS.length]
}

const docColors = computed(() => {
  return docsStore.documents.map((doc, idx) => ({
    id: doc.id,
    name: doc.name || doc.title || doc.id.slice(0, 8),
    color: DOC_COLORS[idx % DOC_COLORS.length]
  }))
})

// ===== Node sizing =====
function nodeSize(node) {
  const s = Number(node.specificity ?? node.weight ?? 0.5)
  const clamped = Math.max(0, Math.min(1, isNaN(s) ? 0.5 : s))
  // Base size + scale by importance
  const baseWidth = 60
  const baseHeight = 28
  const scale = 0.7 + clamped * 0.8 // 0.7 to 1.5
  return {
    width: baseWidth * scale,
    height: baseHeight * scale,
    rx: node.type === 'idea' ? (baseHeight * scale) / 2 : 4 // pill shape for ideas
  }
}

function nodeColor(node) {
  const docId = node.source?.docId || node.meta?.docId || node.docId
  return getDocColor(docId)
}

// 从 CSS 变量获取颜色，用于 D3 渲染（支持主题切换）
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// 节点文字颜色 — 根据主题动态获取
function nodeTextColor() {
  // 节点背景是有色的，文字始终用白色（深色和浅色节点背景都需要白色文字才清晰）
  return '#ffffff'
}

// 边线颜色 — 从 CSS 变量获取
function edgeStrokeColor() {
  return cssVar('--border-strong') || 'rgba(148,163,184,0.4)'
}

// 淡化边线颜色
function edgeFadedColor() {
  return cssVar('--border') || 'rgba(148,163,184,0.15)'
}

function truncate(str, n) {
  const s = String(str)
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ===== Hierarchy level by node type =====
const TYPE_LEVEL = { document: 0, heading: 1, concept: 2, entity: 3, idea: 2, manual: 3 }
function typeLevel(type) { return TYPE_LEVEL[type] ?? 3 }
function nodeLevelForId(id) {
  const n = graphStore.nodes.find(x => x.id === id)
  return n ? typeLevel(n.type) : 3
}

// ===== Expand / collapse state =====
const expandedNodes = ref(new Set())
let nodeChildrenMap = {}   // parentId → [childId, ...]
let nodeParentMap = {}     // childId → parentId
let rootNodes = new Set()
let visibleNodeIds = new Set()
let nodePositionMap = {}   // nodeId → {x, y} — persist positions across expand/collapse

function computeHierarchy(nodes, edges) {
  nodeChildrenMap = {}
  nodeParentMap = {}
  rootNodes = new Set()

  const nodeLevel = {}
  for (const n of nodes) nodeLevel[n.id] = typeLevel(n.type)

  // Build adjacency: edges go from higher-level → lower-level node
  for (const e of edges) {
    const sId = typeof e.source === 'object' ? e.source.id : e.source
    const tId = typeof e.target === 'object' ? e.target.id : e.target
    if (!sId || !tId || sId === tId) continue
    const sLvl = nodeLevel[sId] ?? 3
    const tLvl = nodeLevel[tId] ?? 3
    if (sLvl < tLvl) {
      if (!nodeChildrenMap[sId]) nodeChildrenMap[sId] = []
      nodeChildrenMap[sId].push(tId)
      nodeParentMap[tId] = sId
    } else if (tLvl < sLvl) {
      if (!nodeChildrenMap[tId]) nodeChildrenMap[tId] = []
      nodeChildrenMap[tId].push(sId)
      nodeParentMap[sId] = tId
    }
  }

  // Roots: level-0 nodes, or nodes with no parent
  for (const n of nodes) {
    if (nodeLevel[n.id] === 0 || !nodeParentMap[n.id]) {
      rootNodes.add(n.id)
    }
  }

  // Auto-expand roots on fresh load
  if (expandedNodes.value.size === 0) {
    for (const id of rootNodes) {
      if (nodeChildrenMap[id]?.length) expandedNodes.value.add(id)
    }
  }

  // Compute visibility via BFS from expanded roots
  visibleNodeIds = new Set()
  const queue = [...rootNodes]
  while (queue.length) {
    const id = queue.shift()
    if (visibleNodeIds.has(id)) continue
    visibleNodeIds.add(id)
    if (expandedNodes.value.has(id) && nodeChildrenMap[id]) {
      queue.push(...nodeChildrenMap[id])
    }
  }
}

function toggleExpand(nodeId) {
  const s = new Set(expandedNodes.value)
  if (s.has(nodeId)) s.delete(nodeId)
  else s.add(nodeId)
  expandedNodes.value = s
  rebuildVisibility()
}

function rebuildVisibility() {
  // Use smooth D3 transitions instead of full rebuild
  updateGraphVisibility()
}

// ===== Refs / state =====
const svgRef = ref(null)
const mainGRef = ref(null)
const canvasRef = ref(null)
const selectedDocIds = ref([])
const currentZoom = ref(1)
const editInputRef = ref(null)

let svgSel = null
let mainG = null
let simulation = null
let zoomBehavior = null
let linkSel = null
let nodeSel = null
let resizeObserver = null
const currentNodes = ref([])
const currentLinks = ref([])
const legendVisible = ref(true)

// ===== Edit dialog state =====
const editDialog = ref({
  show: false,
  isNew: false,
  nodeId: null,
  label: '',
  type: 'entity',
  docId: ''
})

// ===== Context menu state =====
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  node: null
})

const docs = computed(() => docsStore.documents)

// ===== SVG / zoom init =====
function initSvg() {
  if (!svgRef.value) return
  svgSel = select(svgRef.value)
  mainG = select(mainGRef.value)

  zoomBehavior = zoom()
    .scaleExtent([0.2, 4])
    .on('zoom', (event) => {
      currentZoom.value = event.transform.k
      mainG.attr('transform', event.transform)
    })
  svgSel.call(zoomBehavior)
  svgSel.on('dblclick.zoom', null)
  
  // Close context menu on background click
  svgSel.on('click', () => {
    contextMenu.value.show = false
    graphStore.selectedNode = null
    updateSelection()
  })
}

// ===== Build the graph (full rebuild with D3 enter/update/exit) =====
function buildGraph() {
  if (!mainG) initSvg()
  if (!mainG) return

  if (simulation) { simulation.stop(); simulation = null }

  // Clone nodes so D3 can attach x/y/vx/vy without mutating the store
  const allNodes = graphStore.nodes.map(d => ({ ...d }))

  // Clear cached positions if the node set has completely changed (e.g. project switch)
  if (allNodes.length && nodePositionMap && Object.keys(nodePositionMap).length) {
    const cachedIds = new Set(Object.keys(nodePositionMap))
    const currentIds = new Set(allNodes.map(n => n.id))
    let overlap = 0
    for (const id of cachedIds) if (currentIds.has(id)) overlap++
    if (overlap === 0) {
      nodePositionMap = {}
      expandedNodes.value = new Set()
    }
  }

  // Compute hierarchy & visibility
  computeHierarchy(allNodes, graphStore.edges)

  // Filter to visible nodes only
  currentNodes.value = allNodes.filter(d => visibleNodeIds.has(d.id))
  const visibleIdSet = new Set(currentNodes.value.map(n => n.id))
  const nodeById = new Map(currentNodes.value.map(n => [n.id, n]))
  currentLinks.value = graphStore.edges
    .map(e => ({
      ...e,
      source: nodeById.get(e.source) || e.source,
      target: nodeById.get(e.target) || e.target,
    }))
    .filter(l => l.source && l.target && typeof l.source === 'object' && typeof l.target === 'object'
      && visibleIdSet.has(l.source.id) && visibleIdSet.has(l.target.id))

  // Restore cached positions for existing nodes, center new ones
  const width = canvasRef.value ? canvasRef.value.clientWidth || 900 : 900
  const height = canvasRef.value ? canvasRef.value.clientHeight || 620 : 620
  currentNodes.value.forEach(n => {
    const cached = nodePositionMap[n.id]
    if (cached) { n.x = n.px = cached.x; n.y = n.py = cached.y }
    else { n.x = width / 2 + (Math.random() - 0.5) * 100; n.y = height / 2 + (Math.random() - 0.5) * 100 }
  })

  // --- Edges: enter / update / exit ---
  if (!linkSel) {
    linkSel = mainG.append('g').attr('class', 'links').selectAll('line')
  }
  linkSel = mainG.select('g.links').selectAll('line.edge')
  // 中断正在进行的退出过渡，避免快速展开/收起时节点消失
  linkSel.interrupt()
  linkSel = mainG.select('g.links').selectAll('line.edge')
    .data(currentLinks.value, d => `${d.source.id ?? d.source}→${d.target.id ?? d.target}`)
  linkSel.exit().transition().duration(300).attr('stroke-opacity', 0).remove()
  const linkEnter = linkSel.enter().append('line')
    .attr('class', 'edge')
    .attr('stroke', edgeStrokeColor())
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0)
  linkSel = linkEnter.merge(linkSel)
  linkSel.transition().duration(350).attr('stroke-opacity', 0.6)

  // --- Nodes: enter / update / exit ---
  if (!nodeSel) {
    nodeSel = mainG.append('g').attr('class', 'nodes').selectAll('g.node')
  }
  nodeSel = mainG.select('g.nodes').selectAll('g.node')
  nodeSel.interrupt()
  nodeSel = mainG.select('g.nodes').selectAll('g.node')
    .data(currentNodes.value, d => d.id)

  // EXIT — fade out
  nodeSel.exit()
    .transition().duration(350)
    .attr('opacity', 0)
    .remove()

  // ENTER — create elements, fade in
  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', 'node')
    .attr('opacity', 0)
    .attr('transform', d => `translate(${d.x || width / 2},${d.y || height / 2})`)

  nodeEnter.append('rect')
    .attr('class', 'node-rect')
    .attr('width', d => nodeSize(d).width)
    .attr('height', d => nodeSize(d).height)
    .attr('x', d => -nodeSize(d).width / 2)
    .attr('y', d => -nodeSize(d).height / 2)
    .attr('rx', d => nodeSize(d).rx)
    .attr('fill', d => nodeColor(d))
    .attr('fill-opacity', d => {
      const lvl = typeLevel(d.type)
      return lvl === 0 ? 0.95 : lvl === 1 ? 0.85 : 0.7
    })
    .attr('stroke', d => nodeColor(d))
    .attr('stroke-width', d => {
      const lvl = typeLevel(d.type)
      return lvl === 0 ? 3 : lvl === 1 ? 2.5 : 1.5
    })
    .attr('filter', 'url(#node-shadow)')

  nodeEnter.append('text')
    .attr('class', 'node-text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', nodeTextColor())
    .attr('font-size', d => Math.max(10, nodeSize(d).height * 0.4))
    .attr('font-weight', 500)
    .attr('pointer-events', 'none')
    .text(d => {
      const maxChars = Math.floor(nodeSize(d).width / (Math.max(10, nodeSize(d).height * 0.4) * 0.6))
      return truncate(d.content || d.label || d.name || d.id || '', maxChars)
    })

  // Fade in entering nodes
  nodeEnter.transition().duration(350).attr('opacity', 1)

  // Merge enter + update
  nodeSel = nodeEnter.merge(nodeSel)

  // --- Drag ---
  nodeSel.call(
    drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })
  )

  // --- Interactions ---
  nodeSel
    .on('click', (event, d) => {
      event.stopPropagation()
      if (nodeChildrenMap[d.id]?.length) toggleExpand(d.id)
      const original = graphStore.nodes.find(n => n.id === d.id) || d
      graphStore.selectedNode = original
      updateSelection()
    })
    .on('dblclick', (event, d) => {
      event.stopPropagation(); event.preventDefault()
      const docId = d.source?.docId || d.meta?.docId || d.docId
      if (docId) { uiStore.setView('documents'); docsStore.selectDoc(docId) }
    })
    .on('contextmenu', (event, d) => {
      event.preventDefault(); event.stopPropagation()
      const rect = canvasRef.value.getBoundingClientRect()
      // 边缘定位：防止菜单超出画布边界
      const menuWidth = 160, menuHeight = 200
      let mx = event.clientX - rect.left
      let my = event.clientY - rect.top
      if (mx + menuWidth > rect.width) mx = rect.width - menuWidth - 4
      if (my + menuHeight > rect.height) my = rect.height - menuHeight - 4
      mx = Math.max(4, mx); my = Math.max(4, my)
      contextMenu.value = { show: true, x: mx, y: my, node: d }
    })
    .on('mouseenter', (event, d) => { highlight(d) })
    .on('mouseleave', () => { highlight(null) })

  // --- Force simulation ---
  simulation = forceSimulation(currentNodes.value)
    .force('link', forceLink(currentLinks.value).id(d => d.id).distance(100).strength(0.3))
    .force('charge', forceManyBody().strength(-300))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide().radius(d => Math.max(nodeSize(d).width, nodeSize(d).height) / 2 + 10).strength(0.9))
    .alpha(0.5)

  simulation.on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
    for (const n of currentNodes.value) {
      if (n.x != null && n.y != null) nodePositionMap[n.id] = { x: n.x, y: n.y }
    }
  })

  // Rebuild expand/collapse badges
  rebuildBadges()
  updateSelection()
}

// ===== Smooth visibility update for expand/collapse (no full rebuild) =====
function updateGraphVisibility() {
  if (!mainG || !nodeSel || !linkSel) return

  // Recompute visibility based on current expandedNodes
  visibleNodeIds = new Set()
  for (const rootId of rootNodes) {
    // Only show root node if it's expanded (or is a document-level root)
    const isDocRoot = (nodeLevelForId(rootId) === 0)
    if (expandedNodes.value.has(rootId) || isDocRoot) visibleNodeIds.add(rootId)
    const queue = [rootId]
    while (queue.length) {
      const id = queue.shift()
      if (!expandedNodes.value.has(id)) continue
      const children = nodeChildrenMap[id] || []
      for (const cid of children) {
        visibleNodeIds.add(cid)
        queue.push(cid)
      }
    }
  }

  const allNodes = graphStore.nodes.map(d => ({ ...d }))
  // Restore positions from cache
  allNodes.forEach(n => {
    const cached = nodePositionMap[n.id]
    if (cached) { n.x = n.px = cached.x; n.y = n.py = cached.y }
  })

  currentNodes.value = allNodes.filter(d => visibleNodeIds.has(d.id))
  const visibleIdSet = new Set(currentNodes.value.map(n => n.id))
  const nodeById = new Map(currentNodes.value.map(n => [n.id, n]))
  currentLinks.value = graphStore.edges
    .map(e => ({ ...e, source: nodeById.get(e.source) || e.source, target: nodeById.get(e.target) || e.target }))
    .filter(l => l.source && l.target && typeof l.source === 'object' && typeof l.target === 'object'
      && visibleIdSet.has(l.source.id) && visibleIdSet.has(l.target.id))

  const width = canvasRef.value ? canvasRef.value.clientWidth || 900 : 900
  const height = canvasRef.value ? canvasRef.value.clientHeight || 620 : 620

  // --- Node transitions ---
  nodeSel = mainG.select('g.nodes').selectAll('g.node')
  nodeSel.interrupt()
  nodeSel = mainG.select('g.nodes').selectAll('g.node')
    .data(currentNodes.value, d => d.id)

  nodeSel.exit()
    .transition().duration(350)
    .attr('opacity', 0)
    .remove()

  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', 'node')
    .attr('opacity', 0)
    .attr('transform', d => `translate(${d.x ?? width / 2},${d.y ?? height / 2})`)

  nodeEnter.append('rect')
    .attr('class', 'node-rect')
    .attr('width', d => nodeSize(d).width)
    .attr('height', d => nodeSize(d).height)
    .attr('x', d => -nodeSize(d).width / 2)
    .attr('y', d => -nodeSize(d).height / 2)
    .attr('rx', d => nodeSize(d).rx)
    .attr('fill', d => nodeColor(d))
    .attr('fill-opacity', d => { const lvl = typeLevel(d.type); return lvl === 0 ? 0.95 : lvl === 1 ? 0.85 : 0.7 })
    .attr('stroke', d => nodeColor(d))
    .attr('stroke-width', d => { const lvl = typeLevel(d.type); return lvl === 0 ? 3 : lvl === 1 ? 2.5 : 1.5 })
    .attr('filter', 'url(#node-shadow)')

  nodeEnter.append('text')
    .attr('class', 'node-text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', nodeTextColor())
    .attr('font-size', d => Math.max(10, nodeSize(d).height * 0.4))
    .attr('font-weight', 500)
    .attr('pointer-events', 'none')
    .text(d => {
      const maxChars = Math.floor(nodeSize(d).width / (Math.max(10, nodeSize(d).height * 0.4) * 0.6))
      return truncate(d.content || d.label || d.name || d.id || '', maxChars)
    })

  nodeEnter.transition().duration(350).attr('opacity', 1)
  nodeSel = nodeEnter.merge(nodeSel)

  // Re-bind interactions on merged selection
  nodeSel
    .on('click', (event, d) => {
      event.stopPropagation()
      if (nodeChildrenMap[d.id]?.length) toggleExpand(d.id)
      const original = graphStore.nodes.find(n => n.id === d.id) || d
      graphStore.selectedNode = original
      updateSelection()
    })
    .on('dblclick', (event, d) => {
      event.stopPropagation(); event.preventDefault()
      const docId = d.source?.docId || d.meta?.docId || d.docId
      if (docId) { uiStore.setView('documents'); docsStore.selectDoc(docId) }
    })
    .on('contextmenu', (event, d) => {
      event.preventDefault(); event.stopPropagation()
      const rect = canvasRef.value.getBoundingClientRect()
      const menuWidth = 160, menuHeight = 200
      let mx = event.clientX - rect.left, my = event.clientY - rect.top
      if (mx + menuWidth > rect.width) mx = rect.width - menuWidth - 4
      if (my + menuHeight > rect.height) my = rect.height - menuHeight - 4
      mx = Math.max(4, mx); my = Math.max(4, my)
      contextMenu.value = { show: true, x: mx, y: my, node: d }
    })
    .on('mouseenter', (event, d) => { highlight(d) })
    .on('mouseleave', () => { highlight(null) })

  nodeSel.call(
    drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
  )

  // --- Link transitions ---
  linkSel = mainG.select('g.links').selectAll('line.edge')
  linkSel.interrupt()
  linkSel = mainG.select('g.links').selectAll('line.edge')
    .data(currentLinks.value, d => `${d.source.id ?? d.source}→${d.target.id ?? d.target}`)

  linkSel.exit().transition().duration(350).attr('stroke-opacity', 0).remove()

  const linkEnter = linkSel.enter().append('line')
    .attr('class', 'edge')
    .attr('stroke', edgeStrokeColor())
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0)

  linkSel = linkEnter.merge(linkSel)
  linkSel.transition().duration(350).attr('stroke-opacity', 0.6)

  // --- Gently update simulation (low alpha = no chaotic flying) ---
  simulation.nodes(currentNodes.value)
  simulation.force('link').links(currentLinks.value)
  simulation.force('center', forceCenter(width / 2, height / 2))
  simulation.force('collide', forceCollide().radius(d => Math.max(nodeSize(d).width, nodeSize(d).height) / 2 + 10).strength(0.9))
  simulation.alpha(0.15).restart()

  // Rebuild expand/collapse badges
  rebuildBadges()
  updateSelection()
}

// ===== Rebuild expand/collapse badges on all visible nodes =====
function rebuildBadges() {
  if (!nodeSel) return
  nodeSel.each(function(d) {
    const g = select(this)
    g.selectAll('.expand-badge').remove()
    const children = nodeChildrenMap[d.id]
    if (!children || !children.length) return
    const sz = nodeSize(d)
    const bx = sz.width / 2 + 2
    const by = -sz.height / 2 - 2
    const isExpanded = expandedNodes.value.has(d.id)
    const badge = g.append('g').attr('class', 'expand-badge')
    badge.append('circle')
      .attr('cx', bx).attr('cy', by).attr('r', 7)
      .attr('fill', isExpanded ? 'var(--accent)' : 'var(--text-3)')
      .attr('fill-opacity', 0.8)
      .attr('stroke', 'var(--bg-void)')
      .attr('stroke-width', 1.5)
    badge.append('text')
      .attr('x', bx).attr('y', by)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', nodeTextColor())
      .attr('font-size', 10)
      .attr('font-weight', 700)
      .attr('pointer-events', 'none')
      .text(isExpanded ? '−' : '+')
  })
}

// ===== Highlight connected sub-graph on hover =====
function highlight(node) {
  if (!nodeSel) return

  // When mouse leaves a node, check if there's a selected node to keep highlighting
  const effectiveNode = node || (graphStore.selectedNode && currentNodes.value.find(n => n.id === graphStore.selectedNode.id) ? graphStore.selectedNode : null)

  if (!effectiveNode) {
    nodeSel.transition().duration(180).attr('opacity', 1)
    nodeSel.select('.node-rect')
      .transition().duration(180)
      .attr('fill-opacity', d => {
        const lvl = typeLevel(d.type)
        return lvl === 0 ? 0.95 : lvl === 1 ? 0.85 : 0.7
      })
    linkSel
      .transition().duration(180)
      .attr('stroke-opacity', 0.6)
      .attr('stroke', edgeStrokeColor())
    return
  }

  const neighborIds = new Set([effectiveNode.id])
  currentLinks.value.forEach(l => {
    const s = l.source.id ?? l.source
    const t = l.target.id ?? l.target
    if (s === effectiveNode.id) neighborIds.add(t)
    if (t === effectiveNode.id) neighborIds.add(s)
  })

  nodeSel
    .transition().duration(180)
    .attr('opacity', d => (neighborIds.has(d.id) ? 1 : 0.2))

  linkSel
    .transition().duration(180)
    .attr('stroke-opacity', l => {
      const s = l.source.id ?? l.source
      const t = l.target.id ?? l.target
      return s === effectiveNode.id || t === effectiveNode.id ? 0.9 : 0.08
    })
    .attr('stroke', l => {
      const s = l.source.id ?? l.source
      const t = l.target.id ?? l.target
      return s === effectiveNode.id || t === effectiveNode.id ? nodeColor(effectiveNode) : edgeFadedColor()
    })
}

// ===== Selection highlight =====
function updateSelection() {
  if (!nodeSel) return
  const selId = graphStore.selectedNode ? graphStore.selectedNode.id : null
  nodeSel.select('.node-rect')
    .attr('stroke', d => (d.id === selId ? nodeTextColor() : nodeColor(d)))
    .attr('stroke-width', d => {
      if (d.id === selId) return 3.5
      const lvl = typeLevel(d.type)
      return lvl === 0 ? 3 : lvl === 1 ? 2.5 : 1.5
    })
}

// ===== Clear =====
function clearGraph() {
  if (simulation) { simulation.stop(); simulation = null }
  if (mainG) mainG.selectAll('*').remove()
  nodeSel = null
  linkSel = null
  currentNodes.value = []
  currentLinks.value = []
}

function renderGraph() {
  if (!svgSel) initSvg()
  if (!svgSel) return
  if (!graphStore.nodes.length) {
    clearGraph()
    return
  }
  buildGraph()
}

// ===== Zoom controls =====
function zoomIn() {
  if (svgSel) svgSel.transition().duration(300).call(zoomBehavior.scaleBy, 1.3)
}
function zoomOut() {
  if (svgSel) svgSel.transition().duration(300).call(zoomBehavior.scaleBy, 1 / 1.3)
}
function resetZoom() {
  if (svgSel) svgSel.transition().duration(400).call(zoomBehavior.transform, zoomIdentity)
}

// ===== Build / clear handlers =====
async function handleBuild() {
  const docIds = selectedDocIds.value.length
    ? [...selectedDocIds.value].filter(id => docsStore.documents.some(d => d.id === id))
    : docsStore.documents.map(d => d.id)
  if (!docIds.length) {
    uiStore.toast('没有可用文档，请先导入文档', 'error')
    return
  }
  try {
    expandedNodes.value = new Set() // Reset expand state for fresh build
    nodePositionMap = {} // Clear cached positions
    await graphStore.build(docIds)
    await nextTick()
    renderGraph()
    // 修复：重建后重置缩放和平移状态，避免停留在旧视图位置
    if (svgSel) svgSel.transition().duration(400).call(zoomBehavior.transform, zoomIdentity)
  } catch (e) {
    console.error('Build graph failed:', e)
    uiStore.toast('图谱构建失败: ' + (e.message || '未知错误'), 'error')
  }
}

function handleClear() {
  uiStore.showConfirm({
    title: '清空图谱',
    message: '确定清空当前知识图谱吗？所有节点和关系将被删除，此操作不可恢复。',
    confirmText: '清空',
    cancelText: '取消',
    onConfirm: async () => {
      try {
        expandedNodes.value = new Set()
        nodePositionMap = {}
        await graphStore.clearGraph()
        clearGraph()
        uiStore.toast('图谱已清空', 'success')
      } catch (e) {
        uiStore.toast('清空图谱失败: ' + (e.message || e), 'error')
      }
    },
  })
}

// ===== Add node =====
function handleAddNode() {
  editDialog.value = {
    show: true,
    isNew: true,
    nodeId: null,
    label: '',
    type: 'entity',
    docId: docsStore.documents[0]?.id || ''
  }
  nextTick(() => {
    editInputRef.value?.focus()
  })
}

// ===== Context menu handlers =====
function handleContextEdit() {
  const node = contextMenu.value.node
  if (!node) return
  contextMenu.value.show = false
  editDialog.value = {
    show: true,
    isNew: false,
    nodeId: node.id,
    label: node.content || node.label || node.name || '',
    type: node.type || 'entity',
    docId: node.source?.docId || node.meta?.docId || ''
  }
  nextTick(() => {
    editInputRef.value?.focus()
  })
}

function handleContextDelete() {
  const node = contextMenu.value.node
  if (!node) return
  contextMenu.value.show = false

  uiStore.showConfirm({
    title: '删除节点',
    message: `确定删除「${node.content || node.label || node.name || node.id}」吗？此操作不可恢复。`,
    confirmText: '删除',
    cancelText: '取消',
    onConfirm: async () => {
      try {
        await graphApi.deleteNode(node.id)
        await graphStore.loadGraph()
        uiStore.toast('节点已删除', 'success')
      } catch (e) {
        uiStore.toast('删除节点失败: ' + (e.message || e), 'error')
      }
    },
  })
}

// ===== Edit dialog =====
function closeEditDialog() {
  editDialog.value.show = false
}

async function saveEditDialog() {
  const { isNew, nodeId, label, type, docId } = editDialog.value
  if (!label.trim()) {
    uiStore.toast('节点名称不能为空', 'error')
    return
  }

  try {
    if (isNew) {
      await graphApi.createNode({
        content: label.trim(),
        type,
        source: docId ? { docId } : undefined
      })
      uiStore.toast('节点已添加', 'success')
    } else {
      await graphApi.updateNode({
        id: nodeId,
        content: label.trim(),
        type,
        source: docId ? { docId } : {}
      })
      uiStore.toast('节点已更新', 'success')
    }
    closeEditDialog()
    await graphStore.loadGraph()
  } catch (e) {
    uiStore.toast(isNew ? '添加节点失败: ' + (e.message || e) : '更新节点失败: ' + (e.message || e), 'error')
  }
}

// ===== Resize handling =====
function handleResize() {
  if (!simulation || !canvasRef.value) return
  const width = canvasRef.value.clientWidth || 900
  const height = canvasRef.value.clientHeight || 620
  simulation.force('center', forceCenter(width / 2, height / 2))
  simulation.alpha(0.3).restart()
}

// ===== Expand all / Collapse all =====
function expandAll() {
  const all = new Set()
  for (const id of rootNodes) {
    if (nodeChildrenMap[id]?.length) all.add(id)
  }
  // Also expand all non-root nodes that have children
  for (const id of Object.keys(nodeChildrenMap)) {
    if (nodeChildrenMap[id].length) all.add(id)
  }
  expandedNodes.value = all
  rebuildVisibility()
}

function collapseAll() {
  expandedNodes.value = new Set()
  rebuildVisibility()
}

// ===== Watchers =====
watch(
  [() => graphStore.nodes, () => graphStore.edges],
  () => { nextTick(renderGraph) }
)
// ===== Watch for external selection changes (e.g., from left panel) =====
watch(
  () => graphStore.selectedNode,
  (node) => {
    if (!node) { updateSelection(); highlight(null); return }
    // If the selected node is hidden (collapsed), expand its parent chain
    if (!visibleNodeIds.has(node.id) && nodeParentMap[node.id]) {
      const chain = []
      let cur = nodeParentMap[node.id]
      while (cur) {
        chain.push(cur)
        cur = nodeParentMap[cur] || null
      }
      const s = new Set(expandedNodes.value)
      for (const id of chain) s.add(id)
      expandedNodes.value = s
      rebuildVisibility()
      // After rebuild, update selection + highlight neighbors
      nextTick(() => { updateSelection(); highlight(null) })
    } else {
      updateSelection()
      highlight(null)  // highlight() will pick up the selected node via effectiveNode
    }
  }
)

// ===== 菜单远程命令（缩放/适配）=====
watch(
  () => uiStore.graphCommand,
  (cmd) => {
    if (!cmd) return
    if (cmd.action === 'zoomIn') zoomIn()
    else if (cmd.action === 'zoomOut') zoomOut()
    else if (cmd.action === 'reset') resetZoom()
  }
)

// ===== 主题切换时重新渲染图谱（D3 颜色从 CSS 变量获取）=====
watch(
  () => uiStore.theme,
  () => {
    if (graphStore.nodes.length) {
      nextTick(() => renderGraph())
    }
  }
)

// Close context menu on escape
function handleKeyDown(e) {
  if (e.key === 'Escape') {
    contextMenu.value.show = false
    editDialog.value.show = false
  }
}

// ===== Lifecycle =====
onMounted(() => {
  if (!docsStore.documents.length) docsStore.load()
  initSvg()
  if (graphStore.nodes.length) buildGraph()
  if (canvasRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(canvasRef.value)
  }
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  // 点击页面其他区域时关闭右键菜单
  document.addEventListener('click', closeContextMenuOnOutside)
})

onBeforeUnmount(() => {
  // 修复：彻底清理 simulation 监听器和引用
  if (simulation) {
    simulation.on('tick', null)
    simulation.stop()
    simulation = null
  }
  if (resizeObserver) resizeObserver.disconnect()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', closeContextMenuOnOutside)
})

function closeContextMenuOnOutside() {
  if (contextMenu.value.show) contextMenu.value.show = false
}
</script>

<style scoped>
.graph-view {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-deep);
}

/* ===== Toolbar ===== */
.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 10px;
}
.toolbar-left { flex: 1; min-width: 0; }

.doc-select-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.select-label {
  font-size: 11px;
  color: var(--text-3);
  margin: 0;
  font-weight: 500;
}
.doc-select {
  width: 180px;
  height: 58px;
  padding: 4px 6px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  resize: none;
}
.doc-select:focus { outline: none; border-color: var(--accent); }
.doc-select option { padding: 3px 6px; }

.btn--build { font-weight: 600; }
.btn--build .spinner { width: 12px; height: 12px; border-width: 2px; }
.btn--add {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}

.btn--expand {
  background: rgba(6, 182, 212, 0.08);
  color: var(--cyan);
  border: 1px solid rgba(6, 182, 212, 0.18);
}
.btn--expand:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.18);
  border-color: rgba(6, 182, 212, 0.3);
}

.btn--collapse {
  background: rgba(245, 158, 11, 0.08);
  color: var(--amber);
  border: 1px solid rgba(245, 158, 11, 0.18);
}
.btn--collapse:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.3);
}

.btn--legend {
  background: rgba(139, 92, 246, 0.08);
  color: var(--violet);
  border: 1px solid rgba(139, 92, 246, 0.18);
}
.btn--legend:hover {
  background: rgba(139, 92, 246, 0.18);
  border-color: rgba(139, 92, 246, 0.3);
}

/* ===== Stats chips ===== */
.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 12px;
}
.stat-dot { width: 7px; height: 7px; border-radius: 50%; }
.stat-dot--node { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
.stat-dot--edge { background: var(--violet); box-shadow: 0 0 6px var(--violet); }
.stat-label { color: var(--text-3); }
.stat-value { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ===== Zoom controls ===== */
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.zoom-btn {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-2); border-radius: 4px;
  transition: all 0.15s;
}
.zoom-btn:hover { color: var(--text); background: var(--bg-hover); }
.zoom-level {
  min-width: 42px; text-align: center;
  font-size: 11px; color: var(--text-2);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}

/* ===== Build progress ===== */
.build-progress {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 14px 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.progress-content { display: flex; align-items: center; gap: 14px; min-width: 280px; }
.progress-ring { display: flex; align-items: center; justify-content: center; }
.spinner--lg { width: 22px; height: 22px; border-width: 3px; }
.progress-text { flex: 1; }
.progress-title { font-size: 13px; color: var(--text); margin-bottom: 6px; font-weight: 500; }
.progress-bar {
  height: 4px; width: 100%;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--violet));
  border-radius: 2px;
  transition: width 0.4s ease;
}

.progress-percent {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-top: 4px;
}

.progress-log {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== Canvas ===== */
.graph-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-void);
}
.graph-svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
.graph-svg:active { cursor: grabbing; }

/* node styling */
.node { cursor: pointer; transition: opacity 0.2s; }
.node:active { cursor: grabbing; }
.node-rect { transition: stroke 0.2s, stroke-width 0.2s, fill-opacity 0.2s; }
.node-text {
  font-family: var(--font);
  pointer-events: none;
  user-select: none;
}
.expand-badge circle { transition: fill 0.2s; }
.expand-badge:hover circle { fill-opacity: 1; }

/* ===== Legend ===== */
.graph-legend {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  pointer-events: auto;
  max-width: 200px;
}
.legend-close {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-3);
  font-size: 16px;
  line-height: 1;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.legend-close:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.legend-title {
  color: var(--text-3);
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-size: 10px;
}
.legend-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.legend-subtitle {
  color: var(--text-3);
  font-size: 10px;
  font-weight: 500;
}
.legend-item { display: flex; align-items: center; gap: 7px; }
.legend-color { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.legend-label { color: var(--text-2); }
.legend-size-demo { gap: 4px; }
.legend-interactions { border-top: 1px solid var(--border); padding-top: 6px; }

/* ===== Empty state ===== */
.graph-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: var(--text-3);
}
.graph-empty svg { opacity: 0.3; margin-bottom: 14px; }
.empty-title { font-size: 15px; color: var(--text-2); font-weight: 500; }
.empty-hint { font-size: 12px; color: var(--text-3); margin-top: 4px; }

/* ===== Edit Dialog ===== */
.edit-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.edit-dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.edit-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.edit-dialog-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.edit-dialog-close {
  background: none;
  border: none;
  font-size: 22px;
  color: var(--text-3);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.edit-dialog-close:hover { color: var(--text); }
.edit-dialog-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.edit-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.edit-field label {
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
}
.edit-field input,
.edit-field select {
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}
.edit-field input:focus,
.edit-field select:focus {
  outline: none;
  border-color: var(--accent);
}
.edit-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}

/* ===== Context Menu ===== */
.context-menu {
  position: absolute;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 50;
  min-width: 140px;
  overflow: hidden;
}
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s;
}
.context-menu-item:hover {
  background: var(--bg-hover);
}
.context-menu-item--danger {
  color: var(--rose);
}
.context-menu-item--danger:hover {
  background: rgba(244, 63, 94, 0.1);
}
</style>
