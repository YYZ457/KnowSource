<script setup>
/** Editor — 中栏：文档预览 / Idea 编辑（含代码语法高亮） */
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { useDocumentStore } from '@/stores/document';
import { useIdeaStore } from '@/stores/idea';
import { BASE, API_TOKEN } from '@/api/client.js';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// 判断是否在 Electron 主窗口环境中运行
// Electron 主窗口支持 <webview> 标签渲染 PDF；浏览器和嵌入式 webview 不支持
// 通过 window.KSElectron（preload 注入）判断，与 api/client.js 保持一致
const isElectron = typeof window !== 'undefined' && !!window.KSElectron;

const docStore = useDocumentStore();
const activeTab = ref('preview'); // 'preview' | 'text'
const ideaStore = useIdeaStore();
const pdfObjectUrl = ref('');
const renderedContainer = ref(null);
// 用于强制重建 PDF iframe，确保 #page=N 跳转生效
const pdfFrameKey = ref(0);
const pdfLoadFailed = ref(false);
// Idea 自动保存相关状态
const isSaving = ref(false);   // 防止重复保存标志
const isDirty = ref(false);     // 标记 Idea 内容是否有未保存的修改

function onPdfLoadFail(event) {
  console.warn('[Editor] PDF webview 加载失败:', event);
  pdfLoadFailed.value = true;
}

/** 重试 PDF 加载：重置失败标志并递增 key 触发 webview 重建 */
function retryPdfLoad() {
  pdfLoadFailed.value = false;
  pdfFrameKey.value++;
}

function closeDoc() {
  docStore.setActive(null);
  ideaStore.setActive(null);
}

function revokePdfUrl() {
  if (pdfObjectUrl.value) {
    // 只有 blob: URL 才需要调用 revokeObjectURL 释放资源
    // HTTP URL（如本地后端服务地址）无需也无法 revoke
    if (pdfObjectUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(pdfObjectUrl.value);
    }
    pdfObjectUrl.value = '';
  }
}

function updatePdfUrl() {
  revokePdfUrl();
  pdfLoadFailed.value = false;
  const doc = docStore.activeDoc;
  const isPdf = doc && (doc.meta.type === 'pdf' || doc.meta.type === 'pdf-extracted');
  if (isPdf && (doc.filePath || doc.rawBase64)) {
    // Electron 中 blob URL 在 iframe 内渲染 PDF 经常灰屏，改为直接走本地 HTTP 服务
    // iframe 无法携带自定义请求头，通过 query token 完成本地后端认证
    const tokenQs = API_TOKEN ? `?token=${encodeURIComponent(API_TOKEN)}` : '';
    pdfObjectUrl.value = `${BASE}/documents/${doc.meta.docId}/pdf${tokenQs}`;
  }
}

function pdfViewerSrc() {
  if (!pdfObjectUrl.value) return '';
  const page = docStore.activePage && docStore.activePage > 1 ? docStore.activePage : 1;
  return `${pdfObjectUrl.value}#page=${page}&toolbar=1&navpanes=0&view=FitH`;
}

// 文档切换或 PDF URL 变化时，重建 iframe 以确保页码跳转生效
watch(() => docStore.activeDoc?.meta?.docId, () => {
  updatePdfUrl();
  pdfFrameKey.value++;
  // 文档切换后，若有 jumpKeyword，等待 DOM 渲染完成后高亮
  if (docStore.jumpKeyword) {
    nextTick(() => {
      requestAnimationFrame(() => highlightKeyword(docStore.jumpKeyword));
    });
  }
}, { immediate: true });

// activePage 变化时，通过 :key 重建 iframe 让 PDF 跳转到指定页
watch(() => docStore.activePage, () => {
  pdfFrameKey.value++;
});

// 文档加载完成后，若存在 jumpOffset/jumpKeyword 则精确定位到对应文本
watch(() => docStore.activeDocId, async () => {
  await nextTick();
  if ((docStore.jumpOffset > 0 || docStore.jumpKeyword) && renderedContainer.value) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => performJump());
    });
  }
});

// jumpOffset 变化时（同一文档内切换节点）也重新定位
watch(() => docStore.jumpOffset, (offset) => {
  if (offset > 0 && renderedContainer.value) {
    nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => performJump());
      });
    });
  }
});

// 组件挂载时重新生成 PDF URL，确保预览恢复
// （Editor 未被 KeepAlive 包裹，在 FileExplorer 中通过 v-if 渲染，
//   故 onActivated/onDeactivated 永远不会触发，改用 onMounted/onUnmounted）
onMounted(() => {
  updatePdfUrl();
  // 监听项目切换前事件，立即 flush 保存未提交的 Idea 内容并注册 flush Promise
  window.addEventListener('project:pre-switch', onPreSwitch);
});

// 组件卸载时保存未提交的 Idea 内容，并释放 PDF Object URL
onUnmounted(() => {
  // 设置销毁标志，防止 saveChain 的 then 回调在组件卸载后仍执行保存操作
  destroyed = true;
  flushIdeaSave();
  // 清理所有未触发的保存定时器（flushIdeaSave 仅清理当前活动 Idea 的定时器，
  // 其他 Idea 的防抖定时器仍可能存在，需全部清除避免卸载后误触发）
  for (const [, timer] of saveTimers) {
    clearTimeout(timer);
  }
  saveTimers.clear();
  // 清理 saveVersions 中非当前 Idea 的条目（当前 Idea 的条目保留，供可能正在进行的保存做版本校验）
  const currentIdeaId = activeContent.value?.data?.id;
  for (const ideaId of saveVersions.keys()) {
    if (ideaId !== currentIdeaId) {
      saveVersions.delete(ideaId);
    }
  }
  revokePdfUrl();
  window.removeEventListener('project:pre-switch', onPreSwitch);
});

/** 清除之前的高亮标记 */
function clearHighlights() {
  const container = renderedContainer.value;
  if (!container) return;
  const marks = container.querySelectorAll('mark.kg-jump-highlight');
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  }
}

/** 收集容器内所有文本节点及其在纯文本中的累计偏移范围 */
function getTextNodesWithOffsets(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const result = [];
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('mark.kg-jump-highlight')) continue;
    const text = node.textContent || '';
    if (text.length > 0) {
      result.push({ node, start: offset, end: offset + text.length, text });
      offset += text.length;
    }
  }
  return { nodes: result, totalLength: offset };
}

/** 在指定字符偏移处高亮并滚动（用于 docx/markdown 等可滚动文档） */
function highlightAtOffset(offset, length = Math.max(1, Math.min(20, docStore.jumpKeyword?.length || 1))) {
  const container = renderedContainer.value;
  if (!container) return false;
  clearHighlights();
  if (offset < 0) return false;

  const { nodes } = getTextNodesWithOffsets(container);
  const target = offset;
  for (const item of nodes) {
    if (target >= item.start && target < item.end) {
      const nodeOffset = target - item.start;
      const highlightLen = Math.min(length, item.text.length - nodeOffset);
      if (highlightLen <= 0) continue;
      const range = document.createRange();
      range.setStart(item.node, nodeOffset);
      range.setEnd(item.node, nodeOffset + highlightLen);
      const mark = document.createElement('mark');
      mark.className = 'kg-jump-highlight';
      try {
        range.surroundContents(mark);
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      } catch {
        item.node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
    }
  }
  return false;
}

/** 在渲染后的文档中高亮并滚动到关键词 */
function highlightKeyword(keyword, targetOffset = -1) {
  if (!keyword) {
    clearHighlights();
    return false;
  }
  const container = renderedContainer.value;
  if (!container) return false;
  clearHighlights();

  const { nodes } = getTextNodesWithOffsets(container);
  const matches = [];
  for (const item of nodes) {
    let idx = item.text.indexOf(keyword);
    while (idx !== -1) {
      const absStart = item.start + idx;
      matches.push({ node: item.node, start: absStart, end: absStart + keyword.length, nodeOffset: idx });
      idx = item.text.indexOf(keyword, idx + 1);
    }
  }
  if (matches.length === 0) return false;

  // 如果提供了目标偏移，优先选择离目标偏移最近的一次出现
  let selected = matches[0];
  if (targetOffset >= 0 && matches.length > 1) {
    selected = matches.reduce((best, m) =>
      Math.abs(m.start - targetOffset) < Math.abs(best.start - targetOffset) ? m : best
    );
  }

  const range = document.createRange();
  range.setStart(selected.node, selected.nodeOffset);
  range.setEnd(selected.node, selected.nodeOffset + keyword.length);
  const mark = document.createElement('mark');
  mark.className = 'kg-jump-highlight';
  try {
    range.surroundContents(mark);
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    selected.node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return true;
}

function performJump() {
  const kw = docStore.jumpKeyword;
  const offset = docStore.jumpOffset || 0;
  const container = renderedContainer.value;
  if (!container) return;

  // 策略：偏移量作为"位置提示"，关键词作为"高亮目标"
  // 1. 有关键词时：搜索所有出现，选择离 offset 最近的一次高亮（最可靠）
  // 2. 关键词搜索失败时：按 offset 直接高亮该位置的文本（兜底）
  // 3. 两者都失败时：不做任何操作
  if (kw) {
    const ok = highlightKeyword(kw, offset > 0 ? offset : -1);
    if (ok) return;
  }
  if (offset > 0) {
    highlightAtOffset(offset);
  }
}

watch(() => docStore.jumpKeyword, (kw) => {
  if (!kw && !(docStore.jumpOffset > 0)) return;
  if (!docStore.activeDoc) return;
  // 等待 DOM 更新后再高亮（双重 rAF 确保渲染完成）
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => performJump());
    });
  });
});

const activeContent = computed(() => {
  if (ideaStore.activeIdea) {
    return { type: 'idea', data: ideaStore.activeIdea };
  }
  if (docStore.activeDoc) {
    return { type: 'doc', data: docStore.activeDoc };
  }
  return null;
});

const docxHtml = computed(() => {
  const html = activeContent.value?.data?.rawHtml || '';
  return html.trim().length > 0 ? html : '';
});

// 使用 DOMPurify 净化 Word HTML，防止 XSS
const sanitizedDocxHtml = computed(() => DOMPurify.sanitize(docxHtml.value || ''));

/** 转义 HTML，防止高亮替换被原始内容破坏 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 判断 section 是否为代码块 */
function isCodeSection(section) {
  if (section && section.type === 'code') return true;
  // 文档级代码类型（.js/.py/.ts）下所有 section 视为代码
  const docType = activeContent.value && activeContent.value.data
    && activeContent.value.data.meta && activeContent.value.data.meta.type;
  return docType === 'code';
}

/** 推断代码语言 */
function inferLang(section) {
  if (section && section.lang) return section.lang;
  const name = (activeContent.value && activeContent.value.data
    && activeContent.value.data.meta && activeContent.value.data.meta.name) || '';
  const n = name.toLowerCase();
  if (n.endsWith('.py')) return 'python';
  return 'js';
}

/** 轻量语法高亮：关键字 / 字符串 / 注释着色 */
function highlightCode(code, lang) {
  const escaped = escapeHtml(code == null ? '' : code);
  const isPy = (lang || inferLang(null)) === 'python';

  const keywords = isPy
    ? ['def','class','if','else','elif','for','while','return','import','from','as','try','except','finally','with','lambda','None','True','False','and','or','not','in','is','pass','break','continue','global','nonlocal','yield','raise','assert','del','print','self']
    : ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','this','import','export','from','default','try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false','async','await','yield','delete','void','console','require'];

  const kwPattern = keywords
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // 注释：Python 用 #，JS 用 // 与 /* */
  const commentPattern = isPy
    ? '(#[^\\n]*)'
    : '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)';
  // 字符串：单引号 / 双引号 / 模板字符串
  const stringPattern = '(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)';

  const combined = new RegExp(
    `${commentPattern}|${stringPattern}|\\b(${kwPattern})\\b`,
    'g'
  );

  return escaped.replace(combined, (match, comment, str, kw) => {
    if (comment) return `<span class="hl-comment">${comment}</span>`;
    if (str) return `<span class="hl-string">${str}</span>`;
    if (kw) return `<span class="hl-keyword">${kw}</span>`;
    return match;
  });
}

/** 渲染高亮后的代码 HTML */
function highlightedCode(section) {
  return highlightCode(section.content, inferLang(section));
}

/** 渲染 Markdown 为 HTML（使用 DOMPurify 净化，防止 XSS） */
function renderMarkdown(text) {
  return DOMPurify.sanitize(md.render(text || ''));
}

// 防抖 + 序列化保存：避免竞态条件导致旧内容覆盖新内容
const saveTimers = new Map();      // ideaId -> 防抖定时器
let saveChain = Promise.resolve(); // 序列化保存请求的链式 Promise
const saveVersions = new Map();    // ideaId -> 最新保存版本号
// 组件销毁标志：防止卸载后 saveChain 回调仍执行保存操作，避免旧项目内容写入新项目
let destroyed = false;

/** 标记当前 Idea 内容已修改（用于 @input 事件） */
function markDirty() {
  if (activeContent.value?.type === 'idea') {
    isDirty.value = true;
  }
}

function saveIdeaContent(idea = null) {
  const target = idea || activeContent.value?.data;
  if (!target?.id) return;
  const ideaId = target.id;
  // 防抖：同一 Idea 在 500ms 内多次调用只保留最后一次，减少不必要的保存请求
  if (saveTimers.has(ideaId)) clearTimeout(saveTimers.get(ideaId));
  saveTimers.set(ideaId, setTimeout(() => {
    saveTimers.delete(ideaId);
    const version = (saveVersions.get(ideaId) || 0) + 1;
    saveVersions.set(ideaId, version);
    // 序列化：将保存请求加入链式 Promise，确保按顺序执行，
    // 避免并发请求乱序完成导致旧内容覆盖新内容
    saveChain = saveChain.then(async () => {
      // 组件已卸载，跳过保存避免旧项目内容写入新项目
      if (destroyed) return;
      // 在 await 之前检查版本号：若有更新的保存请求已排队，则跳过本次过期保存
      if (version !== saveVersions.get(ideaId)) return;
      try {
        await ideaStore.updateIdea(ideaId, {
          title: target.title,
          content: target.content
        });
        // 保存成功后清除脏标记（仅当保存的是当前活动 Idea 时）
        if (activeContent.value?.data?.id === ideaId) {
          isDirty.value = false;
        }
      } catch (e) {
        console.error('保存 Idea 内容失败:', e);
      }
      // 保存完成后清理：若当前版本仍为最新（无更新的保存请求排队），
      // 删除该条目避免 saveVersions Map 随编辑不同 Idea 而无限增长。
      // 下次保存时 version 会从 1 重新计数，不影响序列化正确性。
      if (version === saveVersions.get(ideaId)) {
        saveVersions.delete(ideaId);
      }
    });
  }, 500));
}

/**
 * 立即保存当前 Idea 内容（跳过防抖延迟）。
 * 用于 onDeactivated / onUnmounted 钩子，确保切换标签页或关闭组件时
 * 未提交的 Idea 内容不会丢失。
 */
function flushIdeaSave() {
  const target = activeContent.value?.data;
  // 仅在 Idea 模式下、有有效 id、内容已修改且未在保存中时执行
  if (activeContent.value?.type !== 'idea' || !target?.id) return;
  if (!isDirty.value) return;     // 内容未修改，无需保存
  if (isSaving.value) return;     // 正在保存中，避免重复

  // 取消待执行的防抖保存定时器，改为立即保存
  if (saveTimers.has(target.id)) {
    clearTimeout(saveTimers.get(target.id));
    saveTimers.delete(target.id);
  }

  isSaving.value = true;
  // 不在此处清除 isDirty，等保存成功后再清除，避免保存失败时丢失脏标记
  const ideaId = target.id;
  const version = (saveVersions.get(ideaId) || 0) + 1;
  saveVersions.set(ideaId, version);
  saveChain = saveChain.then(async () => {
    // 组件已卸载，跳过保存
    if (destroyed) {
      isSaving.value = false;
      return;
    }
    if (version !== saveVersions.get(ideaId)) {
      isSaving.value = false;
      return;
    }
    try {
      await ideaStore.updateIdea(ideaId, {
        title: target.title,
        content: target.content
      });
      // 保存成功后才清除脏标记（仅当保存的是当前活动 Idea 时）
      if (activeContent.value?.data?.id === ideaId) {
        isDirty.value = false;
      }
    } catch (e) {
      console.error('保存 Idea 内容失败:', e);
      // 保存失败时保持 isDirty 为 true，确保后续修改仍会被保存
      if (activeContent.value?.data?.id === ideaId) {
        isDirty.value = true;
      }
    } finally {
      isSaving.value = false;
    }
    // 保存完成后清理：若当前版本仍为最新，删除条目避免 Map 增长
    if (version === saveVersions.get(ideaId)) {
      saveVersions.delete(ideaId);
    }
  });
}

/**
 * 项目切换前事件处理：立即 flush 保存未提交的 Idea 内容，
 * 并将当前 saveChain 注册到事件携带的 Promise 收集器中，
 * 供 switchProject 等待所有 flush 保存完成后再切换项目。
 */
function onPreSwitch(event) {
  flushIdeaSave();
  // 将当前 saveChain 注册到收集器，确保 switchProject 等待所有排队中的保存请求完成
  const flushPromises = event?.detail?.flushPromises;
  if (Array.isArray(flushPromises)) {
    flushPromises.push(saveChain);
  }
}

// 切换 Idea 前保存上一个 Idea 的内容，避免点击列表切换时未触发 blur 导致内容丢失
watch(activeContent, (newVal, oldVal) => {
  if (oldVal?.type === 'idea' && oldVal?.data) {
    saveIdeaContent(oldVal.data);
  }
});

// 监听 Idea 列表变化，清理已删除 Idea 在 saveVersions / saveTimers 中的残留条目。
// Idea 被删除后其 ideaId 不再存在于 ideaStore.ideas 中，对应的版本号和防抖定时器需及时回收，
// 避免内存泄漏及过期定时器在卸载后误触发。
watch(() => ideaStore.ideas, (ideas) => {
  const existingIds = new Set(ideas.map(i => i.id));
  for (const ideaId of saveVersions.keys()) {
    if (!existingIds.has(ideaId)) {
      saveVersions.delete(ideaId);
    }
  }
  for (const ideaId of saveTimers.keys()) {
    if (!existingIds.has(ideaId)) {
      clearTimeout(saveTimers.get(ideaId));
      saveTimers.delete(ideaId);
    }
  }
});
</script>

<template>
  <div class="editor">
    <div v-if="!activeContent" class="empty-editor">
      <span class="big-icon" aria-hidden="true">📄</span>
      <p class="empty-title">尚未打开文档</p>
      <p class="empty-hint">从上方文件列表选择文档或 Idea 开始查看与编辑</p>
    </div>
    <div v-else-if="activeContent.type==='doc'" class="doc-viewer">
      <div class="doc-toolbar">
        <h2>{{ activeContent.data.meta.name }}</h2>
        <div class="doc-actions">
          <button
            v-if="activeContent.data.meta.type === 'pdf' || activeContent.data.meta.type === 'pdf-extracted'"
            class="tab-btn"
            :class="{ active: activeTab === 'preview' }"
            :aria-pressed="activeTab === 'preview'"
            aria-label="查看原文件"
            @click="activeTab = 'preview'"
          >原文件</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'text' }"
            :aria-pressed="activeTab === 'text'"
            aria-label="查看提取文本"
            @click="activeTab = 'text'"
          >提取文本</button>
          <button class="close-btn" title="关闭文档" aria-label="关闭文档" @click="closeDoc">×</button>
        </div>
      </div>
      <div class="rendered-viewer">
        <!-- PDF / pdf-extracted：原文件渲染 + 页级跳转 -->
        <template v-if="activeContent.data.meta.type === 'pdf' || activeContent.data.meta.type === 'pdf-extracted'">
          <!-- Electron 环境：使用 <webview> 渲染 PDF（支持原生 PDF 查看器） -->
          <webview
            v-if="isElectron && activeTab === 'preview' && pdfObjectUrl && !pdfLoadFailed"
            :key="pdfFrameKey"
            :src="pdfViewerSrc()"
            partition="persist:pdfviewer"
            class="pdf-frame"
            :title="`PDF 预览：${activeContent.data.meta.name}`"
            @did-fail-load="onPdfLoadFail"
          />
          <!-- 浏览器环境：使用 <iframe> 渲染 PDF -->
          <iframe
            v-else-if="!isElectron && activeTab === 'preview' && pdfObjectUrl && !pdfLoadFailed"
            :key="'iframe-' + pdfFrameKey"
            :src="pdfViewerSrc()"
            class="pdf-frame"
            :title="`PDF 预览：${activeContent.data.meta.name}`"
            @error="onPdfLoadFail"
          />
          <div v-else-if="activeTab === 'preview' && pdfLoadFailed" class="render-fallback">
            PDF 预览加载失败，可使用浏览器打开：
            <a :href="pdfObjectUrl" target="_blank">点击打开 PDF</a>
            <button class="retry-btn" @click="retryPdfLoad">重试</button>
          </div>
          <div v-else-if="activeTab === 'preview' && !pdfObjectUrl" class="render-fallback">
            无法渲染原始 PDF
          </div>
          <pre v-else-if="activeTab === 'text'" class="text-pre extracted-text">{{ activeContent.data.rawText }}</pre>
        </template>
        <!-- Word：格式化 HTML -->
        <div v-else-if="activeContent.data.meta.type === 'docx' && docxHtml" ref="renderedContainer" class="docx-html" v-html="sanitizedDocxHtml" />
        <div v-else-if="activeContent.data.meta.type === 'docx' && !docxHtml" ref="renderedContainer" class="docx-fallback">
          <div class="fallback-hint">Word 文档无可用 HTML 渲染，已回退到纯文本</div>
          <pre class="text-pre">{{ activeContent.data.rawText }}</pre>
        </div>
        <!-- Markdown：渲染 HTML -->
        <div v-else-if="activeContent.data.meta.type === 'markdown'" ref="renderedContainer" class="markdown-html" v-html="renderMarkdown(activeContent.data.rawText)" />
        <!-- 代码：语法高亮分段 -->
        <div v-else-if="activeContent.data.meta.type === 'code'" class="code-sections">
          <div v-for="section in activeContent.data.sections" :key="section.id" class="section">
            <h3>{{ section.title }}</h3>
            <pre class="code-block" v-html="highlightedCode(section)"></pre>
          </div>
        </div>
        <!-- 纯文本：格式化 -->
        <pre v-else class="text-pre">{{ activeContent.data.rawText }}</pre>
      </div>
    </div>
    <div v-else-if="activeContent.type==='idea'" class="idea-editor">
      <div class="idea-save-indicator" role="status" aria-live="polite">
        <span v-if="isSaving" class="save-status saving" style="color:#f59e0b;font-size:11px;">保存中...</span>
        <span v-else-if="isDirty" class="save-status unsaved" style="color:#eab308;font-size:11px;">● 未保存</span>
        <span v-else class="save-status saved" style="color:#10b981;font-size:11px;">● 已保存</span>
      </div>
      <input v-model="activeContent.data.title" placeholder="Idea 标题" class="idea-title-input" aria-label="Idea 标题" @blur="saveIdeaContent" @input="markDirty"/>
      <textarea v-model="activeContent.data.content" placeholder="详细描述你的想法..." class="idea-content-input" aria-label="Idea 详细内容" @blur="saveIdeaContent" @input="markDirty"></textarea>
    </div>
  </div>
</template>
