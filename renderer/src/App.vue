<template>
  <div class="app-root" :data-theme="uiStore.theme">
    <!-- ===== Top Bar ===== -->
    <header class="topbar">
      <div class="topbar__brand">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="url(#logoGrad)" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="3" fill="url(#logoGrad)"/>
          <defs><linearGradient id="logoGrad" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#06b6d4"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
        </svg>
        <div class="topbar__brand-name"><span>知源</span> KnowSource</div>
      </div>

      <!-- Primary Navigation: 3 workflow views -->
      <nav class="topbar__nav">
        <button class="nav-btn" :class="{ 'nav-btn--active': uiStore.activeView === 'documents' }" @click="uiStore.setView('documents')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
          文献
        </button>
        <button class="nav-btn" :class="{ 'nav-btn--active': uiStore.activeView === 'graph' }" @click="uiStore.setView('graph')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-5 6M12 11l5 6"/></svg>
          图谱
        </button>
        <button class="nav-btn" :class="{ 'nav-btn--active': uiStore.activeView === 'idea' }" @click="uiStore.setView('idea')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>
          灵感
        </button>
      </nav>

      <!-- Search + Settings + Theme -->
      <div class="topbar__actions">
        <div class="topbar__search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input class="topbar__search" v-model="uiStore.searchQuery" placeholder="搜索知识..." @focus="uiStore.searchOpen = true" @blur="delayCloseSearch" @keyup.enter="doSearch">
        </div>
        <SearchPanel v-if="uiStore.searchOpen" @close="uiStore.searchOpen = false" />
        <button class="icon-btn" @click="uiStore.openSettings('model')" title="设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="uiStore.toggleTheme" :title="uiStore.theme === 'dark' ? '切换亮色' : '切换暗色'">
          <svg v-if="uiStore.theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
        </button>
      </div>
    </header>

    <!-- ===== Main Content — 统一两栏布局 ===== -->
    <main class="main-content">
      <Splitpanes class="default-theme" @resize="onResize">
        <!-- Left Pane: 上下文侧边栏（随视图切换内容） -->
        <Pane :size="leftPaneSize" :min-size="15" :max-size="45">
          <div class="pane-content">
            <FileExplorer v-if="uiStore.activeView === 'documents'" />
            <GraphNodeTree v-else-if="uiStore.activeView === 'graph'" />
            <IdeaPanel v-else-if="uiStore.activeView === 'idea'" :list-only="true" />
          </div>
        </Pane>

        <!-- Center Pane: 主内容区 -->
        <Pane :size="100 - leftPaneSize">
          <div class="pane-content pane-center">
            <Editor v-if="uiStore.activeView === 'documents'" />
            <GraphView v-else-if="uiStore.activeView === 'graph'" />
            <IdeaPanel v-else-if="uiStore.activeView === 'idea'" :editor-only="true" />
          </div>
        </Pane>
      </Splitpanes>
    </main>

    <!-- ===== Settings Overlay ===== -->
    <SettingsOverlay />

    <!-- ===== Onboarding Tour ===== -->
    <OnboardingTour ref="onboardingRef" />

    <!-- ===== Global: Toasts ===== -->
    <div class="toast-container">
      <div v-for="t in uiStore.toasts" :key="t.id" class="toast" :class="`toast--${t.type}`">{{ t.message }}</div>
    </div>

    <!-- ===== Global: Confirm Dialog ===== -->
    <div v-if="uiStore.confirmDialog" class="dialog-overlay" @click.self="uiStore.closeConfirm()">
      <div class="dialog">
        <h3>{{ uiStore.confirmDialog.title }}</h3>
        <p>{{ uiStore.confirmDialog.message }}</p>
        <div class="dialog__actions">
          <button class="btn" @click="uiStore.closeConfirm()">{{ uiStore.confirmDialog.cancelText || '取消' }}</button>
          <button class="btn btn--primary" v-if="uiStore.confirmDialog.confirmText" @click="handleConfirm">{{ uiStore.confirmDialog.confirmText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import { useUiStore, useDocsStore, useGraphStore, usePromptStore, useModelStore, useIdeaStore, useProjectStore } from './stores'
import { searchApi } from './api/client'
import FileExplorer from './components/FileExplorer.vue'
import Editor from './components/Editor.vue'
import GraphView from './components/GraphView.vue'
import GraphNodeTree from './components/GraphNodeTree.vue'
import IdeaPanel from './components/IdeaPanel.vue'
import SearchPanel from './components/SearchPanel.vue'
import SettingsOverlay from './components/SettingsOverlay.vue'
import OnboardingTour from './components/OnboardingTour.vue'

const uiStore = useUiStore()
const onboardingRef = ref(null)
const docsStore = useDocsStore()
const graphStore = useGraphStore()

// 暴露 uiStore 给 OnboardingTour 组件用于切换视图
window.__ksUiStore = uiStore
window.__ksDocStore = docsStore
const promptStore = usePromptStore()
const modelStore = useModelStore()
const ideaStore = useIdeaStore()
const projectStore = useProjectStore()

const leftPaneSize = ref(28)

function onResize(event) {
  if (event[0]) leftPaneSize.value = event[0].size
}

let searchCloseTimer = null
function delayCloseSearch() {
  clearTimeout(searchCloseTimer)
  searchCloseTimer = setTimeout(() => { uiStore.searchOpen = false }, 200)
}
async function doSearch() {
  if (!uiStore.searchQuery.trim()) return
  uiStore.searchOpen = true
  uiStore.searching = true
  try {
    const results = await searchApi.search(uiStore.searchQuery)
    uiStore.searchResults = results.results || results || []
  } catch (e) {
    uiStore.toast('搜索失败: ' + e.message, 'error')
  } finally {
    uiStore.searching = false
  }
}

// ===== 确认对话框：异步执行 onConfirm 并捕获错误 =====
async function handleConfirm() {
  const dialog = uiStore.confirmDialog
  if (!dialog) return
  uiStore.closeConfirm() // 先关闭对话框，避免用户重复点击
  if (dialog.onConfirm) {
    try { await dialog.onConfirm() }
    catch (e) { uiStore.toast('操作失败: ' + (e.message || e), 'error') }
  }
}

// ===== 文件类型辅助（与 FileExplorer 保持一致） =====
function getFileType(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  const typeMap = {
    pdf: 'pdf', doc: 'doc', docx: 'docx',
    md: 'md', markdown: 'md', txt: 'txt',
    html: 'html', htm: 'html',
    csv: 'csv', json: 'json',
    ppt: 'ppt', pptx: 'pptx',
    jpg: 'jpg', jpeg: 'jpg', png: 'png',
  }
  return typeMap[ext] || ext || 'txt'
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, len)))
  }
  return btoa(binary)
}

// ===== 菜单 IPC 事件监听 =====
const unsubscribers = []

function setupMenuListeners() {
  const ks = window.KSElectron
  if (!ks) return // Web 模式下无 Electron 桥接

  // 文件 → 打开文件（菜单通过 showOpenDialog 获取路径后发送）
  if (ks.onOpenFile) {
    unsubscribers.push(ks.onOpenFile(async (filePath) => {
      if (!filePath) return
      try {
        const buffer = await ks.readFile(filePath)
        const name = filePath.split(/[\\/]/).pop()
        const content = arrayBufferToBase64(buffer)
        const type = getFileType(name)
        const results = await docsStore.importFiles([{ name, content, type }])
        const successCount = results.length
        if (successCount > 0) {
          uiStore.toast(`已导入: ${name}`, 'success')
        } else {
          uiStore.toast(`导入失败: ${name}`, 'error')
        }
      } catch (e) { uiStore.toast('导入失败: ' + e.message, 'error') }
    }))
  }

  // 偏好设置
  if (ks.onOpenSettings) {
    unsubscribers.push(ks.onOpenSettings(() => uiStore.openSettings('model')))
  }

  // AI → 模型设置
  if (ks.onOpenAISettings) {
    unsubscribers.push(ks.onOpenAISettings(() => uiStore.openSettings('model')))
  }

  // 视图切换（菜单中的"文献"/"知识图谱"/"灵感"）
  if (ks.onSwitchView) {
    unsubscribers.push(ks.onSwitchView((view) => {
      if (view === 'graph' || view === 'idea' || view === 'documents') uiStore.setView(view)
    }))
  }

  // 导出图谱
  if (ks.onExportGraph) {
    unsubscribers.push(ks.onExportGraph(() => {
      uiStore.setView('graph')
      if (!graphStore.nodes.length) {
        uiStore.toast('图谱为空，无法导出', 'error')
        return
      }
      const data = JSON.stringify({
        nodes: graphStore.nodes,
        edges: graphStore.edges,
        exportedAt: new Date().toISOString()
      }, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-graph-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      uiStore.toast(`已导出 ${graphStore.nodes.length} 个节点`, 'success')
    }))
  }

  // 全部清除
  if (ks.onClearAll) {
    unsubscribers.push(ks.onClearAll(() => {
      uiStore.showConfirm({
        title: '清除所有数据',
        message: '这将清除所有文档、图谱和灵感数据，且不可恢复。确定继续吗？',
        confirmText: '清除',
        onConfirm: async () => {
          try {
            await graphStore.clearGraph()
            uiStore.toast('已清除所有图谱数据', 'success')
          } catch (e) { uiStore.toast('清除失败: ' + e.message, 'error') }
        }
      })
    }))
  }

  // 左侧面板切换
  if (ks.onToggleLeftPanel) {
    unsubscribers.push(ks.onToggleLeftPanel(() => {
      leftPaneSize.value = leftPaneSize.value > 5 ? 0 : 28
    }))
  }

  // 缩放图谱
  if (ks.onZoomGraph) {
    unsubscribers.push(ks.onZoomGraph((scale) => {
      uiStore.setView('graph')
      nextTick(() => uiStore.sendGraphCommand(scale > 1 ? 'zoomIn' : 'zoomOut'))
    }))
  }

  // 适配视图
  if (ks.onFitGraph) {
    unsubscribers.push(ks.onFitGraph(() => {
      uiStore.setView('graph')
      nextTick(() => uiStore.sendGraphCommand('reset'))
    }))
  }

  // 显示帮助
  if (ks.onShowHelp) {
    unsubscribers.push(ks.onShowHelp(() => {
      uiStore.openSettings('about')
    }))
  }

  // 后端错误
  if (ks.onBackendError) {
    unsubscribers.push(ks.onBackendError((data) => {
      uiStore.toast('后端服务异常: ' + (data?.message || '未知错误'), 'error')
    }))
  }
}

onMounted(async () => {
  document.documentElement.setAttribute('data-theme', uiStore.theme)
  uiStore.setView('documents')

  // 注册菜单事件
  setupMenuListeners()

  // 并行加载数据
  const loads = [
    docsStore.load().catch((e) => { console.error('docs load:', e); return [] }),
    projectStore.load().catch((e) => { console.error('projects load:', e); return [] }),
    promptStore.load().catch((e) => { console.error('prompts load:', e); return [] }),
    modelStore.load().catch((e) => { console.error('model config load:', e); return null }),
    ideaStore.load().catch((e) => { console.error('ideas load:', e); return [] }),
    graphStore.loadGraph().catch((e) => { console.error('graph load:', e); return null }),
  ]
  const results = await Promise.allSettled(loads)
  // 如果所有加载都失败，提示后端连接问题
  const allFailed = results.every(r => r.status === 'rejected')
  if (allFailed) {
    uiStore.toast('无法连接后端服务，请检查服务是否已启动', 'error')
  }
})

// 确认对话框 Escape 键关闭
function onConfirmKeyDown(e) {
  if (e.key === 'Escape' && uiStore.confirmDialog) {
    uiStore.closeConfirm()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onConfirmKeyDown)
})

onBeforeUnmount(() => {
  // 清理所有 IPC 监听器
  unsubscribers.forEach(fn => { try { fn() } catch (e) {} })
  // 清理搜索关闭定时器
  if (searchCloseTimer) clearTimeout(searchCloseTimer)
  // 清理确认对话框按键监听
  window.removeEventListener('keydown', onConfirmKeyDown)
})

// 视图切换时微调左侧面板宽度
watch(() => uiStore.activeView, (view) => {
  if (view === 'graph') leftPaneSize.value = 25
  else if (view === 'idea') leftPaneSize.value = 30
  else leftPaneSize.value = 28
})
</script>

<style scoped>
.pane-content { height: 100%; overflow-y: auto; padding: 8px; background: var(--bg-void, #0a0e1a); }
.pane-center { display: flex; flex-direction: column; padding: 8px; }

/* 覆盖 Splitpanes default-theme 的浅色背景 */
:deep(.splitpanes.default-theme) { background: var(--bg-void, #0a0e1a); }
:deep(.splitpanes.default-theme .splitpanes__pane) {
  background: var(--bg-void, #0a0e1a);
  box-shadow: none;
}
:deep(.splitpanes.default-theme .splitpanes__splitter) {
  background: var(--border, rgba(255,255,255,0.06));
  border-left: 1px solid var(--bg-void, #0a0e1a);
  border-right: 1px solid var(--bg-void, #0a0e1a);
  width: 3px;
}
:deep(.splitpanes.default-theme .splitpanes__splitter:hover) {
  background: var(--accent, #06b6d4);
}
</style>
