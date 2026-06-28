/** @module state/stores/ui
 *  职责：UI 布局状态
 */
import { defineStore } from 'pinia';

export const useUiStore = defineStore('ui', {
  state: () => ({
    leftPanelVisible: true,
    rightPanelVisible: true,
    bottomPanelVisible: false,
    // 命名约定：state 属性名与对应 action 方法名保持一致（去掉 set 前缀）。
    // rightTab / setRightTab、leftPanelTab / setLeftTab 均遵循此约定。
    rightTab: 'graph', // 'graph' | 'idea' | 'model' | 'prompts'
    leftPanelTab: 'documents', // 'documents' | 'ideas'
    // 图谱节点列表（树形面板）的展开/收起状态：移入 store 以便跨组件共享，
    // 避免组件重新挂载时重置（L-1）
    treeListVisible: true,
    // 文件列表折叠状态：折叠后编辑器获得更大空间（查看 PDF/Word 等大文档时有用）
    fileListCollapsed: false,
    theme: 'light' // 'light' | 'dark'，由 App.vue 同步到 document.documentElement
  }),
  getters: {
    visiblePanelCount: (state) => {
      let count = 0;
      if (state.leftPanelVisible) count++;
      if (state.rightPanelVisible) count++;
      return count;
    }
  },
  actions: {
    toggleLeftPanel() { this.leftPanelVisible = !this.leftPanelVisible; },
    toggleRightPanel() { this.rightPanelVisible = !this.rightPanelVisible; },
    toggleBottomPanel() { this.bottomPanelVisible = !this.bottomPanelVisible; },
    setRightTab(tab) { this.rightTab = tab; },
    setLeftTab(tab) { this.leftPanelTab = tab; },
    // 切换图谱节点列表的显示/隐藏（L-1）
    toggleTreeListVisible() { this.treeListVisible = !this.treeListVisible; },
    // 切换文件列表折叠/展开（折叠后编辑器获得全部高度）
    toggleFileListCollapsed() { this.fileListCollapsed = !this.fileListCollapsed; },
    setFileListCollapsed(val) { this.fileListCollapsed = val; },
    // ============ 主题切换 ============
    // 设置主题并持久化到 localStorage，App.vue 通过 watch 同步到 document.documentElement
    setTheme(theme) {
      this.theme = theme === 'dark' ? 'dark' : 'light';
      try { localStorage.setItem('knowledge-ide-theme', this.theme); } catch {}
    },
    // 在亮色/暗色之间切换
    toggleTheme() { this.setTheme(this.theme === 'light' ? 'dark' : 'light'); }
  }
});
