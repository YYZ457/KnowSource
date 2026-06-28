<script setup>
/** App — IDE 主布局：可拖拽三栏 + 底栏 + 新手引导 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useUiStore } from '@/stores/ui';
import { useDocumentStore } from '@/stores/document';
import { useGraphStore } from '@/stores/graph';
import { useIdeaStore } from '@/stores/idea';
import { useProjectStore } from '@/stores/project';
import { useToastStore } from '@/stores/toast';
import { useDialog } from '@/composables/useDialog';
import { setLLMProvider, setKGProvider, createLLMProvider } from '@services/llm-provider';
import { client } from '@/api/client.js';
import { readKGExtractOptions } from '@/utils/kg-options';
import FileExplorer from './components/FileExplorer.vue';
import GraphView from './components/GraphView.vue';
import IdeaPanel from './components/IdeaPanel.vue';
import SearchPanel from './components/SearchPanel.vue';
import LogPanel from './components/LogPanel.vue';
import ToastNotification from './components/ToastNotification.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
// 懒加载非首屏组件：延迟解析/编译，减小首屏 JS 解析开销
const ModelLab = defineAsyncComponent(() => import('./components/ModelLab.vue'));
const PromptLab = defineAsyncComponent(() => import('./components/PromptLab.vue'));
const OnboardingTour = defineAsyncComponent(() => import('./components/OnboardingTour.vue'));
const WelcomeWizard = defineAsyncComponent(() => import('./components/WelcomeWizard.vue'));

const uiStore = useUiStore();
const docStore = useDocumentStore();
const graphStore = useGraphStore();
const ideaStore = useIdeaStore();
const projectStore = useProjectStore();
const toast = useToastStore();
const dialog = useDialog();
const showOnboarding = ref(false);
const showWelcomeWizard = ref(false);
const showHelpModal = ref(false);
const backendError = ref(null); // 后端启动失败时的错误信息
const rebuilding = ref(false); // 重建文档间链接的加载状态

// 主内容区域引用：用于"跳到主内容"快捷链接聚焦
const mainContentRef = ref(null);
const helpModalRef = ref(null);
// 记录打开帮助弹窗前的焦点元素，关闭后恢复焦点
let helpModalPreviousFocus = null;

/** "跳到主内容"快捷链接：将焦点移到主内容区域 */
function focusMainContent() {
  mainContentRef.value?.focus();
}

// 帮助弹窗打开时记录焦点并聚焦弹窗，关闭时恢复焦点
watch(showHelpModal, async (visible) => {
  if (visible) {
    helpModalPreviousFocus = document.activeElement;
    await nextTick();
    const focusable = helpModalRef.value?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  } else {
    nextTick(() => {
      if (helpModalPreviousFocus && typeof helpModalPreviousFocus.focus === 'function') {
        helpModalPreviousFocus.focus();
      }
    });
  }
});

// 帮助弹窗焦点陷阱：Tab 键在弹窗内循环
function onHelpModalKeydown(e) {
  if (!showHelpModal.value || e.key !== 'Tab') return;
  const modal = helpModalRef.value;
  if (!modal) return;
  const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ============ 响应式布局状态 ============
// 跟踪窗口宽度，用于在大/中/小屏幕间切换布局
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const isMobile = computed(() => windowWidth.value <= 768);
// 移动端当前激活的面板：'files' | 'graph' | 'idea' | 'model'
const mobileActivePanel = ref('files');

// ============ 主题（亮色/暗色） ============
// 启动时同步恢复主题偏好（在 setup 阶段同步执行，避免首屏主题闪烁）
try {
  const savedTheme = localStorage.getItem('knowledge-ide-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    uiStore.theme = savedTheme;
  }
} catch {}
// 主题变化时同步到 document.documentElement，确保 Teleport 到 body 的弹窗/通知也继承主题变量
watch(() => uiStore.theme, (theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}, { immediate: true });

// 防抖定时器句柄：resize 事件触发非常频繁（每帧多次），直接更新响应式状态会导致
// 大量无意义的 re-render。防抖 150ms 后只在拖拽停顿时更新一次。
let resizeTimer = null;
function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    windowWidth.value = window.innerWidth;
  }, 150);
}

/** 移动端切换面板时同步右栏 Tab 状态 */
function setMobilePanel(panel) {
  mobileActivePanel.value = panel;
  if (panel !== 'files') {
    uiStore.setRightTab(panel);
  }
}

// 右栏 Tab 对应的组件映射：配合 <KeepAlive> 缓存组件实例，避免 v-if 切换时销毁重建丢失状态
const rightTabComponent = computed(() => {
  const map = { graph: GraphView, idea: IdeaPanel, model: ModelLab, prompts: PromptLab };
  return map[uiStore.rightTab] || null;
});

function startOnboarding() {
  showOnboarding.value = true;
}

function finishOnboarding() {
  showOnboarding.value = false;
  try {
    localStorage.setItem('knowledge-ide-onboarded', 'true');
  } catch {}
}

function onWizardDone() {
  showWelcomeWizard.value = false;
  try {
    localStorage.setItem('knowsource-initialized', 'true');
  } catch {}
  // 向导完成后触发新手导览（如果尚未看过）
  const hasOnboarded = (() => {
    try {
      return localStorage.getItem('knowledge-ide-onboarded') === 'true';
    } catch {
      return true;
    }
  })();
  if (!hasOnboarded) {
    showOnboarding.value = true;
  }
}

function openIdeaPanel() {
  if (uiStore.rightTab === 'idea' && uiStore.rightPanelVisible) {
    uiStore.toggleRightPanel();
  } else {
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
    uiStore.setRightTab('idea');
  }
}

function openSettings() {
  uiStore.setRightTab('model');
  if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
}

function openModelLab() {
  uiStore.setRightTab('model');
  if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
}

async function importFileFromPath(filePath) {
  if (!filePath) return;
  try {
    const buffer = await window.KSElectron.readFile(filePath);
    const name = filePath.replace(/\\/g, '/').split('/').pop();
    const ext = name.split('.').pop().toLowerCase();
    const type = ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'docx' : ext === 'pptx' ? 'pptx' : (ext === 'md' || ext === 'markdown') ? 'markdown' : ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext) ? 'image' : 'text';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const doc = await docStore.importDocument(name, base64, type);
    // 导入成功后为新文档构建知识图谱，补全端到端管线
    if (doc && doc.meta && doc.meta.docId) {
      try {
        const extractOptions = readKGExtractOptions();
        await graphStore.buildGraph(extractOptions, [doc.meta.docId]);
      } catch (buildErr) {
        console.error('导入后构建图谱失败:', buildErr);
        toast.error('文档已导入，但图谱构建失败: ' + (buildErr?.message || buildErr));
      }
    }
  } catch (e) {
    console.error('打开文件失败:', e);
    toast.error('打开文件失败: ' + (e.message || e));
  }
}

async function onMenuOpenFile(filePath) {
  // IPC 已传入文件路径时直接导入，避免重复弹出文件对话框
  if (filePath) {
    await importFileFromPath(filePath);
    return;
  }
  try {
    const result = await window.KSElectron.openFileDialog({
      properties: ['openFile'],
      filters: [{ name: '支持的文档', extensions: ['pdf', 'docx', 'pptx', 'md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
    });
    if (!result.canceled && result.filePaths[0]) {
      await importFileFromPath(result.filePaths[0]);
    }
  } catch (e) {
    console.error('选择文件失败:', e);
  }
}

function onMenuExportGraph() {
  // 触发 GraphView 的导出（GraphView 内部会监听此事件）
  window.dispatchEvent(new CustomEvent('app:export-graph'));
}

async function onMenuRebuildCrossLinks() {
  rebuilding.value = true;
  try {
    await graphStore.rebuildCrossLinks();
  } catch (e) {
    console.error('重建跨文档关联失败:', e);
    toast.error(e?.message || '重建跨文档关联失败');
  } finally {
    rebuilding.value = false;
  }
}

async function onMenuClearAll() {
  if (graphStore.building) {
    toast.warning('图谱正在构建中，请等待构建完成后再清空。');
    return;
  }
  const ok = await dialog.confirm('清空确认', '确定要清空所有文档、图谱和 Idea 吗？此操作不可恢复。', { danger: true });
  if (!ok) return;
  try {
    // 先向后端申请一次性确认令牌，拿到后再发起清空，防止 CSRF / 一键误清空
    const tokenRes = await client.getClearToken();
    const result = await client.clearAll(tokenRes?.token);
    if (result && result.error) {
      toast.error(result.error);
      return;
    }
  } catch (e) {
    console.error('后端清除失败:', e);
    toast.error('清除失败，请检查后端服务是否正常运行：' + (e?.message || e));
    return;
  }
  docStore.clear();
  graphStore.clear();
  ideaStore.clear();
}

function onMenuSwitchView(view) {
  if (view === 'graph') {
    uiStore.setRightTab('graph');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  } else if (view === 'idea') {
    uiStore.setRightTab('idea');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  } else if (view === 'model') {
    uiStore.setRightTab('model');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  } else if (view === 'prompts') {
    uiStore.setRightTab('prompts');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  }
}

function toggleLeftPanel() {
  uiStore.toggleLeftPanel();
}

function toggleRightPanel() {
  uiStore.toggleRightPanel();
}

async function restoreProviderConfig(storageKey, setter, clientSetter, ipcName, secureKey = null) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const config = JSON.parse(raw);
    // 兼容旧配置：旧配置使用 provider='openai'，迁移为 openai-compatible + vendor='openai'
    if (config.provider === 'openai') {
      config.provider = 'openai-compatible';
      config.vendor = config.vendor || 'openai';
    }
    // 兼容旧配置：Ollama 默认只监听 IPv4 回环，localhost 可能解析到 IPv6 导致连接失败
    if (config.baseUrl && config.baseUrl.includes('localhost:11434')) {
      config.baseUrl = config.baseUrl.replace('localhost:11434', '127.0.0.1:11434');
    }
    // Electron 环境：API key 存在 secureStore 中，localStorage 中已被剥离，需要单独恢复
    if (secureKey && window.KSElectron?.secureStore && !config.apiKey) {
      try {
        const storedKey = await window.KSElectron.secureStore.get(secureKey);
        if (storedKey) config.apiKey = storedKey;
      } catch {
        // secureStore 读取失败不影响其余配置恢复
      }
    }
    await clientSetter(config);
    const instance = createLLMProvider(config.provider, {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      vendor: config.vendor
    });
    setter(instance);
    if (window.KSElectron?.api?.[ipcName]) {
      await window.KSElectron.api[ipcName](config);
    }
  } catch {
    // ignore restore errors
  }
}

// 注册原生菜单事件监听
const unsubs = [];
onUnmounted(() => {
  unsubs.forEach(fn => fn && fn());
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onHelpModalKeydown, true);
  if (resizeTimer) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
  }
});

onMounted(async () => {
  // 注册窗口尺寸变化监听，用于响应式布局切换
  window.addEventListener('resize', onResize);
  // 注册帮助弹窗焦点陷阱键盘监听
  window.addEventListener('keydown', onHelpModalKeydown, true);

  // 首次启动检查：如果未完成初始化向导，则显示 WelcomeWizard
  const hasInitialized = (() => {
    try {
      return localStorage.getItem('knowsource-initialized') === 'true';
    } catch {
      return true;
    }
  })();
  if (!hasInitialized) {
    showWelcomeWizard.value = true;
  }

  const hasOnboarded = (() => {
    try {
      return localStorage.getItem('knowledge-ide-onboarded') === 'true';
    } catch {
      return true;
    }
  })();
  if (!hasOnboarded && hasInitialized) {
    showOnboarding.value = true;
  }

  // 先加载项目列表，确保后端已初始化默认项目
  await projectStore.loadProjects();

  // 如果没有项目，创建默认项目
  if (projectStore.projects.length === 0) {
    await projectStore.createProject('默认项目');
  }

  // 启动时从后端恢复数据（当前项目的文档、图谱、Idea）
  docStore.loadDocuments();
  graphStore.loadGraph();
  ideaStore.loadIdeas();

  // 恢复 LLM / KG 模型配置（API key 从 secureStore 恢复）
  // 两个配置相互独立，使用 Promise.all 并行执行以加快启动
  await Promise.all([
    restoreProviderConfig('knowledge-ide-llm-config', setLLMProvider, client.setLLMProvider, 'setLLMProvider', 'llm-api-key'),
    restoreProviderConfig('knowledge-ide-kg-config', setKGProvider, client.setKGProvider, 'setKGProvider', 'kg-api-key')
  ]);

  // 注册原生菜单事件监听
  if (window.KSElectron) {
    // 监听后端启动失败事件，显示错误提示避免用户看到空白界面
    unsubs.push(window.KSElectron.onBackendError?.((data) => {
      const port = data?.port || '8000';
      backendError.value = `后端服务启动失败（端口 ${port}），部分功能将不可用。请检查端口是否被占用或重启应用。`;
    }));
    unsubs.push(window.KSElectron.onOpenFile?.(onMenuOpenFile));
    unsubs.push(window.KSElectron.onOpenExamFile?.(onMenuOpenFile));
    unsubs.push(window.KSElectron.onExportGraph?.(onMenuExportGraph));
    unsubs.push(window.KSElectron.onClearAll?.(onMenuClearAll));
    unsubs.push(window.KSElectron.onSwitchView?.(onMenuSwitchView));
    unsubs.push(window.KSElectron.onOpenSettings?.(openSettings));
    unsubs.push(window.KSElectron.onOpenAISettings?.(openModelLab));
    unsubs.push(window.KSElectron.onShowHelp?.(() => { showHelpModal.value = true; }));
    unsubs.push(window.KSElectron.onToggleLeftPanel?.(toggleLeftPanel));
    unsubs.push(window.KSElectron.onToggleRightPanel?.(toggleRightPanel));
    unsubs.push(window.KSElectron.onZoomGraph?.(scale => {
      window.dispatchEvent(new CustomEvent('app:zoom-graph', { detail: scale }));
    }));
    unsubs.push(window.KSElectron.onFitGraph?.(() => {
      window.dispatchEvent(new CustomEvent('app:fit-graph'));
    }));
  }
});

function onMenuShowHelp() {
  showHelpModal.value = true;
}
</script>

<template>
  <div class="ide-app" :class="{ 'is-mobile': isMobile }" :data-theme="uiStore.theme">
    <!-- 跳到主内容快捷链接：键盘用户可快速跳过顶栏导航 -->
    <a href="#main-content" class="skip-link" @click.prevent="focusMainContent">跳到主内容</a>
    <header class="ide-topbar panel-border-glow" role="banner">
      <span class="logo">📘 <span class="logo-text">Knowledge IDE</span></span>
      <nav class="ide-viewbar" aria-label="面板切换">
        <button :class="{active: uiStore.leftPanelVisible}" title="切换左侧面板" aria-label="切换文档面板" @click="uiStore.toggleLeftPanel()">文档</button>
        <button :class="{active: uiStore.rightPanelVisible}" title="切换右侧面板" aria-label="切换知识图谱面板" @click="() => { uiStore.setRightTab('graph'); if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel(); }">知识图谱</button>
        <button :class="{active: uiStore.rightPanelVisible && uiStore.rightTab==='idea'}" title="切换 Idea 面板" aria-label="切换 Idea 面板" @click="openIdeaPanel">Idea</button>
      </nav>
      <SearchPanel />
      <div class="ide-topbar-actions">
        <button class="topbar-btn" :title="uiStore.theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'" :aria-label="uiStore.theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'" @click="uiStore.toggleTheme()">{{ uiStore.theme === 'light' ? '🌙' : '☀️' }}</button>
        <button class="topbar-btn" title="切换日志面板" aria-label="切换日志面板" @click="uiStore.toggleBottomPanel()">📋</button>
        <button class="topbar-btn" title="重建文档间链接" aria-label="重建文档间链接" :disabled="rebuilding" @click="onMenuRebuildCrossLinks">{{ rebuilding ? '重建中...' : '🔗' }}</button>
        <button class="topbar-btn" title="打开 Idea 面板" aria-label="打开 Idea 面板" @click="openIdeaPanel">💡</button>
        <button class="topbar-btn" title="新手引导" aria-label="新手引导" @click="startOnboarding">?</button>
        <button class="topbar-btn" title="使用说明" aria-label="使用说明" @click="onMenuShowHelp">ℹ️</button>
      </div>
    </header>

    <!-- 后端启动失败错误提示 -->
    <Teleport to="body">
      <div v-if="backendError" class="backend-error-overlay">
        <div class="backend-error-banner" role="alert">
          <span class="backend-error-icon" aria-hidden="true">⚠</span>
          <span class="backend-error-text">{{ backendError }}</span>
          <button class="backend-error-close" title="关闭提示" aria-label="关闭提示" @click="backendError = null">×</button>
        </div>
      </div>
    </Teleport>

    <div v-if="docStore.loading" class="skeleton app-loading-bar" role="progressbar" aria-label="加载中" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>

    <!-- ============ 桌面端：Splitpanes 三栏/两栏布局 ============ -->
    <main id="main-content" class="ide-main-content" role="main" tabindex="-1" ref="mainContentRef">
    <Splitpanes v-if="!isMobile" class="default-theme" style="flex: 1; overflow: hidden;">
      <Pane v-if="uiStore.leftPanelVisible" min-size="15" :max-size="uiStore.visiblePanelCount === 1 ? 100 : 70" :size="uiStore.visiblePanelCount === 1 ? 100 : 35">
        <FileExplorer />
      </Pane>
      <Pane v-if="uiStore.rightPanelVisible" min-size="15" :max-size="uiStore.visiblePanelCount === 1 ? 100 : 70" :size="uiStore.visiblePanelCount === 1 ? 100 : 65">
        <div class="ide-right panel-border-glow">
          <div class="right-tabs">
            <button :class="{active: uiStore.rightTab==='graph'}" aria-label="切换到图谱标签" @click="uiStore.setRightTab('graph')">图谱</button>
            <button :class="{active: uiStore.rightTab==='idea'}" aria-label="切换到 Idea 标签" @click="uiStore.setRightTab('idea')">Idea</button>
            <button :class="{active: uiStore.rightTab==='model'}" aria-label="切换到图谱配置标签" @click="uiStore.setRightTab('model')">图谱配置</button>
            <button :class="{active: uiStore.rightTab==='prompts'}" aria-label="切换到提示词实验室标签" @click="uiStore.setRightTab('prompts')">提示词</button>
          </div>
          <!-- 使用 KeepAlive 缓存组件实例：Tab 切换时不销毁重建，保留各面板内部状态 -->
          <KeepAlive>
            <component :is="rightTabComponent" />
          </KeepAlive>
        </div>
      </Pane>
    </Splitpanes>

    <!-- ============ 移动端：单栏布局 + 底部导航 ============ -->
    <template v-else>
      <div class="mobile-panel-container">
        <!-- 文档面板 -->
        <div v-show="mobileActivePanel === 'files'" class="mobile-panel">
          <FileExplorer />
        </div>
        <!-- 右栏面板（图谱/Idea/配置） -->
        <div v-show="mobileActivePanel !== 'files'" class="ide-right panel-border-glow mobile-right-panel">
          <div class="right-tabs">
            <button :class="{active: uiStore.rightTab==='graph'}" aria-label="切换到图谱标签" @click="uiStore.setRightTab('graph'); mobileActivePanel = 'graph'">图谱</button>
            <button :class="{active: uiStore.rightTab==='idea'}" aria-label="切换到 Idea 标签" @click="uiStore.setRightTab('idea'); mobileActivePanel = 'idea'">Idea</button>
            <button :class="{active: uiStore.rightTab==='model'}" aria-label="切换到图谱配置标签" @click="uiStore.setRightTab('model'); mobileActivePanel = 'model'">图谱配置</button>
            <button :class="{active: uiStore.rightTab==='prompts'}" aria-label="切换到提示词实验室标签" @click="uiStore.setRightTab('prompts'); mobileActivePanel = 'prompts'">提示词</button>
          </div>
          <KeepAlive>
            <component :is="rightTabComponent" />
          </KeepAlive>
        </div>
      </div>
      <!-- 移动端底部导航栏 -->
      <nav class="mobile-nav">
        <button :class="{active: mobileActivePanel === 'files'}" aria-label="切换到文档面板" @click="mobileActivePanel = 'files'">
          <span class="nav-icon">📄</span>
          <span>文档</span>
        </button>
        <button :class="{active: mobileActivePanel === 'graph'}" aria-label="切换到图谱面板" @click="setMobilePanel('graph')">
          <span class="nav-icon">🕸️</span>
          <span>图谱</span>
        </button>
        <button :class="{active: mobileActivePanel === 'idea'}" aria-label="切换到 Idea 面板" @click="setMobilePanel('idea')">
          <span class="nav-icon">💡</span>
          <span>Idea</span>
        </button>
        <button :class="{active: mobileActivePanel === 'model'}" aria-label="切换到配置面板" @click="setMobilePanel('model')">
          <span class="nav-icon">⚙️</span>
          <span>配置</span>
        </button>
      </nav>
    </template>

    </main>

    <LogPanel />
    <OnboardingTour v-if="showOnboarding" @finish="finishOnboarding" />
    <WelcomeWizard v-if="showWelcomeWizard" @done="onWizardDone" />

    <!-- 全局 Toast 通知 -->
    <ToastNotification />

    <!-- 全局确认/输入对话框 -->
    <ConfirmDialog />

    <!-- 使用说明弹窗 -->
    <Teleport to="body">
      <div v-if="showHelpModal" class="modal-overlay" @click.self="showHelpModal = false">
        <div class="modal-card help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title" ref="helpModalRef">
          <h3 id="help-modal-title">使用说明</h3>
          <div class="help-body">
            <p><strong>导入文档：</strong>点击左侧面板“导入文件”或顶部菜单 文件 → 打开文件，支持 PDF、Word、PPT、Markdown、图片等。</p>
            <p><strong>查看提取文本：</strong>打开 PDF 后，点击顶部的“提取文本”标签页即可查看 OCR / 文字层解析结果。</p>
            <p><strong>构建知识图谱：</strong>导入文档后，在右侧面板点击“补全图谱”，系统会自动抽取概念、标题和实体。</p>
            <p><strong>编辑节点：</strong>在图谱或右侧节点列表中右键节点，可添加子节点、编辑内容 / 形状 / 颜色 / 大小、删除节点。</p>
            <p><strong>跳转原文：</strong>双击节点（文档/标题/实体）可跳转到对应文档和页码。</p>
            <p><strong>快捷键：</strong>Ctrl/Cmd + O 打开文件；Ctrl/Cmd + 1/2/3 切换右侧面板；Ctrl/Cmd + +/-/0 缩放/适配图谱。</p>
          </div>
          <div class="modal-actions">
            <button class="btn-primary" aria-label="关闭使用说明" @click="showHelpModal = false">知道了</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 跳到主内容快捷链接：默认隐藏，键盘聚焦时可见 */
.skip-link {
  position: absolute;
  top: -100px;
  left: 8px;
  z-index: var(--z-tooltip);
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: top 0.2s;
}
.skip-link:focus {
  top: 8px;
}
.ide-main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  outline: none;
}
.app-loading-bar {
  height: 3px;
  width: 100%;
  flex-shrink: 0;
}
.backend-error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-tooltip);
  display: flex;
  justify-content: center;
  padding: 12px 16px;
  pointer-events: none;
}
.backend-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  color: var(--danger-text);
  font-size: 13px;
  max-width: 600px;
  pointer-events: auto;
}
.backend-error-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.backend-error-text {
  flex: 1;
  line-height: 1.4;
}
.backend-error-close {
  background: transparent;
  border: none;
  color: var(--danger-text);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
}
.backend-error-close:hover {
  color: var(--danger);
}

/* ============ 移动端布局样式 ============ */
/* 移动端面板容器：单栏全屏 */
.mobile-panel-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.mobile-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.mobile-right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
/* 移动端时确保面板容器填满剩余空间（减去顶栏和底部导航） */
.ide-app.is-mobile .mobile-panel-container {
  flex: 1;
  min-height: 0;
}
/* 移动端隐藏日志面板，节省空间 */
.ide-app.is-mobile :deep(.log-panel) {
  display: none;
}
</style>
