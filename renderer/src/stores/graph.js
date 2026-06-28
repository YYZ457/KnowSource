/** @module state/stores/graph
 *  职责：图谱数据与查询状态（通过 API 客户端与后端交互）
 */
import { defineStore } from 'pinia';
import { client } from '@/api/client.js';
import { useProjectStore } from './project.js';
import { useToastStore } from './toast';
import { readKGExtractOptions } from '@/utils/kg-options';

export const useGraphStore = defineStore('graph', {
  state: () => ({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    highlightedNodes: new Set(), // 搜索/匹配命中的节点
    queryResults: [],
    loading: false, // 图谱数据加载中
    loadGeneration: 0, // 加载请求序号，用于丢弃过期的响应
    building: false, // 图谱构建中
    buildProgress: { stage: '', percent: 0, log: '', chunkIndex: 0, chunkCount: 0 }
  }),
  getters: {
    selectedNode: (state) => state.nodes.find(n => n.id === state.selectedNodeId) || null,
    nodeCount: (state) => state.nodes.length,
    edgeCount: (state) => state.edges.length
  },
  actions: {
    /**
     * 加载当前项目的图谱数据
     * @param {{ throwOnError?: boolean }} [options] - throwOnError 为 true 时加载失败会抛出异常，供 switchProject 统一回滚
     */
    async loadGraph(options = {}) {
      const generation = ++this.loadGeneration;
      const projectStore = useProjectStore();
      const expectedProjectId = projectStore.currentProjectId;
      this.loading = true;
      try {
        const data = await client.getGraphStats();
        // 若请求期间项目已切换或已有更新的加载请求，则丢弃旧响应
        if (generation !== this.loadGeneration || projectStore.currentProjectId !== expectedProjectId) {
          return;
        }
        this.nodes = data.nodes || [];
        this.edges = data.edges || [];
      } catch (e) {
        console.error('加载图谱失败:', e);
        // throwOnError 时由调用方统一处理错误提示，避免重复弹窗
        if (options.throwOnError) throw e;
        // 网络错误（后端不可用）时使用统一消息，借助 toast 去重避免多条刷屏
        const msg = e?.status === null ? (e?.message || '网络请求失败') : '加载图谱失败: ' + (e?.message || e);
        useToastStore().error(msg);
      } finally {
        if (generation === this.loadGeneration) {
          this.loading = false;
        }
      }
    },
    async buildGraph(extractOptions, docIds) {
      if (this.building) {
        throw new Error('图谱正在构建中，请等待完成后再操作');
      }
      this.building = true;
      this.buildProgress = { stage: 'start', percent: 0, log: '准备构建知识图谱...', chunkIndex: 0, chunkCount: 0 };
      // 项目切换保护：构建是耗时操作，期间用户可能切换项目。
      // 记录起始项目 ID，构建完成后若项目已变则丢弃结果，避免旧项目数据覆盖新项目。
      const projectStore = useProjectStore();
      const startProjectId = projectStore.currentProjectId;
      // 进度轮询：使用递归 setTimeout，确保上一次轮询完成后才调度下一次，避免并发请求堆积
      let progressTimer = null;
      let warningShown = false;
      const pollProgress = async () => {
        if (!this.building) return;
        try {
          const p = await client.getProgress();
          // await 期间可能已被 clear/stop 停止，需二次检查避免写入过期进度
          if (!this.building) return;
          if (p && p.taskId && p.taskId.startsWith('graph-build')) {
            this.buildProgress = {
              stage: p.stage || '',
              percent: p.percent || 0,
              log: p.log || '',
              chunkIndex: p.chunkIndex || 0,
              chunkCount: p.chunkCount || 0
            };
            // 检测长时间无更新（卡死检测）
            const now = Date.now();
            const updated = p.updatedAt || 0;
            if (p.stage !== 'done' && p.stage !== 'error' && updated > 0 && now - updated > 30000) {
              // 30 秒无更新，提示可能卡住（仅追加一次，避免每 500ms 重复追加警告文本）
              if (!warningShown) {
                warningShown = true;
                this.buildProgress = {
                  ...this.buildProgress,
                  log: (p.log || '') + ' ⚠ 已超过 30 秒无更新，模型可能正在处理或已卡住，请耐心等待...'
                };
              }
            }
          }
        } catch (e) {
          // 轮询失败时忽略，不打断构建
        }
        // 上一次轮询完成后才调度下一次
        if (this.building) {
          progressTimer = setTimeout(pollProgress, 500);
        }
      };
      try {
        progressTimer = setTimeout(pollProgress, 500);

        const result = await client.buildGraph({ extractOptions }, docIds);
        clearTimeout(progressTimer);
        progressTimer = null;
        // 项目切换保护：构建期间若项目已切换，丢弃结果避免覆盖新项目图谱数据
        if (projectStore.currentProjectId !== startProjectId) {
          this.buildProgress = { stage: 'cancelled', percent: 100, log: '项目已切换，构建结果已丢弃', chunkIndex: 0, chunkCount: 0 };
          return result;
        }
        this.nodes = result.nodes || [];
        this.edges = result.edges || [];
        this.buildProgress = { stage: 'done', percent: 100, log: `构建完成：${this.nodes.length} 节点，${this.edges.length} 边`, chunkIndex: 0, chunkCount: 0 };
        return result;
      } catch (e) {
        console.error('构建图谱失败:', e);
        this.buildProgress = { stage: 'error', percent: 100, log: '构建失败: ' + (e?.message || e), chunkIndex: 0, chunkCount: 0 };
        throw e;
      } finally {
        if (progressTimer) clearTimeout(progressTimer);
        this.building = false;
      }
    },
    /**
     * 为单个文档构建知识图谱，并选中/高亮该文档节点。
     * 提取自 FileExplorer.vue 和 GraphView.vue 中的重复实现。
     * @param {string} docId - 文档 ID
     * @returns {Promise<object>} buildGraph 的返回结果
     */
    async buildGraphForDoc(docId) {
      const extractOptions = readKGExtractOptions();
      const result = await this.buildGraph(extractOptions, [docId]);
      // 通过 source.docId 查找文档节点，避免依赖固定的 id 命名格式（如 doc-${docId}）
      const docNode = this.nodes.find(n => n.source?.docId === docId && n.type === 'document');
      if (docNode) {
        this.selectNode(docNode.id);
        this.setHighlightedNodes([docNode.id]);
      }
      return result;
    },
    async rebuildCrossLinks(options = {}) {
      if (this.building) {
        throw new Error('图谱正在构建中，请等待构建完成后再重建跨文档关联');
      }
      this.building = true;
      // 项目切换保护：重建是耗时操作，期间用户可能切换项目
      const projectStore = useProjectStore();
      const startProjectId = projectStore.currentProjectId;
      let progressTimer = null;
      // 进度轮询：使用递归 setTimeout，确保上一次轮询完成后才调度下一次，避免并发请求堆积
      const pollProgress = async () => {
        if (!this.building) return;
        try {
          const p = await client.getProgress();
          // await 期间可能已被 clear/stop 停止，需二次检查避免写入过期进度
          if (!this.building) return;
          if (p && p.taskId && p.taskId.startsWith('crosslinks-rebuild')) {
            this.buildProgress = {
              stage: p.stage || '',
              percent: p.percent || 0,
              log: p.log || '',
              chunkIndex: 0,
              chunkCount: 0
            };
          }
        } catch {
          // ignore
        }
        // 上一次轮询完成后才调度下一次
        if (this.building) {
          progressTimer = setTimeout(pollProgress, 500);
        }
      };
      try {
        this.buildProgress = { stage: 'crossLink', percent: 10, log: '正在重新计算跨文档关联...', chunkIndex: 0, chunkCount: 0 };
        progressTimer = setTimeout(pollProgress, 500);

        const result = await client.rebuildCrossLinks(options);
        clearTimeout(progressTimer);
        progressTimer = null;
        // 项目切换保护：重建期间若项目已切换，丢弃结果避免覆盖新项目图谱数据
        if (projectStore.currentProjectId !== startProjectId) {
          this.buildProgress = { stage: 'cancelled', percent: 100, log: '项目已切换，重建结果已丢弃', chunkIndex: 0, chunkCount: 0 };
          return result;
        }
        if (result.success) {
          this.nodes = result.nodes || this.nodes;
          this.edges = result.edges || this.edges;
          this.buildProgress = { stage: 'done', percent: 100, log: `跨文档关联重建完成：${result.crossLinks || 0} 条 cross-link`, chunkIndex: 0, chunkCount: 0 };
        } else {
          throw new Error(result.error || '重建失败');
        }
        return result;
      } catch (e) {
        console.error('重建跨文档关联失败:', e);
        this.buildProgress = { stage: 'error', percent: 100, log: '重建失败: ' + (e?.message || e), chunkIndex: 0, chunkCount: 0 };
        throw e;
      } finally {
        if (progressTimer) clearTimeout(progressTimer);
        this.building = false;
      }
    },
    async addNode(node) {
      const res = await client.createGraphNode(node);
      if (res.error) throw new Error(res.error);
      this.nodes = [...this.nodes, res.node];
      return res.node;
    },
    async updateNode(id, patch) {
      const res = await client.updateGraphNode(id, patch);
      if (res.error) throw new Error(res.error);
      this.nodes = this.nodes.map(n => n.id === id ? res.node : n);
      return res.node;
    },
    async removeNode(id) {
      const res = await client.deleteGraphNode(id);
      if (res.error) throw new Error(res.error);
      this.nodes = this.nodes.filter(n => n.id !== id);
      this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
      if (this.selectedNodeId === id) this.selectedNodeId = null;
      return res;
    },
    async addEdge(edge) {
      const res = await client.createGraphEdge(edge);
      if (res.error) throw new Error(res.error);
      this.edges = [...this.edges, res.edge];
      return res.edge;
    },
    async removeEdge(from, to, type) {
      const res = await client.deleteGraphEdge(from, to, type);
      if (res.error) throw new Error(res.error);
      this.edges = this.edges.filter(e => !(e.from === from && e.to === to && (!type || e.type === type)));
      return res;
    },
    selectNode(nodeId) {
      this.selectedNodeId = nodeId;
    },
    setHighlightedNodes(ids) {
      this.highlightedNodes = new Set(ids);
    },
    setQueryResults(results) {
      this.queryResults = results;
    },
    clear() {
      this.nodes = [];
      this.edges = [];
      this.selectedNodeId = null;
      this.highlightedNodes = new Set();
      this.queryResults = [];
      this.building = false;
      this.buildProgress = { stage: '', percent: 0, log: '', chunkIndex: 0, chunkCount: 0 };
      // 重置 loading：若 clear 时仍有 in-flight 请求，其 finally 会因 generation 不匹配而跳过重置
      this.loading = false;
    }
  }
});
