<script setup>
/** FileExplorer — 左栏：文档树 + Idea 树切换 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useDocumentStore } from '@/stores/document';
import { useIdeaStore } from '@/stores/idea';
import { useUiStore } from '@/stores/ui';
import { useGraphStore } from '@/stores/graph';
import { useProjectStore } from '@/stores/project';
import { useToastStore } from '@/stores/toast';
import { useDialog } from '@/composables/useDialog';
import { readKGExtractOptions } from '@/utils/kg-options';
import Editor from './Editor.vue';
import IdeaTreeNode from './IdeaTreeNode.vue';

const docStore = useDocumentStore();
const ideaStore = useIdeaStore();
const uiStore = useUiStore();
const graphStore = useGraphStore();
const projectStore = useProjectStore();
const toast = useToastStore();
const dialog = useDialog();
const fileInput = ref(null);
const showPreview = ref(false);
const previewArea = ref(null);

// ============ 项目选择器状态 ============
const showProjectDropdown = ref(false);
const showNewProjectDialog = ref(false);
const newProjectName = ref('');
const newProjectInput = ref(null);
const projectContextMenu = ref({ show: false, x: 0, y: 0, projectId: null });

async function handleSwitchProject(projectId) {
  showProjectDropdown.value = false;
  if (projectId === projectStore.currentProjectId) return;
  try {
    await projectStore.switchProject(projectId);
  } catch (e) {
    toast.error('切换项目失败: ' + (e.message || e));
  }
}

async function handleCreateProject() {
  const name = newProjectName.value.trim();
  if (!name) return;
  try {
    await projectStore.createProject(name);
    showNewProjectDialog.value = false;
    newProjectName.value = '';
  } catch (e) {
    toast.error('创建项目失败: ' + (e.message || e));
  }
}

async function handleDeleteProject(id) {
  projectContextMenu.value.show = false;
  const project = projectStore.projects.find(p => p.id === id);
  const projectName = project?.name || '该项目';
  const ok = await dialog.confirm('删除确认', `确定要删除文件夹「${projectName}」吗？项目中的所有文档、图谱和 Idea 将被删除。`, { danger: true });
  if (!ok) return;
  try {
    await projectStore.deleteProject(id);
  } catch (e) {
    toast.error(e.message || '删除项目失败');
  }
}

async function handleRenameProject(id) {
  projectContextMenu.value.show = false;
  const project = projectStore.projects.find(p => p.id === id);
  const newName = await dialog.prompt('重命名文件夹', '请输入新的项目名称：', project?.name || '', { placeholder: '输入文件夹名称' });
  if (newName === null || !newName.trim()) return;
  try {
    await projectStore.renameProject(id, newName.trim());
  } catch (e) {
    toast.error('重命名失败: ' + (e.message || e));
  }
}

// ============ 项目导出/导入 ============
const importProjectInput = ref(null);
const exporting = ref(false);
const importing = ref(false);
// 文件导入中状态：防止导入过程中重复触发（按钮禁用 + 拖拽忽略）
const fileImporting = ref(false);

// ============ 菜单 template ref（替代 querySelector，避免脆弱的 DOM 查询） ============
const contextMenuRef = ref(null);
const projectContextMenuRef = ref(null);
const projectDropdownRef = ref(null);
const projectBarRef = ref(null);

async function handleExportProject(id) {
  projectContextMenu.value.show = false;
  const project = projectStore.projects.find(p => p.id === id);
  const projectName = project?.name || '项目';
  exporting.value = true;
  try {
    const data = await projectStore.exportProject(id);
    if (!data || data.error) {
      throw new Error(data?.error || '导出失败');
    }
    // 下载为 JSON 文件
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 文件名：项目名 + 时间戳，避免特殊字符
    const safeName = projectName.replace(/[<>:"/\\|?*]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 10);
    a.download = `${safeName}_${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error('导出项目失败: ' + (e.message || e));
  } finally {
    exporting.value = false;
  }
}

function triggerImportProject() {
  projectContextMenu.value.show = false;
  importProjectInput.value?.click();
}

async function onImportProjectFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);
    if (!data.documents || !Array.isArray(data.documents)) {
      throw new Error('文件格式不正确：缺少 documents 字段');
    }
    // 询问是否使用原项目名
    const defaultName = data.project?.name || file.name.replace(/\.json$/i, '');
    const newName = await dialog.prompt('导入项目', '请输入新项目名称：', defaultName, { placeholder: '输入项目名称' });
    if (newName === null || !newName.trim()) {
      e.target.value = '';
      return;
    }
    const result = await projectStore.importProject(data, newName.trim());
    if (result.project && result.project.id) {
      // 切换到新导入的项目
      try {
        await projectStore.switchProject(result.project.id);
      } catch (switchErr) {
        console.warn('切换到导入项目失败:', switchErr.message);
      }
    }
  } catch (err) {
    toast.error('导入项目失败: ' + (err.message || err));
  } finally {
    importing.value = false;
  }
  e.target.value = '';
}

// ============ 项目描述编辑 ============
async function handleEditDescription(id) {
  projectContextMenu.value.show = false;
  const project = projectStore.projects.find(p => p.id === id);
  const oldDesc = project?.description || '';
  const newDesc = await dialog.prompt('编辑描述', '请输入项目描述/备注：', oldDesc, { placeholder: '输入描述（可选）' });
  if (newDesc === null) return; // 用户取消
  try {
    await projectStore.updateProject(id, { description: newDesc });
  } catch (e) {
    toast.error('更新描述失败: ' + (e.message || e));
  }
}

function onProjectContextMenu(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  projectContextMenu.value = { show: true, x: e.clientX, y: e.clientY, projectId };
}

/** 项目下拉项的"更多操作"按钮点击：在按钮附近定位右键菜单 */
function onProjectActionsClick(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  projectContextMenu.value = { show: true, x: rect.right, y: rect.bottom, projectId };
}

function closeProjectContextMenu() {
  projectContextMenu.value.show = false;
}

watch(() => docStore.parseProgress.previewText, () => {
  if (showPreview.value && previewArea.value) {
    nextTick(() => {
      previewArea.value.scrollTop = previewArea.value.scrollHeight;
    });
  }
});

// 新建项目对话框打开时自动聚焦输入框
watch(showNewProjectDialog, (val) => {
  if (val) {
    nextTick(() => {
      newProjectInput.value?.focus();
    });
  }
});

function togglePreview() {
  showPreview.value = !showPreview.value;
  if (showPreview.value && previewArea.value) {
    nextTick(() => {
      previewArea.value.scrollTop = previewArea.value.scrollHeight;
    });
  }
}

// 右键菜单状态
const contextMenu = ref({ show: false, x: 0, y: 0, docId: null });
const buildLoading = ref(false);

// 多选文档状态（Ctrl/Cmd + 点击多选）
const selectedDocIds = ref(new Set());

// ============ 文档拖拽排序状态 ============
const draggingDocId = ref(null);
const dragOverDocId = ref(null);

// ============ 文件拖拽导入状态 ============
const isFileDragOver = ref(false);
let dragCounter = 0;

// Idea 树展开状态
const expandedIdeaIds = ref(new Set());

// 切换项目时重置多选/展开状态，避免残留旧项目的选中状态
watch(() => projectStore.currentProjectId, () => {
  selectedDocIds.value = new Set();
  expandedIdeaIds.value = new Set();
  contextMenu.value.show = false;
});

const showViewer = computed(() => !!docStore.activeDoc || !!ideaStore.activeIdea);

// Idea 树直接使用 store 的 ideaTree getter（父子嵌套结构）
const ideaTree = computed(() => ideaStore.ideaTree);

function expandAllIdeaFolders() {
  const all = new Set();
  function walk(nodes) {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) all.add(n.id);
      walk(n.children || []);
    }
  }
  walk(ideaTree.value);
  expandedIdeaIds.value = all;
}

function collapseAllIdeaFolders() {
  expandedIdeaIds.value = new Set();
}

function toggleIdeaFolder(id) {
  const next = new Set(expandedIdeaIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIdeaIds.value = next;
}

async function addChildIdea({ parentId, title }) {
  try {
    await ideaStore.addChildIdea(parentId, { title, content: '' });
    await graphStore.loadGraph();
  } catch (err) {
    toast.error('创建子 Idea 失败：' + (err.message || err));
  }
}

async function deleteIdea(id) {
  const ok = await dialog.confirm('删除确认', '确定要删除这个 Idea 及其所有子 Idea 吗？', { danger: true });
  if (!ok) return;
  try {
    await ideaStore.removeIdea(id);
    await graphStore.loadGraph();
  } catch (err) {
    toast.error('删除失败：' + (err.message || err));
  }
}

// 预计算"已生成图谱"的文档 id 集合：避免在 v-for 模板中对每个文档都执行
// graphStore.nodes.some(...)（O(节点数)），改为一次 O(节点数) 构建 Set + O(1) 查询。
const docsWithGraph = computed(() => {
  const set = new Set();
  for (const n of graphStore.nodes) {
    if (n.source && n.source.docId && n.type !== 'document') {
      set.add(n.source.docId);
    }
  }
  return set;
});

function hasGraph(docId) {
  // 判断文档是否真正有图谱内容：除文档节点外，至少还有 1 个内容节点
  return docsWithGraph.value.has(docId);
}

function onDocContextMenu(e, docId) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.value = { show: true, x: e.clientX, y: e.clientY, docId };
}

function closeContextMenu() {
  contextMenu.value.show = false;
}

async function buildGraphForDoc(docId) {
  closeContextMenu();
  buildLoading.value = true;
  try {
    await graphStore.buildGraphForDoc(docId);
    // 切到图谱页并高亮该文档节点
    uiStore.setRightTab('graph');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  } catch (err) {
    console.error('构建图谱失败:', err);
    toast.error('构建图谱失败: ' + (err.message || err));
  } finally {
    buildLoading.value = false;
  }
}

async function buildGraphForAllDocs() {
  closeContextMenu();
  buildLoading.value = true;
  try {
    const extractOptions = readKGExtractOptions();
    await graphStore.buildGraph(extractOptions);
    uiStore.setRightTab('graph');
    if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
  } catch (err) {
    console.error('构建图谱失败:', err);
    toast.error('构建图谱失败: ' + (err.message || err));
  } finally {
    buildLoading.value = false;
  }
}

/** 选中文档：更新活动文档并联动高亮图谱中对应节点 */
function selectDoc(docId, event) {
  const doc = docStore.documents.find(d => d.meta.docId === docId);
  docStore.setActive(docId, { page: 1 });
  ideaStore.setActive(null); // 清除 Idea 选中
  const hitIds = graphStore.nodes
    .filter(n => n.source && n.source.docId === docId)
    .map(n => n.id);
  graphStore.setHighlightedNodes(hitIds);
}

/** Ctrl/Cmd + 点击 切换多选 */
function toggleDocSelection(docId, event) {
  event.preventDefault();
  event.stopPropagation();
  const next = new Set(selectedDocIds.value);
  if (next.has(docId)) {
    next.delete(docId);
  } else {
    next.add(docId);
  }
  selectedDocIds.value = next;
}

/** 为选中的多个文档重建它们之间的跨文档关联 */
async function rebuildCrossLinksForSelected() {
  const ids = Array.from(selectedDocIds.value);
  if (ids.length < 2) {
    toast.warning('请至少选择两个文档');
    return;
  }
  buildLoading.value = true;
  closeContextMenu();
  try {
    // 选中的文档两两之间都重建 cross-link
    await graphStore.rebuildCrossLinks({ sourceDocIds: ids, targetDocIds: ids });
  } catch (e) {
    console.error('重建选中文档间关联失败:', e);
    toast.error('重建链接失败');
  } finally {
    buildLoading.value = false;
  }
}

function triggerImport() {
  fileInput.value?.click();
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(String(ev.target.result || ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFileImportType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].some(ext => lower.endsWith(ext))) return 'image';
  return 'text';
}

async function readFileContent(file) {
  const lower = file.name.toLowerCase();
  const isBinary = ['.pdf', '.docx', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].some(ext => lower.endsWith(ext));
  if (isBinary) {
    const base64 = await readFileAsBase64(file);
    if (!base64) {
      throw new Error('文件读取为空，请检查文件是否损坏');
    }
    return base64;
  }
  return readFileAsText(file);
}

async function onFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  await importFiles(files);
  e.target.value = '';
}

/**
 * 核心导入逻辑：接收 File 对象数组，读取内容并入队导入。
 * 同时供"选择文件"和"拖拽导入"两条路径复用。
 *
 * 文件读取采用顺序方式（而非 Promise.all 并行），避免同时读取多个大文件
 * 导致浏览器内存峰值过高（例如 10 个 50MB PDF 并行读取会产生 ~660MB base64）。
 * 读取完一个就立即入队，队列内部按 concurrency=1 顺序消费，已处理任务的内容
 * 会被及时释放，从而降低整体内存占用。
 */
async function importFiles(files) {
  if (files.length === 0) return;
  // 标记导入中，禁用导入按钮和拖拽，防止重复提交
  fileImporting.value = true;

  try {
  const importPromises = [];
  const readErrors = [];

  for (const file of files) {
    let content;
    try {
      content = await readFileContent(file);
    } catch (readErr) {
      console.error('文件读取失败:', file.name, readErr);
      readErrors.push(`${file.name}: ${readErr.message || readErr}`);
      continue;
    }
    const name = file.name;
    const type = getFileImportType(name);
    // 立即入队（不 await），队列内部按 concurrency=1 顺序处理
    importPromises.push(
      docStore.importDocument(name, content, type).then(
        doc => ({ status: 'fulfilled', name, doc }),
        err => ({ status: 'rejected', name, err })
      )
    );
  }

  let firstImportedDocId = null;
  const importedDocIds = [];
  const errors = [...readErrors];

  for (const result of await Promise.all(importPromises)) {
    if (result.status === 'fulfilled' && result.doc && result.doc.meta) {
      importedDocIds.push(result.doc.meta.docId);
      if (!firstImportedDocId) {
        firstImportedDocId = result.doc.meta.docId;
      }
    } else if (result.status === 'rejected') {
      console.error('导入失败:', result.name, result.err);
      if (result.err?.message?.includes('已取消')) {
        // 用户主动取消，不弹 toast
        continue;
      }
      errors.push(`${result.name}: ${result.err?.message || result.err}`);
    }
  }

  if (errors.length > 0) {
    // 多条失败时聚合提示，避免 toast 刷屏
    const detail = errors.slice(0, 3).join('\n') + (errors.length > 3 ? `\n...等共 ${errors.length} 个文件` : '');
    toast.error(`导入失败:\n${detail}`);
  }

  // 有文档导入成功后，只构建新导入的文档，然后重建跨文档关联
  if (importedDocIds.length > 0) {
    if (firstImportedDocId) {
      selectDoc(firstImportedDocId);
      uiStore.setLeftTab('documents');
    }
    try {
      // 从 localStorage 读取 KG 配置和分块参数，确保导入时也使用 LLM 而非 stub
      const extractOptions = readKGExtractOptions();
      // 只构建新导入的文档，不重复解析已有文档
      await graphStore.buildGraph(extractOptions, importedDocIds);
    } catch (err) {
      console.error('构建新文档图谱失败:', err);
      toast.error('构建新文档图谱失败');
    }
  }
  } finally {
    // 无论成功或失败，都重置导入状态
    fileImporting.value = false;
  }
}

// ============ 导入任务 UI 辅助 ============
const statusTextMap = {
  queued: '排队中',
  parsing: '解析中',
  done: '完成',
  error: '失败',
  cancelled: '已取消'
};

function taskStatusText(task) {
  if (task.status === 'parsing' && task.progress.percent > 0) {
    return `解析中 ${task.progress.percent}%`;
  }
  return statusTextMap[task.status] || task.status;
}

function taskStatusClass(task) {
  return `status-${task.status}`;
}

function retryTask(taskId) {
  docStore.retryImportTask(taskId);
}

function retryAllFailed() {
  docStore.importTasks.filter(t => t.status === 'error' && t.retryable).forEach(t => retryTask(t.id));
}

function clearDoneTasks() {
  docStore.clearDoneImportTasks();
}

async function deleteDoc(docId, event) {
  event.stopPropagation();
  const ok = await dialog.confirm('删除确认', '确定要删除该文档吗？', { danger: true });
  if (!ok) return;
  try {
    await docStore.removeDocument(docId);
  } catch (err) {
    toast.error('删除失败: ' + (err.message || err));
  }
}

// ============ 文档拖拽排序 ============
function onDocDragStart(e, docId) {
  draggingDocId.value = docId;
  e.dataTransfer.effectAllowed = 'move';
  // 设置自定义拖拽图像数据（部分浏览器需要）
  e.dataTransfer.setData('text/plain', docId);
}

function onDocDragOver(e, docId) {
  // 必须 preventDefault 才能触发 drop 事件
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (draggingDocId.value && draggingDocId.value !== docId) {
    dragOverDocId.value = docId;
  }
}

function onDocDragLeave(docId) {
  if (dragOverDocId.value === docId) {
    dragOverDocId.value = null;
  }
}

async function onDocDrop(e, targetDocId) {
  e.preventDefault();
  // 如果是外部文件拖入（非内部文档排序），交给外层 onFileDrop 处理
  if (!draggingDocId.value) {
    // 不 stopPropagation，让事件冒泡到 file-list-section 触发文件导入
    return;
  }
  e.stopPropagation();
  const sourceDocId = draggingDocId.value;
  dragOverDocId.value = null;
  draggingDocId.value = null;
  if (sourceDocId === targetDocId) return;

  // 计算新的文档顺序：将 sourceDocId 移动到 targetDocId 的位置
  const docs = docStore.documents;
  const sourceIndex = docs.findIndex(d => d.meta.docId === sourceDocId);
  const targetIndex = docs.findIndex(d => d.meta.docId === targetDocId);
  if (sourceIndex === -1 || targetIndex === -1) return;

  // 重建有序数组
  const reordered = [...docs];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);

  // 调用 store 更新顺序（前端即时 + 后端持久化）
  const newDocIds = reordered.map(d => d.meta.docId);
  try {
    await docStore.reorderDocuments(newDocIds);
  } catch (err) {
    console.error('拖拽排序失败:', err);
    toast.error('排序失败: ' + (err.message || err));
  }
}

function onDocDragEnd() {
  draggingDocId.value = null;
  dragOverDocId.value = null;
}

// ============ 文件拖拽导入（从操作系统拖入文件） ============
// 支持的文件扩展名（需与 getFileImportType / readFileContent / accept 属性保持一致）
const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.pdf', '.docx', '.pptx', '.markdown', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

function isSupportedFile(file) {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => name.endsWith(ext));
}

function onFileDragEnter(e) {
  // 仅处理从外部拖入的文件（非内部文档排序）
  if (draggingDocId.value) return;
  const items = e.dataTransfer?.items;
  if (!items) return;
  let hasFile = false;
  for (const item of items) {
    if (item.kind === 'file') { hasFile = true; break; }
  }
  if (!hasFile) return;
  e.preventDefault();
  dragCounter++;
  isFileDragOver.value = true;
}

function onFileDragOver(e) {
  if (draggingDocId.value) return;
  const items = e.dataTransfer?.items;
  if (!items) return;
  let hasFile = false;
  for (const item of items) {
    if (item.kind === 'file') { hasFile = true; break; }
  }
  if (!hasFile) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function onFileDragLeave(e) {
  if (draggingDocId.value) return;
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isFileDragOver.value = false;
  }
}

async function onFileDrop(e) {
  if (draggingDocId.value) return;
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  isFileDragOver.value = false;

  // 导入进行中时忽略拖拽，防止重复导入
  if (fileImporting.value) {
    toast.warning('文件正在导入中，请等待当前导入完成');
    return;
  }

  const droppedFiles = Array.from(e.dataTransfer?.files || []);
  if (droppedFiles.length === 0) return;

  // 过滤出支持的文件类型，对不支持的文件给出提示
  const supported = droppedFiles.filter(isSupportedFile);
  const unsupported = droppedFiles.filter(f => !isSupportedFile(f));

  if (unsupported.length > 0) {
    const names = unsupported.slice(0, 3).map(f => f.name).join('、');
    toast.warning(`不支持的文件类型: ${names}${unsupported.length > 3 ? ` 等 ${unsupported.length} 个` : ''}`);
  }

  if (supported.length === 0) return;
  await importFiles(supported);
}

// 左侧 Idea 快速创建：弹出一个简单的 prompt 输入标题
async function createQuickIdea() {
  const title = await dialog.prompt('新建 Idea', '请输入 Idea 标题：', '', { placeholder: '输入标题' });
  if (title === null || !title.trim()) return;
  try {
    await ideaStore.addIdea({
      title: title.trim() || '未命名 Idea',
      content: '',
      includeInGraph: true
    });
    await graphStore.loadGraph();
  } catch (err) {
    toast.error('创建 Idea 失败: ' + (err.message || err));
  }
}

function onWindowClick(e) {
  if (contextMenuRef.value && contextMenuRef.value.contains(e.target)) return;
  closeContextMenu();
  // 关闭项目右键菜单
  if (!projectContextMenuRef.value || !projectContextMenuRef.value.contains(e.target)) {
    closeProjectContextMenu();
  }
  // 关闭项目下拉列表
  if (showProjectDropdown.value && projectDropdownRef.value && !projectDropdownRef.value.contains(e.target) && projectBarRef.value && !projectBarRef.value.contains(e.target)) {
    showProjectDropdown.value = false;
  }
}

// ============ 项目切换快捷键 ============
// Ctrl+Shift+[ : 上一个项目
// Ctrl+Shift+] : 下一个项目
function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
    // [ 在 Shift 按下时可能变为 { ，] 可能变为 } ，需同时兼容
    if (e.key === '[' || e.key === '{') {
      e.preventDefault();
      switchToAdjacentProject(-1);
    } else if (e.key === ']' || e.key === '}') {
      e.preventDefault();
      switchToAdjacentProject(1);
    }
  }
}

async function switchToAdjacentProject(direction) {
  if (projectStore.switching) return;
  const targetId = projectStore.getAdjacentProjectId(direction);
  if (!targetId) return;
  await handleSwitchProject(targetId);
}

onMounted(() => {
  window.addEventListener('click', onWindowClick, true);
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('click', onWindowClick, true);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="file-explorer">
    <!-- 项目选择器（始终显示在顶部） -->
    <div class="project-section">
      <div ref="projectBarRef" class="project-bar" role="button" tabindex="0" aria-haspopup="listbox" :aria-expanded="showProjectDropdown" aria-label="选择项目文件夹" @click="showProjectDropdown = !showProjectDropdown" @keydown.enter="showProjectDropdown = !showProjectDropdown" @keydown.space.prevent="showProjectDropdown = !showProjectDropdown">
        <span class="project-icon" aria-hidden="true">📁</span>
        <span class="project-name" :title="projectStore.currentProject?.name || '未选择'">
          {{ projectStore.switching ? '切换中...' : (projectStore.currentProject?.name || '未选择项目') }}
        </span>
        <span v-if="projectStore.switching" class="project-loading" aria-hidden="true">⏳</span>
        <span v-else class="project-arrow" :class="{open: showProjectDropdown}" aria-hidden="true">▼</span>
        <button class="project-add-btn" @click.stop="showNewProjectDialog = true; newProjectName = ''" title="新建文件夹" aria-label="新建文件夹">+</button>
      </div>
      <div v-if="showProjectDropdown" ref="projectDropdownRef" class="project-dropdown-list" role="listbox" aria-label="项目列表">
        <div
          v-for="p in projectStore.projects"
          :key="p.id"
          class="project-dropdown-item"
          role="option"
          :aria-selected="p.id === projectStore.currentProjectId"
          :class="{active: p.id === projectStore.currentProjectId, disabled: projectStore.switching}"
          tabindex="0"
          @click="projectStore.switching ? null : handleSwitchProject(p.id)"
          @keydown.enter="projectStore.switching ? null : handleSwitchProject(p.id)"
          @contextmenu.prevent="onProjectContextMenu($event, p.id)"
        >
          <span class="project-icon">📁</span>
          <div class="project-dropdown-info">
            <span class="project-dropdown-name" :title="p.name">{{ p.name }}</span>
            <span v-if="p.description" class="project-dropdown-desc" :title="p.description">{{ p.description }}</span>
            <span class="project-dropdown-meta">{{ p.documentCount ?? 0 }} 个文档</span>
          </div>
          <span v-if="p.id === projectStore.currentProjectId" class="project-current-mark">✓</span>
          <button
            class="project-item-actions-btn"
            title="更多操作（重命名/删除）"
            aria-label="更多操作（重命名/删除）"
            @click.stop="onProjectActionsClick($event, p.id)"
          >⋯</button>
        </div>
      </div>
    </div>

    <!-- 新建项目对话框 -->
    <Teleport to="body">
      <div v-if="showNewProjectDialog" class="project-dialog-overlay" @click.self="showNewProjectDialog = false">
        <div class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-dialog-title">
          <h3 id="new-project-dialog-title">新建文件夹</h3>
          <input
            ref="newProjectInput"
            v-model="newProjectName"
            type="text"
            placeholder="输入文件夹名称"
            aria-label="文件夹名称"
            @keyup.enter="handleCreateProject"
            @keyup.esc="showNewProjectDialog = false"
          />
          <div class="project-dialog-actions">
            <button @click="showNewProjectDialog = false">取消</button>
            <button class="btn-primary" @click="handleCreateProject" :disabled="!newProjectName.trim()">创建</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 项目右键菜单 -->
    <Teleport to="body">
      <div v-if="projectContextMenu.show" ref="projectContextMenuRef" class="context-menu project-context-menu" role="menu" aria-label="项目操作菜单" :style="{ left: projectContextMenu.x + 'px', top: projectContextMenu.y + 'px' }" @click.stop>
        <button class="context-menu-item" role="menuitem" @click="handleRenameProject(projectContextMenu.projectId)">重命名</button>
        <button class="context-menu-item" role="menuitem" @click="handleEditDescription(projectContextMenu.projectId)">编辑描述</button>
        <div class="context-menu-divider" role="separator" />
        <button class="context-menu-item" role="menuitem" :disabled="exporting" @click="handleExportProject(projectContextMenu.projectId)">{{ exporting ? '导出中...' : '导出项目' }}</button>
        <button class="context-menu-item" role="menuitem" :disabled="importing" @click="triggerImportProject">{{ importing ? '导入中...' : '导入项目' }}</button>
        <div class="context-menu-divider" role="separator" />
        <button class="context-menu-item danger" role="menuitem" :disabled="projectStore.projectCount <= 1" @click="handleDeleteProject(projectContextMenu.projectId)">删除</button>
      </div>
    </Teleport>

    <!-- 项目导入文件选择器（隐藏） -->
    <input
      ref="importProjectInput"
      type="file"
      accept=".json"
      style="display: none;"
      @change="onImportProjectFileSelected"
    />

    <!-- 文件列表区域（上半部分，可折叠） -->
    <div
      v-show="!uiStore.fileListCollapsed"
      class="file-list-section"
      :class="{'file-drag-over': isFileDragOver}"
      @dragenter="onFileDragEnter"
      @dragover="onFileDragOver"
      @dragleave="onFileDragLeave"
      @drop="onFileDrop"
    >
      <!-- 拖拽导入遮罩层 -->
      <div v-if="isFileDragOver" class="file-drop-overlay">
        <div class="file-drop-overlay-inner">
          <div class="file-drop-icon">📥</div>
          <div class="file-drop-text">松开鼠标导入文件</div>
          <div class="file-drop-hint">支持 PDF / Word / PPTX / Markdown / 文本 / 图片</div>
        </div>
      </div>
    <div class="panel-tabs" role="tablist" aria-label="左侧面板切换">
      <button :class="{active: uiStore.leftPanelTab==='documents'}" role="tab" :aria-selected="uiStore.leftPanelTab==='documents'" aria-label="切换到文档列表" @click="uiStore.setLeftTab('documents')">文档</button>
      <button :class="{active: uiStore.leftPanelTab==='ideas'}" role="tab" :aria-selected="uiStore.leftPanelTab==='ideas'" aria-label="切换到 Idea 列表" @click="uiStore.setLeftTab('ideas')">Idea</button>
    </div>

    <div v-if="uiStore.leftPanelTab==='documents'" class="panel-toolbar">
      <button class="btn-primary" :class="{'btn-blink': docStore.documents.length === 0 && !docStore.importTaskStats.parsing}" :disabled="fileImporting" aria-label="导入文件" @click="triggerImport">{{ fileImporting ? '导入中...' : '+ 导入文件' }}</button>
      <span class="hint">支持 PDF / Word / PPTX / Markdown / 文本 / 图片</span>
      <input
        ref="fileInput"
        type="file"
        accept=".md,.markdown,.txt,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.gif,.bmp,.webp"
        multiple
        style="display: none;"
        @change="onFilesSelected"
      />
    </div>

    <!-- 导入任务列表面板：每个任务独立状态/进度，避免全局进度被覆盖 -->
    <div v-if="docStore.importTasks.length > 0" class="import-tasks-panel">
      <div class="import-tasks-header">
        <span class="import-tasks-title">
          导入任务
          <span class="import-tasks-stats">
            {{ docStore.importTaskStats.done }}/{{ docStore.importTaskStats.total }} 完成
            <span v-if="docStore.importTaskStats.error > 0" class="import-error-count">{{ docStore.importTaskStats.error }} 失败</span>
          </span>
        </span>
        <div class="import-tasks-actions">
          <button v-if="docStore.importTaskStats.error > 0" class="btn-text" aria-label="重试全部失败任务" @click="retryAllFailed">重试全部失败</button>
          <button class="btn-text" aria-label="清除已完成任务记录" @click="clearDoneTasks">清除记录</button>
        </div>
      </div>
      <div class="import-tasks-list">
        <div
          v-for="task in docStore.importTasks"
          :key="task.id"
          class="import-task-item"
          :class="taskStatusClass(task)"
        >
          <span class="import-task-name" :title="task.name">{{ task.name }}</span>
          <span class="import-task-status" :class="taskStatusClass(task)">{{ taskStatusText(task) }}</span>
          <div v-if="task.status === 'parsing'" class="import-task-progress-wrap">
            <div class="import-task-progress-bar" :style="{ width: task.progress.percent + '%' }"></div>
          </div>
          <span v-if="task.status === 'error' && task.error" class="import-task-error" :title="task.error">{{ task.error }}</span>
          <button
            v-if="task.status === 'error' && task.retryable"
            class="btn-text import-task-retry"
            @click="retryTask(task.id)"
          >重试</button>
        </div>
      </div>
      <!-- 当前活动任务的解析详情（展开/暂停/继续/停止） -->
      <div v-if="docStore.activeImportTask" class="import-active-detail">
        <div class="parse-progress-info">
          <span>{{ docStore.parseProgress.log }}</span>
          <span v-if="docStore.parseProgress.totalPages > 0">
            第 {{ docStore.parseProgress.currentPage }}/{{ docStore.parseProgress.totalPages }} 页
          </span>
        </div>
        <div class="parse-progress-actions">
          <button class="btn-text" @click="togglePreview">
            {{ showPreview ? '收起详情' : '展开详情' }}
          </button>
          <button v-if="docStore.parseProgress.status === 'running'" class="btn-text" @click="docStore.pauseParse()">暂停</button>
          <button v-if="docStore.parseProgress.status === 'paused'" class="btn-text" @click="docStore.resumeParse()">继续</button>
          <button class="btn-text danger" @click="docStore.cancelParse()">停止</button>
        </div>
        <div v-if="showPreview" ref="previewArea" class="parse-preview-area">
          <pre>{{ docStore.parseProgress.previewText || '等待内容...' }}</pre>
        </div>
      </div>
    </div>

    <!-- 项目切换中：显示骨架屏 -->
    <div v-if="projectStore.switching && uiStore.leftPanelTab==='documents'" class="tree skeleton-tree">
      <div v-for="i in 4" :key="'skeleton-'+i" class="skeleton-tree-item">
        <div class="skeleton-block skeleton-icon-block"></div>
        <div class="skeleton-block skeleton-label-block"></div>
        <div class="skeleton-block skeleton-action-block"></div>
      </div>
    </div>

    <div v-else-if="uiStore.leftPanelTab==='documents'" class="tree" role="list" @click="closeContextMenu">
      <div v-if="selectedDocIds.size > 0" class="doc-selection-bar">
        <span>已选择 {{ selectedDocIds.size }} 个文档</span>
        <button :disabled="buildLoading" @click="rebuildCrossLinksForSelected">{{ buildLoading ? '重建中...' : '重建选中文档间链接' }}</button>
        <button class="btn-text" @click="selectedDocIds = new Set()">清除选择</button>
      </div>
      <div v-for="doc in docStore.documents" :key="doc.meta.docId"
           class="tree-item doc-item"
           role="listitem"
           :class="{
             active: docStore.activeDocId===doc.meta.docId,
             selected: selectedDocIds.has(doc.meta.docId),
             dragging: draggingDocId===doc.meta.docId,
             'drag-over': dragOverDocId===doc.meta.docId
           }"
           draggable="true"
           @click="(e) => e.ctrlKey || e.metaKey ? toggleDocSelection(doc.meta.docId, e) : selectDoc(doc.meta.docId, e)"
           @contextmenu.prevent="onDocContextMenu($event, doc.meta.docId)"
           @dragstart="onDocDragStart($event, doc.meta.docId)"
           @dragover="onDocDragOver($event, doc.meta.docId)"
           @dragleave="onDocDragLeave(doc.meta.docId)"
           @drop="onDocDrop($event, doc.meta.docId)"
           @dragend="onDocDragEnd">
        <input
          type="checkbox"
          class="doc-checkbox"
          :checked="selectedDocIds.has(doc.meta.docId)"
          :aria-label="`选择文档 ${doc.meta.name}`"
          @click.stop="toggleDocSelection(doc.meta.docId, $event)"
        />
        <span class="icon" aria-hidden="true">📄</span>
        <span class="label">{{ doc.meta.name }}</span>
        <span v-if="hasGraph(doc.meta.docId)" class="doc-graph-status" title="已生成知识图谱" aria-label="已生成知识图谱">✓</span>
        <button class="tree-action graph-action" :title="hasGraph(doc.meta.docId)?'重新生成知识图谱':'生成知识图谱'" :aria-label="hasGraph(doc.meta.docId)?'重新生成知识图谱':'生成知识图谱'" :disabled="buildLoading" @click.stop="buildGraphForDoc(doc.meta.docId)">
          {{ buildLoading ? '...' : '⚡' }}
        </button>
        <button class="tree-action" title="删除文档" aria-label="删除文档" @click="deleteDoc(doc.meta.docId, $event)">×</button>
      </div>
      <div v-if="docStore.documents.length===0" class="empty-guide">
        <div class="empty-guide-icon">📂</div>
        <div class="empty-guide-title">此文件夹还没有文档</div>
        <div class="empty-guide-hint">点击上方"导入文件"按钮，或直接拖拽文件到此区域导入</div>
      </div>
      <div class="file-list-hint">提示：右键文档查看更多操作 · Ctrl+点击多选 · 拖拽文档可排序 · 拖拽文件到此导入</div>
    </div>

    <!-- 文档右键菜单 -->
    <Teleport to="body">
      <div v-if="contextMenu.show" ref="contextMenuRef" class="context-menu" role="menu" aria-label="文档操作菜单" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
        <button v-if="!hasGraph(contextMenu.docId)" class="context-menu-item" role="menuitem" :disabled="buildLoading" @click="buildGraphForDoc(contextMenu.docId)">
          {{ buildLoading ? '生成中...' : '生成知识图谱' }}
        </button>
        <button v-else class="context-menu-item" role="menuitem" :disabled="buildLoading" @click="buildGraphForDoc(contextMenu.docId)">
          {{ buildLoading ? '重新生成中...' : '重新生成知识图谱' }}
        </button>
        <button class="context-menu-item" role="menuitem" :disabled="buildLoading" @click="buildGraphForAllDocs">
          {{ buildLoading ? '生成中...' : '为所有文档生成图谱' }}
        </button>
        <div class="context-menu-divider" role="separator" />
        <button
          class="context-menu-item"
          role="menuitem"
          :disabled="buildLoading || selectedDocIds.size < 2"
          @click="rebuildCrossLinksForSelected"
        >
          {{ buildLoading ? '重建中...' : '重建选中文档间链接' }}
        </button>
        <div class="context-menu-divider" role="separator" />
        <button class="context-menu-item danger" role="menuitem" @click="deleteDoc(contextMenu.docId, $event); closeContextMenu()">删除文档</button>
      </div>
    </Teleport>

    <div v-if="uiStore.leftPanelTab==='ideas'" class="tree idea-tree" role="tree" aria-label="Idea 列表树">
      <div class="tree-toolbar" role="toolbar" aria-label="Idea 列表操作">
        <button class="btn-text" aria-label="全部展开 Idea 文件夹" @click="expandAllIdeaFolders">全部展开</button>
        <button class="btn-text" aria-label="全部折叠 Idea 文件夹" @click="collapseAllIdeaFolders">全部折叠</button>
        <button class="btn-text add-idea-inline" aria-label="添加新 Idea" @click="createQuickIdea">+ 添加</button>
      </div>
      <IdeaTreeNode
        v-for="node in ideaTree"
        :key="node.id"
        :node="node"
        :active-id="ideaStore.activeIdeaId"
        :expanded-ids="expandedIdeaIds"
        @select="ideaStore.setActive"
        @delete="deleteIdea"
        @toggle="toggleIdeaFolder"
        @add-child="addChildIdea"
      />
      <div v-if="ideaStore.ideas.length===0" class="empty-guide" style="text-align:center;padding:24px 16px;">
        <div style="font-size:28px;margin-bottom:6px;">💡</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:2px;">还没有 Idea</div>
        <div style="font-size:11px;color:var(--text-tertiary);">在右侧 Idea 面板记录灵感</div>
      </div>
    </div>
    </div>

    <!-- 折叠/展开工具条（替代细分隔线，更醒目） -->
    <div class="panel-collapse-bar" role="button" tabindex="0" :aria-label="uiStore.fileListCollapsed ? '展开文件列表' : '折叠文件列表'" @click="uiStore.toggleFileListCollapsed()" @keydown.enter="uiStore.toggleFileListCollapsed()" @keydown.space.prevent="uiStore.toggleFileListCollapsed()">
      <button
        class="panel-collapse-btn"
        :title="uiStore.fileListCollapsed ? '展开文件列表' : '折叠文件列表（扩大阅读区）'"
        :aria-label="uiStore.fileListCollapsed ? '展开文件列表' : '折叠文件列表'"
        @click.stop="uiStore.toggleFileListCollapsed()"
      >
        <svg class="collapse-arrow" :class="{ 'is-collapsed': uiStore.fileListCollapsed }" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="collapse-label">{{ uiStore.fileListCollapsed ? '展开文件列表' : '折叠文件列表' }}</span>
    </div>

    <!-- 编辑器区域（下半部分，flex:1，可滚动） -->
    <div class="viewer-pane" :class="{'viewer-expanded': uiStore.fileListCollapsed}">
      <Editor />
    </div>
  </div>
</template>

<style scoped>
/* ============ 文件列表 + 编辑器分栏布局 ============ */
.file-list-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ============ 文件拖拽导入遮罩 ============ */
.file-list-section.file-drag-over {
  outline: 2px dashed var(--accent, #3b82f6);
  outline-offset: -4px;
  background: var(--accent-bg, rgba(59, 130, 246, 0.05));
}
.file-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg-primary, #fff) 85%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: none;
}
.file-drop-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  border-radius: var(--radius, 8px);
  border: 2px dashed var(--accent, #3b82f6);
  background: var(--bg-card, #fff);
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.1));
}
.file-drop-icon {
  font-size: 48px;
  line-height: 1;
}
.file-drop-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
}
.file-drop-hint {
  font-size: 12px;
  color: var(--text-tertiary, #9ca3af);
}
.panel-divider {
  flex-shrink: 0;
  height: 1px;
  background: var(--border-color, #e5e7eb);
}
/* ============ 折叠/展开工具条 ============ */
.panel-collapse-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  background: var(--bg-tertiary, #f0f1f3);
  border-top: 1px solid var(--border-color, #e5e7eb);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  cursor: pointer;
  user-select: none;
  position: relative;
  z-index: 10;
  transition: background 0.15s;
}
.panel-collapse-bar:hover {
  background: var(--bg-hover, #e5e7eb);
}
.panel-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  padding: 0;
  border-radius: var(--radius-sm, 4px);
  transition: all 0.15s;
}
.panel-collapse-btn:hover {
  background: var(--accent-bg, rgba(59, 130, 246, 0.1));
  color: var(--accent, #3b82f6);
}
.collapse-arrow {
  transition: transform 0.2s ease;
}
.collapse-arrow.is-collapsed {
  transform: rotate(180deg);
}
.collapse-label {
  font-size: 11px;
  color: var(--text-tertiary, #9ca3af);
  pointer-events: none;
  white-space: nowrap;
}
.panel-collapse-bar:hover .collapse-label {
  color: var(--text-secondary, #6b7280);
}
.viewer-pane.viewer-expanded {
  flex: 1;
}
.viewer-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 24px;
}
.viewer-empty .big-icon {
  font-size: 48px;
  opacity: 0.4;
}
.viewer-empty p {
  font-size: 13px;
  margin: 0;
}

/* ============ 项目选择器 ============ */
.project-section {
  position: relative;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  flex-shrink: 0;
}
.project-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  background: var(--bg-card, #fff);
  transition: background 0.15s;
  user-select: none;
}
.project-bar:hover {
  background: var(--bg-hover, #eef2f7);
}
.project-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.project-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-loading {
  font-size: 12px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.project-arrow {
  font-size: 9px;
  color: var(--text-secondary);
  transition: transform 0.2s;
}
.project-arrow.open {
  transform: rotate(180deg);
}
.project-add-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  border-radius: 3px;
}
.project-add-btn:hover {
  color: var(--accent, #3b82f6);
  background: var(--bg-hover, #eef2f7);
}
.project-dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-top: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: var(--z-dropdown);
  max-height: 300px;
  overflow-y: auto;
}
.project-dropdown-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.1s;
}
.project-dropdown-item:hover {
  background: var(--bg-hover, #eef2f7);
}
.project-dropdown-item.active {
  background: var(--accent-bg, #eff6ff);
  color: var(--accent, #3b82f6);
}
/* 项目切换中：禁用点击和 hover 效果 */
.project-dropdown-item.disabled {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}
.project-dropdown-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-dropdown-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}
.project-dropdown-meta {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-dropdown-desc {
  font-size: 11px;
  color: var(--text-tertiary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}
.project-item-actions-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  flex-shrink: 0;
}
.project-dropdown-item:hover .project-item-actions-btn {
  opacity: 1;
}
.project-item-actions-btn:hover {
  background: var(--bg-hover, #eef2f7);
  color: var(--text-primary);
}
.project-current-mark {
  color: var(--accent, #3b82f6);
  font-size: 12px;
  flex-shrink: 0;
}
/* 新建项目对话框 */
.project-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}
.project-dialog {
  background: var(--bg-card, #fff);
  border-radius: var(--radius-md, 8px);
  padding: 20px 24px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.project-dialog h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: var(--text-primary);
}
.project-dialog input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-input, #fff);
  box-sizing: border-box;
}
.project-dialog input:focus {
  outline: none;
  border-color: var(--accent, #3b82f6);
}
.project-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.project-dialog-actions button {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.project-dialog-actions button.btn-primary {
  background: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
  color: #fff;
}
.project-dialog-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ============ 原有样式 ============ */
.doc-graph-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--success, #059669);
  color: #fff;
  font-size: 10px;
  margin-right: 4px;
  flex-shrink: 0;
}
/* .context-menu / .context-menu-item / .context-menu-divider 基础样式已统一到 ide.css，
   此处仅保留组件特定的 min-width 与 padding 覆盖。 */
.context-menu {
  min-width: 160px;
}
.context-menu-item {
  padding: 8px 12px;
}
.tree-toolbar {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}
.btn-text {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
}
.btn-text:hover {
  color: var(--accent, #3b82f6);
}
.graph-action {
  color: var(--accent, #3b82f6);
  margin-right: 2px;
}
.graph-action:hover {
  background: var(--accent, #3b82f6);
  color: #fff;
}
.parse-progress-panel {
  margin: 8px 12px;
  padding: 10px 12px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.parse-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}
.parse-progress-title {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
.parse-progress-stage {
  color: var(--accent, #3b82f6);
  font-weight: 500;
}
.parse-progress-bar-wrap {
  height: 6px;
  background: var(--bg-hover, #eef2f7);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.parse-progress-bar {
  height: 100%;
  background: var(--accent, #3b82f6);
  transition: width 0.2s ease;
}
.parse-progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.parse-progress-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.parse-progress-actions .btn-text.danger {
  color: var(--danger, #ef4444);
}

/* ============ 导入任务列表面板 ============ */
.import-tasks-panel {
  margin: 8px 12px;
  padding: 10px 12px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  max-height: 320px;
  display: flex;
  flex-direction: column;
}
.import-tasks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}
.import-tasks-title {
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.import-tasks-stats {
  font-weight: 400;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.import-error-count {
  color: var(--danger, #ef4444);
}
.import-tasks-actions {
  display: flex;
  gap: 8px;
}
.import-tasks-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.import-task-item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-hover, #eef2f7);
  font-size: 12px;
}
.import-task-item.status-parsing {
  background: var(--accent-bg, #eff6ff);
}
.import-task-item.status-error {
  background: var(--danger-bg, #fef2f2);
}
.import-task-item.status-done {
  background: var(--success-bg, #ecfdf5);
}
.import-task-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.import-task-status {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-card, #fff);
  color: var(--text-secondary);
  white-space: nowrap;
}
.import-task-status.status-parsing {
  color: var(--accent, #3b82f6);
}
.import-task-status.status-done {
  color: var(--success, #059669);
}
.import-task-status.status-error {
  color: var(--danger, #ef4444);
}
.import-task-progress-wrap {
  grid-column: 1 / -1;
  height: 4px;
  background: var(--bg-hover, #eef2f7);
  border-radius: 2px;
  overflow: hidden;
}
.import-task-progress-bar {
  height: 100%;
  background: var(--accent, #3b82f6);
  transition: width 0.2s ease;
}
.import-task-error {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--danger, #ef4444);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.import-task-retry {
  grid-column: 2;
  justify-self: end;
  color: var(--accent, #3b82f6);
}
.import-active-detail {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color, #e5e7eb);
}

.parse-preview-area {
  margin-top: 10px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-hover, #eef2f7);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.5;
}
.parse-preview-area pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
}
.doc-selection-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin: 0 8px 6px;
  background: var(--accent-bg, #eff6ff);
  border: 1px solid var(--accent, #3b82f6);
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  color: var(--text-primary);
}
.doc-selection-bar span {
  flex: 1;
}
.doc-selection-bar button {
  padding: 4px 10px;
  background: var(--accent, #3b82f6);
  border: 1px solid var(--accent, #3b82f6);
  border-radius: var(--radius-sm, 4px);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.doc-selection-bar button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.doc-selection-bar button.btn-text {
  background: transparent;
  border-color: var(--border-color, #e5e7eb);
  color: var(--text-secondary);
}
.doc-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.doc-item.selected {
  background: var(--accent-bg, #eff6ff);
}
/* 拖拽排序视觉反馈 */
.doc-item.dragging {
  opacity: 0.4;
}
.doc-item.drag-over {
  border-top: 2px solid var(--accent, #3b82f6);
  margin-top: -1px;
}
.doc-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--accent, #3b82f6);
  flex-shrink: 0;
}
/* 文件列表底部操作提示 */
.file-list-hint {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
  border-top: 1px solid var(--border-color, #e5e7eb);
  flex-shrink: 0;
  line-height: 1.5;
}

/* ============ 项目切换骨架屏 ============ */
.skeleton-tree {
  padding: 4px 0;
}
.skeleton-tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
}
.skeleton-block {
  background: linear-gradient(90deg, var(--bg-hover, #eef2f7) 25%, var(--bg-card, #fff) 50%, var(--bg-hover, #eef2f7) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}
.skeleton-icon-block {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.skeleton-label-block {
  flex: 1;
  height: 14px;
}
.skeleton-action-block {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ============ 空项目引导 ============ */
.empty-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  text-align: center;
}
.empty-guide-icon {
  font-size: 48px;
  opacity: 0.5;
  line-height: 1;
}
.empty-guide-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
}
.empty-guide-hint {
  font-size: 12px;
  color: var(--text-tertiary, #6b7280);
  line-height: 1.5;
  max-width: 220px;
}

/* ============ 导入按钮闪烁动画（空项目时） ============ */
.btn-blink {
  animation: btn-pulse 1.5s ease-in-out infinite;
}
@keyframes btn-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
  }
}

/* ============ 响应式样式 ============ */

/* 中等屏幕（max-width: 1200px）*/
@media (max-width: 1200px) {
  /* 项目选择器：紧凑化 */
  .project-bar {
    padding: 6px 10px;
  }
  .project-name {
    font-size: 12px;
  }
  /* 项目下拉项：隐藏描述，节省空间 */
  .project-dropdown-desc {
    display: none;
  }
  /* 文件列表底部提示隐藏 */
  .file-list-hint {
    display: none;
  }
}

/* 小屏幕（max-width: 768px）*/
@media (max-width: 768px) {
  /* 项目选择器：最紧凑 */
  .project-bar {
    padding: 6px 8px;
    gap: 4px;
  }
  .project-icon {
    font-size: 13px;
  }
  .project-name {
    font-size: 12px;
  }
  .project-add-btn {
    font-size: 14px;
    padding: 0 2px;
  }
  /* 项目下拉列表：简化布局 */
  .project-dropdown-list {
    max-height: 240px;
  }
  .project-dropdown-item {
    padding: 6px 8px;
    gap: 4px;
  }
  .project-dropdown-name {
    font-size: 12px;
  }
  .project-dropdown-meta {
    font-size: 10px;
  }
  .project-dropdown-desc {
    display: none;
  }
  /* 面板标签：紧凑 */
  .panel-tabs button {
    padding: 8px 4px;
    font-size: 12px;
  }
  /* 工具栏：换行 */
  .panel-toolbar {
    flex-wrap: wrap;
    padding: 6px 8px;
    gap: 6px;
  }
  .panel-toolbar .btn-primary {
    font-size: 11px;
    padding: 5px 10px;
  }
  .panel-toolbar .hint {
    display: none;
  }
  /* 文档项：更紧凑 */
  .doc-item {
    padding: 5px 6px;
    gap: 4px;
    font-size: 12px;
  }
  .doc-item .icon {
    font-size: 12px;
  }
  .doc-item .label {
    font-size: 12px;
  }
  .doc-checkbox {
    width: 13px;
    height: 13px;
  }
  .doc-graph-status {
    width: 14px;
    height: 14px;
    font-size: 9px;
  }
  .tree-action {
    width: 18px;
    height: 18px;
    font-size: 14px;
  }
  /* 解析进度面板：紧凑 */
  .parse-progress-panel {
    margin: 6px 8px;
    padding: 8px 10px;
  }
  .parse-progress-title {
    font-size: 11px;
    max-width: 50%;
  }
  /* 文档选择栏：紧凑 */
  .doc-selection-bar {
    padding: 6px 8px;
    margin: 0 4px 4px;
    font-size: 11px;
    gap: 4px;
    flex-wrap: wrap;
  }
  .doc-selection-bar button {
    padding: 3px 8px;
    font-size: 11px;
  }
  /* Idea 树工具栏：紧凑 */
  .tree-toolbar {
    padding: 3px 6px;
    gap: 4px;
  }
  .btn-text {
    font-size: 10px;
    padding: 2px 3px;
  }
  /* 空引导：紧凑 */
  .empty-guide {
    padding: 24px 16px;
  }
  .empty-guide-icon {
    font-size: 36px;
  }
  .empty-guide-title {
    font-size: 13px;
  }
  .empty-guide-hint {
    font-size: 11px;
    max-width: 180px;
  }
  /* 文件列表底部提示隐藏 */
  .file-list-hint {
    display: none;
  }
  /* 新建项目对话框：全宽 */
  .project-dialog {
    min-width: auto;
    width: 88vw;
    padding: 16px 20px;
  }
}

/* 超小屏幕（max-width: 480px）*/
@media (max-width: 480px) {
  /* 项目选择器：极简 */
  .project-bar {
    padding: 5px 6px;
  }
  .project-name {
    font-size: 11px;
  }
  /* 文档项：最紧凑 */
  .doc-item {
    padding: 4px 5px;
    font-size: 11px;
  }
  .doc-item .icon {
    font-size: 11px;
  }
  .doc-item .label {
    font-size: 11px;
  }
  .doc-checkbox {
    width: 12px;
    height: 12px;
  }
  /* 面板标签：最小 */
  .panel-tabs button {
    padding: 6px 3px;
    font-size: 11px;
  }
}
</style>
