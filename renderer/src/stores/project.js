/**
 * @file 项目（多文件夹）Store
 * @module stores/project
 * @description 管理多个项目/工作空间的创建、切换与删除。
 *   每个项目拥有独立的文档、图谱和 Idea 数据；切换项目时联动
 *   documentStore / graphStore / ideaStore 重新加载。
 */
import { defineStore } from 'pinia';
import { client } from '@/api/client.js';
import { useDocumentStore } from './document.js';
import { useGraphStore } from './graph.js';
import { useIdeaStore } from './idea.js';
import { useUiStore } from './ui.js';
import { useToastStore } from './toast.js';
import { validateProjectName } from '@/utils/validation.js';

/**
 * 项目（多文件夹）Store
 *
 * 管理多个项目/工作空间，每个项目拥有独立的文档、图谱和 Idea 数据。
 * 切换项目时会触发 docStore / graphStore / ideaStore 重新加载数据。
 */
export const useProjectStore = defineStore('project', {
  state: () => ({
    /** 项目列表 [{ id, name, createdAt, updatedAt }] */
    projects: [],
    /** 当前项目 ID */
    currentProjectId: null,
    /** 正在加载项目列表 */
    loading: false,
    /** 正在切换项目 */
    switching: false
  }),

  getters: {
    /** 当前项目对象 */
    currentProject(state) {
      return state.projects.find(p => p.id === state.currentProjectId) || null;
    },
    /** 项目数量 */
    projectCount(state) {
      return state.projects.length;
    }
  },

  actions: {
    /**
     * 加载项目列表
     */
    async loadProjects() {
      this.loading = true;
      try {
        const data = await client.listProjects();
        this.projects = data.projects || [];
        this.currentProjectId = data.currentProjectId || null;
        // 前端也按 updatedAt 降序排序，确保最近使用的项目排在前面（与后端排序保持一致）
        this.projects.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      } catch (e) {
        console.error('[project store] 加载项目列表失败:', e);
        // 网络错误（后端不可用）时提示用户，使用统一消息借助 toast 去重
        if (e?.status === null) {
          useToastStore().error(e?.message || '网络请求失败');
        }
      } finally {
        this.loading = false;
      }
    },

    /**
     * 创建新项目
     * @param {string} name - 项目名称
     * @returns {object} 创建的项目对象
     */
    async createProject(name) {
      const validationError = validateProjectName(name);
      if (validationError) {
        throw new Error(validationError);
      }
      try {
        const data = await client.createProject(name);
        this.projects = data.projects || [];
        this.currentProjectId = data.currentProjectId;
        // 自动切换到新创建的项目
        if (data.project && data.project.id) {
          try {
            await this.switchProject(data.project.id);
          } catch (e) {
            // 切换失败时不影响创建结果（如解析任务进行中无法切换）
            // load 函数在 throwOnError 时不弹 toast，此处需告知用户切换失败
            console.warn('[project store] 自动切换到新项目失败:', e.message);
            useToastStore().warning('项目已创建，但自动切换失败：' + (e?.message || e));
          }
        }
        return data.project;
      } catch (e) {
        console.error('[project store] 创建项目失败:', e);
        throw e;
      }
    },

    /**
     * 统一加载当前项目下各 store 的数据
     * @param {boolean} [throwOnError=false] - 是否将加载错误向上抛出（switchProject 需要统一回滚）
     */
    async _loadCurrentProjectData(throwOnError = false) {
      const docStore = useDocumentStore();
      const graphStore = useGraphStore();
      const ideaStore = useIdeaStore();
      await Promise.all([
        docStore.loadDocuments({ throwOnError }),
        graphStore.loadGraph({ throwOnError }),
        ideaStore.loadIdeas({ throwOnError })
      ]);
    },

    /**
     * 切换项目并重新加载所有数据
     * @param {string} projectId - 目标项目 ID
     */
    async switchProject(projectId) {
      // 防止并发切换：如果正在切换中，直接返回
      if (this.switching) return;
      if (projectId === this.currentProjectId) return;

      // 尽早设置 switching 状态，让 UI 立即显示加载指示器（骨架屏/切换中文字）
      this.switching = true;

      // 提前获取各 store 引用，便于在切换前清空数据和失败后恢复
      const docStore = useDocumentStore();
      const graphStore = useGraphStore();
      const ideaStore = useIdeaStore();
      const uiStore = useUiStore();
      // 记录切换前的项目 ID，用于加载失败后的兜底恢复
      const previousProjectId = this.currentProjectId;

      try {
        // 切换前通知 Editor 立即 flush 保存未提交的 Idea 内容，避免防抖未触发导致内容丢失
        // 使用 Promise 收集器机制：事件携带一个数组，监听方（Editor）将各自的 flush Promise 注册到数组中，
        // switchProject 等待所有注册的 Promise 完成后再执行切换，替代固定延迟，确保保存请求完成后再切换项目
        //
        // 重要：必须在 clear() 之前执行 flush。
        // clear() 会清空 ideaStore.ideas 并置空 activeIdeaId，导致 Editor 的 activeContent 变为 null，
        // flushIdeaSave → ideaStore.updateIdea 会因找不到 idea 而静默跳过（if (!idea) return），
        // 未保存的 Idea 内容将永久丢失。
        const flushPromises = [];
        window.dispatchEvent(new CustomEvent('project:pre-switch', {
          detail: { flushPromises }
        }));
        if (flushPromises.length > 0) {
          await Promise.all(flushPromises);
        }

        // flush 完成后立即清空当前显示的数据与状态，避免新数据加载前旧数据闪现，
        // 同时停止旧项目的解析/构建进度轮询
        docStore.clear();
        graphStore.clear();
        ideaStore.clear();

        // clear() 未覆盖的文档定位状态需单独重置
        docStore.activePage = 1;
        docStore.jumpKeyword = '';
        docStore.jumpOffset = 0;

        const data = await client.switchProject(projectId);
        if (data.error) {
          throw new Error(data.error);
        }
        this.currentProjectId = projectId;
        // 更新项目列表（包含最新的 documentCount 统计）
        if (data.projects) {
          this.projects = data.projects;
        }

        // 加载新项目数据；任一 store 加载失败都会抛出，进入 catch 统一恢复
        await this._loadCurrentProjectData(true);

        // 数据加载完成后，若图谱有节点则自动切换到图谱视图
        if (graphStore.nodes.length > 0) {
          uiStore.setRightTab('graph');
          if (!uiStore.rightPanelVisible) uiStore.toggleRightPanel();
        }
      } catch (e) {
        console.error('[project store] 切换项目失败:', e);
        // 恢复到之前的项目状态（后端 switchProjectCore 已回滚 currentProjectId）
        await this.loadProjects();
        // 若 loadProjects 也失败导致 currentProjectId 未正确恢复，则兜底回退到切换前项目
        if (this.currentProjectId === projectId) {
          this.currentProjectId = previousProjectId;
        }
        // 重新加载当前项目数据（切换前已清空，需恢复显示）
        try {
          await this._loadCurrentProjectData(true);
        } catch (reloadErr) {
          console.error('[project store] 恢复项目数据失败:', reloadErr);
          useToastStore().error('恢复项目数据失败，请刷新页面重试');
        }
        throw e;
      } finally {
        this.switching = false;
      }
    },

    /**
     * 删除项目（不能删除最后一个）
     * @param {string} id - 项目 ID
     */
    async deleteProject(id) {
      try {
        const data = await client.deleteProject(id);
        if (data.error) {
          throw new Error(data.error);
        }
        this.projects = data.projects || [];
        this.currentProjectId = data.currentProjectId;

        // 如果当前项目被删除并切换到了其他项目，重新加载数据
        if (data.currentProjectId && data.currentProjectId !== id) {
          // 先清空旧项目数据，避免新数据加载前旧数据闪现（与 switchProject 保持一致）
          const docStore = useDocumentStore();
          const graphStore = useGraphStore();
          const ideaStore = useIdeaStore();
          docStore.clear();
          graphStore.clear();
          ideaStore.clear();
          docStore.activePage = 1;
          docStore.jumpKeyword = '';
          docStore.jumpOffset = 0;
          await this._loadCurrentProjectData(false);
        }
      } catch (e) {
        console.error('[project store] 删除项目失败:', e);
        throw e;
      }
    },

    /**
     * 重命名项目
     * @param {string} id - 项目 ID
     * @param {string} name - 新名称
     */
    async renameProject(id, name) {
      const validationError = validateProjectName(name);
      if (validationError) {
        throw new Error(validationError);
      }
      try {
        const data = await client.renameProject(id, name);
        if (data.error) {
          throw new Error(data.error);
        }
        this.projects = data.projects || [];
        // 保持排序：最近使用的项目排在前面
        this.projects.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      } catch (e) {
        console.error('[project store] 重命名项目失败:', e);
        throw e;
      }
    },

    /**
     * 更新项目（名称和/或描述）
     * @param {string} id - 项目 ID
     * @param {{ name?: string, description?: string }} patch - 要更新的字段
     */
    async updateProject(id, patch) {
      if (patch.name !== undefined) {
        const validationError = validateProjectName(patch.name);
        if (validationError) {
          throw new Error(validationError);
        }
      }
      try {
        const data = await client.updateProject(id, patch);
        if (data.error) {
          throw new Error(data.error);
        }
        this.projects = data.projects || [];
        this.projects.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      } catch (e) {
        console.error('[project store] 更新项目失败:', e);
        throw e;
      }
    },

    /**
     * 导出项目数据为 JSON 文件
     * @param {string} projectId - 要导出的项目 ID
     * @returns {Promise<object>} 导出的项目数据
     */
    async exportProject(projectId) {
      try {
        const data = await client.exportProject(projectId);
        if (data.error) {
          throw new Error(data.error);
        }
        return data;
      } catch (e) {
        console.error('[project store] 导出项目失败:', e);
        throw e;
      }
    },

    /**
     * 导入项目数据（从 JSON 文件）
     * @param {object} data - 导出的项目数据对象
     * @param {string} [name] - 可选的新项目名称
     * @returns {Promise<object>} 导入结果，包含新项目信息
     */
    async importProject(data, name) {
      try {
        const result = await client.importProject(data, name);
        if (result.error) {
          throw new Error(result.error);
        }
        // 更新项目列表
        if (result.projects) {
          this.projects = result.projects;
          this.projects.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        }
        return result;
      } catch (e) {
        console.error('[project store] 导入项目失败:', e);
        throw e;
      }
    },

    /**
     * 更新当前项目的文档数量（导入/删除文档后实时更新）
     * @param {number} count - 最新文档数量
     */
    updateCurrentProjectDocCount(count) {
      const project = this.projects.find(p => p.id === this.currentProjectId);
      if (project) {
        project.documentCount = count;
      }
    },

    /**
     * 切换到相邻项目（用于快捷键切换）
     * @param {number} direction - 1 表示下一个，-1 表示上一个
     * @returns {string|null} 目标项目 ID，若无可用目标则返回 null
     */
    getAdjacentProjectId(direction) {
      const projects = this.projects;
      if (projects.length < 2) return null;
      const currentIndex = projects.findIndex(p => p.id === this.currentProjectId);
      if (currentIndex === -1) return null;
      const nextIndex = (currentIndex + direction + projects.length) % projects.length;
      return projects[nextIndex].id;
    }
  }
});
