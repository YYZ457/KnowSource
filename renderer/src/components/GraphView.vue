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
        >
          <span v-if="graphStore.building" class="spinner"></span>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {{ graphStore.building ? '构建中...' : '构建图谱' }}
        </button>
        <button class="btn btn--sm" @click="handleClear" :disabled="graphStore.building || !graphStore.nodes.length">
          清空
        </button>
      </div>

      <div class="toolbar-section toolbar-right">
        <div class="stat-chip">
          <span class="stat-dot stat-dot--node"></span>
          <span class="stat-label">节点</span>
          <span class="stat-value">{{ graphStore.nodes.length }}</span>
        </div>
        <div class="stat-chip">
          <span class="stat-dot stat-dot--edge"></span>
          <span class="stat-label">关系</span>
          <span class="stat-value">{{ graphStore.edges.length }}</span>
        </div>
        <div class="zoom-controls">
          <button class="zoom-btn" @click="zoomIn" title="放大">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <span class="zoom-level">{{ Math.round(currentZoom * 100) }}%</span>
          <button class="zoom-btn" @click="zoomOut" title="缩小">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="zoom-btn" @click="resetZoom" title="重置视图">
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
            <div class="progress-bar"><div class="progress-bar-fill"></div></div>
          </div>
        </div>
      </div>
    </transition>

    <!-- ===== Graph Canvas ===== -->
    <div class="graph-canvas" ref="canvasRef">
      <svg ref="svgRef" class="graph-svg">
        <defs>
          <filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="node-glow-strong" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="bg-radial" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="rgba(6,182,212,0.05)" />
            <stop offset="60%" stop-color="rgba(139,92,246,0.02)" />
            <stop offset="100%" stop-color="transparent" />
          </radialGradient>
        </defs>
        <rect class="graph-bg" width="100%" height="100%" fill="url(#bg-radial)" />
        <g ref="mainGRef" class="main-g"></g>
      </svg>

      <!-- Legend -->
      <div v-if="graphStore.nodes.length" class="graph-legend">
        <div class="legend-title">节点类型</div>
        <div class="legend-item" v-for="t in legendTypes" :key="t.type">
          <span class="legend-dot" :style="{ background: t.color, boxShadow: `0 0 8px ${t.color}` }"></span>
          <span class="legend-label">{{ t.label }}</span>
        </div>
      </div>
    </div>

    <!-- ===== Empty State ===== -->
    <transition name="fade">
      <div v-if="!graphStore.nodes.length && !graphStore.building" class="empty-state graph-empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="5" cy="19" r="2.2" />
          <circle cx="19" cy="19" r="2.2" />
          <line x1="12" y1="7.2" x2="5.8" y2="16.8" />
          <line x1="12" y1="7.2" x2="18.2" y2="16.8" />
          <line x1="6.8" y1="19" x2="17.2" y2="19" stroke-dasharray="1.5 1.5" />
        </svg>
        <p class="empty-title">暂无知识图谱数据</p>
        <p class="empty-hint">选择上方文档并点击「构建图谱」生成可视化</p>
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
import { useGraphStore, useDocsStore } from '../stores'

const graphStore = useGraphStore()
const docsStore = useDocsStore()

// ===== Type → color mapping (matches main.css palette) =====
const TYPE_COLORS = {
  concept: '#06b6d4',   // cyan  (--accent)
  method: '#8b5cf6',    // violet(--violet)
  theorem: '#f59e0b',   // amber (--warm)
  term: '#10b981',      // emerald(--emerald)
  entity: '#06b6d4',    // cyan  — 后端 unsupervised 提取的实体节点
  document: '#64748b',  // slate — 文档节点
  idea: '#f43f5e',      // rose  — 灵感节点
  other: '#f43f5e',     // rose  (--rose)
}
const TYPE_LABELS = {
  concept: '概念',
  method: '方法',
  theorem: '定理',
  term: '术语',
  entity: '实体',
  document: '文档',
  idea: '灵感',
  other: '其他',
}
const legendTypes = [
  { type: 'entity', color: TYPE_COLORS.entity, label: TYPE_LABELS.entity },
  { type: 'document', color: TYPE_COLORS.document, label: TYPE_LABELS.document },
  { type: 'idea', color: TYPE_COLORS.idea, label: TYPE_LABELS.idea },
  { type: 'concept', color: TYPE_COLORS.concept, label: TYPE_LABELS.concept },
  { type: 'method', color: TYPE_COLORS.method, label: TYPE_LABELS.method },
  { type: 'other', color: TYPE_COLORS.other, label: TYPE_LABELS.other },
]

function colorFor(node) {
  return TYPE_COLORS[node.type] || TYPE_COLORS.other
}
function radiusFor(node) {
  const s = Number(node.specificity ?? node.weight ?? 0.5)
  const clamped = Math.max(0, Math.min(1, isNaN(s) ? 0.5 : s))
  return 6 + clamped * 12
}
function widthFor(edge) {
  const w = Number(edge.weight ?? 0.5)
  const clamped = Math.max(0, Math.min(1, isNaN(w) ? 0.5 : w))
  return 1 + clamped * 3
}

// ===== Refs / state =====
const svgRef = ref(null)
const mainGRef = ref(null)
const canvasRef = ref(null)
const selectedDocIds = ref([])
const currentZoom = ref(1)

let svgSel = null
let mainG = null
let simulation = null
let zoomBehavior = null
let linkSel = null
let nodeSel = null
let labelSel = null
let resizeObserver = null
let currentNodes = []
let currentLinks = []

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
}

// ===== Build the graph =====
function buildGraph() {
  if (!mainG) initSvg()
  if (!mainG) return

  // Stop any previous simulation
  if (simulation) { simulation.stop(); simulation = null }

  // Clone nodes so D3 can attach x/y/vx/vy without mutating the store
  currentNodes = graphStore.nodes.map(d => ({ ...d }))
  const nodeById = new Map(currentNodes.map(n => [n.id, n]))
  currentLinks = graphStore.edges
    .map(e => ({
      ...e,
      source: nodeById.get(e.source) || e.source,
      target: nodeById.get(e.target) || e.target,
    }))
    .filter(l => l.source && l.target && typeof l.source === 'object' && typeof l.target === 'object')

  mainG.selectAll('*').remove()

  const width = canvasRef.value ? canvasRef.value.clientWidth || 900 : 900
  const height = canvasRef.value ? canvasRef.value.clientHeight || 620 : 620

  // --- Edges ---
  const linkGroup = mainG.append('g').attr('class', 'links')
  linkSel = linkGroup.selectAll('line')
    .data(currentLinks)
    .join('line')
    .attr('class', 'edge')
    .attr('stroke', 'rgba(148,163,184,0.55)')
    .attr('stroke-width', d => widthFor(d))
    .attr('stroke-opacity', 0.7)
    .attr('stroke-linecap', 'round')

  // --- Nodes ---
  const nodeGroup = mainG.append('g').attr('class', 'nodes')
  nodeSel = nodeGroup.selectAll('g.node')
    .data(currentNodes, d => d.id)
    .join('g')
    .attr('class', 'node')

  // outer glow halo
  nodeSel.append('circle')
    .attr('class', 'node-halo')
    .attr('r', d => radiusFor(d) + 7)
    .attr('fill', d => colorFor(d))
    .attr('opacity', 0.16)
    .attr('filter', 'url(#node-glow)')

  // main body
  nodeSel.append('circle')
    .attr('class', 'node-body')
    .attr('r', d => radiusFor(d))
    .attr('fill', d => colorFor(d))
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => colorFor(d))
    .attr('stroke-width', 1.5)

  // bright inner core
  nodeSel.append('circle')
    .attr('class', 'node-core')
    .attr('r', d => Math.max(2, radiusFor(d) * 0.32))
    .attr('fill', '#ffffff')
    .attr('opacity', 0.92)

  // --- Labels ---
  const labelGroup = mainG.append('g').attr('class', 'labels')
  labelSel = labelGroup.selectAll('text')
    .data(currentNodes, d => d.id)
    .join('text')
    .attr('class', 'node-label')
    .attr('text-anchor', 'middle')
    .attr('dy', d => radiusFor(d) + 15)
    .attr('font-size', 11)
    .attr('fill', '#cbd5e1')
    .attr('pointer-events', 'none')
    .text(d => truncate(d.label || d.name || d.id || '', 18))

  // --- Drag ---
  nodeSel.call(
    drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
  )

  // --- Interactions: click / hover ---
  nodeSel
    .on('click', (event, d) => {
      event.stopPropagation()
      const original = graphStore.nodes.find(n => n.id === d.id) || d
      graphStore.selectedNode = original
      updateSelection()
    })
    .on('mouseenter', (event, d) => {
      highlight(d)
    })
    .on('mouseleave', () => {
      highlight(null)
    })

  // background click → deselect
  svgSel.on('click', () => {
    graphStore.selectedNode = null
    updateSelection()
  })

  // --- Force simulation ---
  simulation = forceSimulation(currentNodes)
    .force(
      'link',
      forceLink(currentLinks)
        .id(d => d.id)
        .distance(d => 55 + widthFor(d) * 18)
        .strength(0.25)
    )
    .force('charge', forceManyBody().strength(-240))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collide',
      forceCollide().radius(d => radiusFor(d) + 13).strength(0.9)
    )

  simulation.on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`)
    labelSel.attr('x', d => d.x).attr('y', d => d.y)
  })

  // apply initial selection highlight
  updateSelection()
}

function truncate(str, n) {
  const s = String(str)
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ===== Highlight connected sub-graph on hover =====
function highlight(node) {
  if (!nodeSel) return

  if (!node) {
    nodeSel.transition().duration(180).attr('opacity', 1)
    nodeSel.select('.node-halo')
      .transition().duration(180)
      .attr('opacity', d => (graphStore.selectedNode && d.id === graphStore.selectedNode.id ? 0.45 : 0.16))
    nodeSel.select('.node-body')
      .transition().duration(180)
      .attr('fill-opacity', 0.85)
    labelSel.transition().duration(180).attr('opacity', 1)
    linkSel
      .transition().duration(180)
      .attr('stroke-opacity', 0.7)
      .attr('stroke', 'rgba(148,163,184,0.55)')
    return
  }

  const neighborIds = new Set([node.id])
  currentLinks.forEach(l => {
    const s = l.source.id ?? l.source
    const t = l.target.id ?? l.target
    if (s === node.id) neighborIds.add(t)
    if (t === node.id) neighborIds.add(s)
  })

  nodeSel
    .transition().duration(180)
    .attr('opacity', d => (neighborIds.has(d.id) ? 1 : 0.18))

  nodeSel.select('.node-halo')
    .transition().duration(180)
    .attr('opacity', d => (neighborIds.has(d.id) ? 0.5 : 0.05))

  labelSel
    .transition().duration(180)
    .attr('opacity', d => (neighborIds.has(d.id) ? 1 : 0.12))

  linkSel
    .transition().duration(180)
    .attr('stroke-opacity', l => {
      const s = l.source.id ?? l.source
      const t = l.target.id ?? l.target
      return s === node.id || t === node.id ? 0.95 : 0.06
    })
    .attr('stroke', l => {
      const s = l.source.id ?? l.source
      const t = l.target.id ?? l.target
      return s === node.id || t === node.id ? colorFor(node) : 'rgba(148,163,184,0.2)'
    })
}

// ===== Selection ring =====
function updateSelection() {
  if (!nodeSel) return
  const selId = graphStore.selectedNode ? graphStore.selectedNode.id : null
  nodeSel.select('.node-body')
    .attr('stroke', d => (d.id === selId ? '#ffffff' : colorFor(d)))
    .attr('stroke-width', d => (d.id === selId ? 3 : 1.5))
    .attr('filter', d => (d.id === selId ? 'url(#node-glow-strong)' : null))
  nodeSel.select('.node-halo')
    .attr('opacity', d => (d.id === selId ? 0.55 : 0.16))
    .attr('filter', d => (d.id === selId ? 'url(#node-glow-strong)' : 'url(#node-glow)'))
}

// ===== Clear =====
function clearGraph() {
  if (simulation) { simulation.stop(); simulation = null }
  if (mainG) mainG.selectAll('*').remove()
  nodeSel = null
  linkSel = null
  labelSel = null
  currentNodes = []
  currentLinks = []
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
    ? [...selectedDocIds.value]
    : docsStore.documents.map(d => d.id)
  if (!docIds.length) return
  try {
    await graphStore.build(docIds)
    await nextTick()
    renderGraph()
  } catch (e) {
    console.error('Build graph failed:', e)
  }
}

async function handleClear() {
  await graphStore.clearGraph()
  clearGraph()
}

// ===== Resize handling =====
function handleResize() {
  if (!simulation || !canvasRef.value) return
  const width = canvasRef.value.clientWidth || 900
  const height = canvasRef.value.clientHeight || 620
  simulation.force('center', forceCenter(width / 2, height / 2))
  simulation.alpha(0.3).restart()
}

// ===== Watchers =====
watch(
  [() => graphStore.nodes, () => graphStore.edges],
  () => { nextTick(renderGraph) }
)
watch(() => graphStore.selectedNode, () => { updateSelection() })

// ===== Lifecycle =====
onMounted(() => {
  // ensure documents are loaded for the select
  if (!docsStore.documents.length) docsStore.load()
  initSvg()
  if (graphStore.nodes.length) buildGraph()
  if (canvasRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(canvasRef.value)
  }
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  if (simulation) simulation.stop()
  if (resizeObserver) resizeObserver.disconnect()
  window.removeEventListener('resize', handleResize)
})
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
  z-index: 5;
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
  width: 220px;
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
  height: 100%; width: 40%;
  background: linear-gradient(90deg, var(--accent), var(--violet));
  border-radius: 2px;
  animation: progress-slide 1.4s ease-in-out infinite;
}
@keyframes progress-slide {
  0% { transform: translateX(-100%); width: 40%; }
  50% { width: 70%; }
  100% { transform: translateX(250%); width: 40%; }
}

/* ===== Canvas ===== */
.graph-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 20% 10%, rgba(6,182,212,0.05) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(139,92,246,0.05) 0%, transparent 50%),
    var(--bg-void);
}
.graph-svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
.graph-svg:active { cursor: grabbing; }
.graph-bg { pointer-events: all; }

/* node styling */
.node { cursor: grab; transition: opacity 0.2s; }
.node:active { cursor: grabbing; }
.node-halo { transition: opacity 0.2s; }
.node-body { transition: stroke 0.2s, stroke-width 0.2s; }
.node-label {
  font-family: var(--font);
  pointer-events: none;
  user-select: none;
  paint-order: stroke;
  stroke: var(--bg-void);
  stroke-width: 3px;
  stroke-linejoin: round;
}

/* ===== Legend ===== */
.graph-legend {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  pointer-events: none;
}
.legend-title {
  color: var(--text-3);
  font-weight: 600;
  margin-bottom: 2px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-size: 10px;
}
.legend-item { display: flex; align-items: center; gap: 7px; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.legend-label { color: var(--text-2); }

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
</style>
