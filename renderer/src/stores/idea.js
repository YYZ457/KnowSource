/** @module state/stores/idea
 *  职责：Idea 列表与活动 Idea 状态（通过 API 客户端与后端交互）
 *  重构：支持父子树形嵌套
 */
import { defineStore } from 'pinia';
import { client } from '@/api/client.js';
import { useProjectStore } from './project.js';
import { useToastStore } from '@/stores/toast';

export const useIdeaStore = defineStore('idea', {
  state: () => ({
    ideas: [],
    activeIdeaId: null,
    recommendations: [],
    loading: false, // Idea 数据加载中
    loadGeneration: 0 // 加载请求序号，用于丢弃过期的响应
  }),
  getters: {
    activeIdea: (state) => state.ideas.find(i => i.id === state.activeIdeaId) || null,
    ideaCount: (state) => state.ideas.length,
    /** 构建 Idea 树（根节点数组，每个节点含 children） */
    ideaTree: (state) => {
      const ideaMap = new Map(state.ideas.map(i => [i.id, { ...i, children: [] }]));
      const roots = [];
      for (const node of ideaMap.values()) {
        if (node.parentId && ideaMap.has(node.parentId)) {
          ideaMap.get(node.parentId).children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    }
  },
  actions: {
    /**
     * 加载当前项目的 Idea 列表
     * @param {{ throwOnError?: boolean }} [options] - throwOnError 为 true 时加载失败会抛出异常，供 switchProject 统一回滚
     */
    async loadIdeas(options = {}) {
      const generation = ++this.loadGeneration;
      const projectStore = useProjectStore();
      const expectedProjectId = projectStore.currentProjectId;
      this.loading = true;
      try {
        const ideas = await client.listIdeas();
        // 若请求期间项目已切换或已有更新的加载请求，则丢弃旧响应
        if (generation !== this.loadGeneration || projectStore.currentProjectId !== expectedProjectId) {
          return;
        }
        this.ideas = ideas;
      } catch (e) {
        console.error('加载 Idea 失败:', e);
        // throwOnError 时由调用方统一处理错误提示，避免重复弹窗
        if (options.throwOnError) throw e;
        // 网络错误（后端不可用）时使用统一消息，借助 toast 去重避免多条刷屏
        const msg = e?.status === null ? (e?.message || '网络请求失败') : '加载 Idea 失败: ' + (e?.message || e);
        useToastStore().error(msg);
      } finally {
        if (generation === this.loadGeneration) {
          this.loading = false;
        }
      }
    },
    setIdeas(ideas) {
      this.ideas = ideas;
    },
    async addIdea(idea) {
      try {
        const res = await client.createIdea(idea);
        const created = res.data;
        this.ideas.push(created);
        this.setActive(created.id);
        return created;
      } catch (e) {
        console.error('创建 Idea 失败:', e);
        useToastStore().error('创建 Idea 失败: ' + (e?.message || e));
        throw e; // re-throw 让调用方能检测失败，避免误清空用户输入
      }
    },
    /** 在指定父 Idea 下创建子 Idea */
    async addChildIdea(parentId, idea) {
      try {
        const res = await client.createIdea({ ...idea, parentId });
        const created = res.data;
        this.ideas.push(created);
        this.setActive(created.id);
        return created;
      } catch (e) {
        console.error('创建子 Idea 失败:', e);
        useToastStore().error('创建子 Idea 失败: ' + (e?.message || e));
        throw e; // re-throw 让调用方能检测失败，避免 catch 成为死代码
      }
    },
    async updateIdea(id, patch) {
      const idea = this.ideas.find(i => i.id === id);
      if (!idea) return;
      // 乐观更新：先本地更新，再异步保存，避免等待后端响应期间 Vue 用旧值重新渲染导致输入回退
      const snapshot = { ...idea };
      Object.assign(idea, patch, { updatedAt: Date.now() });
      try {
        await client.updateIdea(id, patch);
      } catch (e) {
        // 回滚到原始快照，避免 UI 显示新值但后端未保存
        Object.assign(idea, snapshot);
        useToastStore().error('更新 Idea 失败: ' + (e?.message || e));
        throw e; // re-throw 让调用方能感知失败，避免静默吞错
      }
    },
    async removeIdea(id) {
      try {
        await client.deleteIdea(id);
        // 递归收集要删除的子 Idea ID
        const toDelete = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const idea of this.ideas) {
            if (idea.parentId && toDelete.has(idea.parentId) && !toDelete.has(idea.id)) {
              toDelete.add(idea.id);
              changed = true;
            }
          }
        }
        this.ideas = this.ideas.filter(i => !toDelete.has(i.id));
        if (toDelete.has(this.activeIdeaId)) this.activeIdeaId = null;
      } catch (e) {
        console.error('删除 Idea 失败:', e);
        throw e;
      }
    },
    setActive(id) {
      this.activeIdeaId = id;
      this.recommendations = [];
    },
    setRecommendations(recs) {
      this.recommendations = recs;
    },
    async fetchRecommendations(id, topN = 5) {
      try {
        this.recommendations = [];
        const data = await client.recommendIdeaNodes(id, topN);
        this.recommendations = data.recommendations || [];
      } catch (e) {
        console.error('获取 Idea 推荐失败:', e);
        this.recommendations = [];
      }
    },
    async linkIdeaToNode(ideaId, nodeId) {
      try {
        const data = await client.linkIdeaToNode(ideaId, nodeId);
        if (data.idea) {
          const idx = this.ideas.findIndex(i => i.id === ideaId);
          if (idx >= 0) this.ideas[idx] = data.idea;
        }
      } catch (e) {
        console.error('关联 Idea 失败:', e);
        throw e;
      }
    },
    async unlinkIdeaFromNode(ideaId, nodeId) {
      try {
        const data = await client.unlinkIdeaFromNode(ideaId, nodeId);
        if (data.idea) {
          const idx = this.ideas.findIndex(i => i.id === ideaId);
          if (idx >= 0) this.ideas[idx] = data.idea;
        }
      } catch (e) {
        console.error('取消关联 Idea 失败:', e);
        throw e;
      }
    },
    clear() {
      this.ideas = [];
      this.activeIdeaId = null;
      this.recommendations = [];
      // 重置 loading：若 clear 时仍有 in-flight 请求，其 finally 会因 generation 不匹配而跳过重置
      this.loading = false;
    }
  }
});
