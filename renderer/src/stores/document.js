/** @module state/stores/document
 *  职责：文档列表与活动文档状态（通过 API 客户端与后端交互）
 */
import { defineStore } from 'pinia';
import { client } from '@/api/client.js';
import { useGraphStore } from './graph.js';
import { useProjectStore } from './project.js';
import { useToastStore } from './toast';
import {
  createDeferred,
  createImportTask,
  findDuplicateTask,
  computeFingerprint
} from '@/utils/import-queue.mjs';

// 模块级进度轮询定时器：setTimeout 返回的定时器 ID 属于实现细节，
// 不应作为响应式状态暴露给组件，故放在模块级变量而非 Pinia state 中
let parseTimer = null;

export const useDocumentStore = defineStore('document', {
  state: () => ({
    documents: [], // [{meta, sections, rawText, rawBase64, rawHtml}]
    activeDocId: null,
    activePage: 1,
    jumpKeyword: '', // 从图谱点击节点时携带的关键词，用于文档内定位
    jumpOffset: 0, // 从图谱点击节点时携带的字符偏移，用于文档内滚动定位
    loading: false,
    isParsing: false,
    loadGeneration: 0, // 加载请求序号，用于丢弃过期的响应
    parseProgress: {      // 当前解析任务进度
      taskId: null,
      status: 'idle',     // idle | running | paused | cancelled
      stage: '',          // parse-text | parse-ocr | parse-merge
      percent: 0,
      log: '',
      currentPage: 0,
      totalPages: 0,
      previewText: ''     // 已解析出的内容预览
    },
    // 导入任务队列：每个任务独立进度/状态，避免全局进度被覆盖
    importTasks: [],
    importConcurrency: 1, // 同时解析数量限制；后端 /progress 为全局进度，默认 1 以保证进度准确
    activeImportTaskId: null,
    importQueueActive: false
  }),
  getters: {
    activeDoc: (state) => state.documents.find(d => d.meta.docId === state.activeDocId) || null,
    docCount: (state) => state.documents.length,
    parseStageText: (state) => {
      const map = {
        'parse-text': '提取文字层',
        'parse-ocr': 'OCR 识别',
        'parse-merge': '合并页面内容',
        'ocr': 'OCR 识别'
      };
      return map[state.parseProgress.stage] || '解析中';
    },
    activeImportTask: (state) => state.importTasks.find(t => t.id === state.activeImportTaskId) || null,
    importTaskStats: (state) => {
      const stats = { queued: 0, parsing: 0, done: 0, error: 0, cancelled: 0, total: state.importTasks.length };
      for (const t of state.importTasks) {
        if (stats[t.status] !== undefined) stats[t.status]++;
      }
      return stats;
    }
  },
  actions: {
    /**
     * 加载当前项目的文档列表
     * @param {{ throwOnError?: boolean }} [options] - throwOnError 为 true 时加载失败会抛出异常，供 switchProject 统一回滚
     */
    async loadDocuments(options = {}) {
      const generation = ++this.loadGeneration;
      const projectStore = useProjectStore();
      const expectedProjectId = projectStore.currentProjectId;
      this.loading = true;
      try {
        const docs = await client.listDocuments();
        // 若请求期间项目已切换或已有更新的加载请求，则丢弃旧响应，避免旧数据覆盖新项目
        if (generation !== this.loadGeneration || projectStore.currentProjectId !== expectedProjectId) {
          return;
        }
        this.documents = docs.map(d => ({
          meta: d.meta,
          sections: d.sections,
          rawText: d.rawText,
          rawBase64: d.rawBase64 || '',
          filePath: d.filePath || '',
          fileSize: d.fileSize || 0,
          rawHtml: d.rawHtml || ''
        }));
      } catch (e) {
        console.error('加载文档失败:', e);
        // throwOnError 时由调用方（switchProject）统一处理错误提示，
        // 避免此处 toast 与调用方 toast 重复弹窗
        if (options.throwOnError) throw e;
        // 网络错误（后端不可用）时使用统一消息，借助 toast 去重避免多条刷屏
        const msg = e?.status === null ? (e?.message || '网络请求失败') : '加载文档失败: ' + (e?.message || e);
        useToastStore().error(msg);
      } finally {
        // 只有当前序号的请求才能重置 loading，避免过期请求污染最新加载状态
        if (generation === this.loadGeneration) {
          this.loading = false;
        }
      }
    },
    startProgressPolling() {
      this.stopProgressPolling();
      this.isParsing = true;
      // 使用递归 setTimeout：确保上一次轮询完成后才调度下一次，避免并发请求堆积
      const poll = async () => {
        if (!this.isParsing) return;
        try {
          const p = await client.getProgress();
          // await 期间可能已被 stopProgressPolling/clear 停止，需二次检查避免写入过期进度
          if (!this.isParsing) return;
          this.parseProgress = {
            taskId: p.taskId || null,
            status: p.status || 'idle',
            stage: p.stage || '',
            percent: typeof p.percent === 'number' ? p.percent : 0,
            log: p.log || '',
            currentPage: p.currentPage || 0,
            totalPages: p.totalPages || 0,
            previewText: p.previewText || ''
          };
          // 将全局进度同步到当前活动任务，实现每个任务独立进度展示
          const activeTask = this.importTasks.find(t => t.id === this.activeImportTaskId);
          if (activeTask) {
            activeTask.progress = { ...this.parseProgress };
          }
          // 任务结束或取消后自动停止轮询
          if (['cancelled', 'done', 'error', 'completed'].includes(this.parseProgress.status) && !this.parseProgress.taskId?.startsWith('graph-build')) {
            this.stopProgressPolling();
            return;
          }
        } catch (e) {
          // 轮询失败不阻断
        }
        // 上一次轮询完成后才调度下一次
        if (this.isParsing) {
          parseTimer = setTimeout(poll, 300);
        }
      };
      parseTimer = setTimeout(poll, 300);
    },
    stopProgressPolling() {
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = null;
      }
      this.isParsing = false;
    },
    resetParseProgress() {
      this.parseProgress = {
        taskId: null,
        status: 'idle',
        stage: '',
        percent: 0,
        log: '',
        currentPage: 0,
        totalPages: 0,
        previewText: ''
      };
    },
    /**
     * 公开 API：导入单个文档。
     * 内部进入导入任务队列，支持去重、并发限制、失败重试。
     * 返回值与原始行为一致：成功返回 doc，失败抛出异常。
     */
    async importDocument(name, content, type) {
      const fingerprint = computeFingerprint(name, content, type);
      const duplicate = findDuplicateTask(this.importTasks, fingerprint);
      if (duplicate) {
        // 同一文件正在导入或已成功导入，直接返回已有结果/等待
        if (duplicate.status === 'done') return duplicate.result;
        return duplicate.deferred.promise;
      }
      const deferred = createDeferred();
      const task = createImportTask(name, content, type);
      task.deferred = deferred;
      this.importTasks.push(task);
      // 限制队列长度，避免无限堆积
      this.trimImportTasks();
      this.processImportQueue();
      return deferred.promise;
    },
    /**
     * 重试失败的导入任务。
     * @param {string} taskId
     */
    async retryImportTask(taskId) {
      const task = this.importTasks.find(t => t.id === taskId);
      if (!task || !task.retryable) return;
      // 重新创建 Deferred，避免旧的 promise 已被消费
      const deferred = createDeferred();
      task.deferred = deferred;
      task.status = 'queued';
      task.error = null;
      task.retryable = false;
      task.progress = {
        status: 'idle',
        stage: '',
        percent: 0,
        log: '',
        currentPage: 0,
        totalPages: 0,
        previewText: ''
      };
      this.processImportQueue();
      return deferred.promise;
    },
    /**
     * 处理导入队列，按 concurrency 限制同时解析数量。
     * 该函数本身是重入安全的：若队列已在处理中，新的入队只会被同一次循环消费。
     */
    async processImportQueue() {
      if (this.importQueueActive) return;
      this.importQueueActive = true;
      this.loading = true;
      try {
        // do-while 确保在任务执行期间新入队的任务也能被同一次处理器消费，
        // 避免在 setTimeout 等待窗口期间漏掉新任务。
        do {
          const running = this.importTasks.filter(t => t.status === 'parsing').length;
          if (running >= this.importConcurrency) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          const next = this.importTasks.find(t => t.status === 'queued');
          if (next) {
            // 顺序执行，确保全局进度与当前活动任务一一对应
            await this.runImportTask(next);
          }
        } while (this.importTasks.some(t => t.status === 'queued'));
      } finally {
        this.importQueueActive = false;
        this.loading = this.importTasks.some(t => t.status === 'parsing');
      }
    },
    /**
     * 执行单个导入任务。
     */
    async runImportTask(task) {
      const projectStore = useProjectStore();
      const startProjectId = projectStore.currentProjectId;
      task.status = 'parsing';
      this.activeImportTaskId = task.id;
      this.resetParseProgress();
      this.startProgressPolling();
      try {
        const doc = await client.parseDocument(task.name, task.content, task.type);
        // 导入完成后检查项目是否变化，若已切换则丢弃结果，避免 push 到错误项目
        if (projectStore.currentProjectId !== startProjectId) {
          task.status = 'cancelled';
          task.error = '项目已切换，导入结果已丢弃';
          task.retryable = false;
          task.deferred.reject(new Error(task.error));
          return;
        }
        task.result = doc;
        task.status = 'done';
        task.retryable = false;
        // 释放内存：导入成功后不再需要原始 base64 内容（失败时保留以便重试）
        task.content = null;
        this.documents.push({
          meta: doc.meta,
          sections: doc.sections,
          rawText: doc.rawText,
          rawBase64: doc.rawBase64 || '',
          filePath: doc.filePath || '',
          fileSize: doc.fileSize || 0,
          rawHtml: doc.rawHtml || ''
        });
        // 实时更新当前项目的文档数量
        projectStore.updateCurrentProjectDocCount(this.documents.length);
        task.deferred.resolve(doc);
      } catch (e) {
        console.error('导入文档失败:', e);
        task.status = 'error';
        task.error = e?.message || String(e);
        task.retryable = true;
        task.deferred.reject(e);
      } finally {
        this.stopProgressPolling();
        this.activeImportTaskId = null;
      }
    },
    /**
     * 清理已完成的导入任务（成功/失败/取消），保留队列中的任务。
     */
    clearDoneImportTasks() {
      this.importTasks = this.importTasks.filter(t => t.status === 'queued' || t.status === 'parsing');
    },
    /**
     * 限制任务队列长度，保留最近任务，优先移除已完成任务。
     */
    trimImportTasks(max = 50) {
      if (this.importTasks.length <= max) return;
      const done = this.importTasks.filter(t => t.status === 'done' || t.status === 'error' || t.status === 'cancelled');
      const toRemove = done.slice(0, this.importTasks.length - max);
      const removeIds = new Set(toRemove.map(t => t.id));
      this.importTasks = this.importTasks.filter(t => !removeIds.has(t.id));
    },
    async pauseParse() {
      try {
        const res = await client.pauseParse();
        this.parseProgress.status = res.status || 'paused';
      } catch (e) {
        console.error('暂停解析失败:', e);
      }
    },
    async resumeParse() {
      try {
        const res = await client.resumeParse();
        this.parseProgress.status = res.status || 'running';
      } catch (e) {
        console.error('继续解析失败:', e);
      }
    },
    async cancelParse() {
      try {
        const res = await client.cancelParse();
        this.parseProgress.status = res.status || 'cancelled';
      } catch (e) {
        console.error('取消解析失败:', e);
      }
    },
    setActive(docId, options = {}) {
      this.activeDocId = docId;
      if (options.page && options.page > 0) {
        this.activePage = options.page;
      } else {
        this.activePage = 1;
      }
      // 始终重置 jumpKeyword：未提供则清空，避免切换文档时残留旧高亮
      this.jumpKeyword = options.keyword || '';
      this.jumpOffset = options.start || 0;
    },
    async removeDocument(docId) {
      try {
        await client.deleteDocument(docId);
      } catch (e) {
        console.error('删除文档失败:', e);
        throw e;
      }
      this.documents = this.documents.filter(d => d.meta.docId !== docId);
      if (this.activeDocId === docId) this.activeDocId = null;
      // 实时更新当前项目的文档数量
      const projectStore = useProjectStore();
      projectStore.updateCurrentProjectDocCount(this.documents.length);
      const graphStore = useGraphStore();
      // 文档删除已在后端完成，图谱重载失败不应让调用方误认为删除失败。
      // 单独捕获并记录，避免吞掉已成功删除的状态。
      try {
        await graphStore.loadGraph();
      } catch (graphErr) {
        console.error('删除文档后重载图谱失败（文档已删除）:', graphErr);
      }
    },
    /**
     * 重新排序文档（拖拽排序后调用）
     * 先在前端更新数组顺序以获得即时视觉反馈，再调用后端 API 持久化
     * @param {string[]} docIds - 按期望顺序排列的文档 ID 数组
     */
    async reorderDocuments(docIds) {
      // 前端即时更新：按 docIds 顺序重排 documents 数组
      const docMap = new Map(this.documents.map(d => [d.meta.docId, d]));
      const reordered = [];
      for (const id of docIds) {
        const doc = docMap.get(id);
        if (doc) reordered.push(doc);
      }
      // 追加未在 docIds 中的文档（容错）
      for (const doc of this.documents) {
        if (!docIds.includes(doc.meta.docId)) reordered.push(doc);
      }
      this.documents = reordered;
      // 调用后端 API 持久化（失败时回滚由 loadDocuments 恢复）
      try {
        await client.reorderDocuments(docIds);
      } catch (e) {
        console.error('持久化文档排序失败:', e);
        // 回滚：重新从后端加载
        await this.loadDocuments();
        throw e;
      }
    },
    clear() {
      this.stopProgressPolling();
      this.resetParseProgress();
      this.documents = [];
      this.activeDocId = null;
      this.importTasks = [];
      this.activeImportTaskId = null;
      this.importQueueActive = false;
      // 重置 loading：若 clear 时仍有 in-flight 请求，其 finally 会因 generation 不匹配而跳过重置，
      // 导致 loading 永远卡在 true。此处显式重置以兜底。
      this.loading = false;
    }
  }
});
