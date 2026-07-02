// ============================================================
//  知源 Desktop — Preload 脚本（安全桥接）
//  使用 contextBridge 暴露有限的 API 给渲染进程
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

// Python 日志监听器映射：用户回调 -> 包装后的 IPC 监听器
// 用于 onPythonLog/offPythonLog 配对注册与注销
const _pythonLogListeners = new Map();

contextBridge.exposeInMainWorld('KSElectron', {
  // ============ 文件操作 ============
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),

  // ============ 环境信息 ============
  getEnvInfo: () => ipcRenderer.invoke('env:info'),
  env: {
    backendPort: process.env.PORT || 8000,
    apiToken: process.env.KNOWLEDGE_IDE_API_TOKEN || ''
  },

  // ============ 安全存储（API Key 等敏感信息） ============
  secureStore: {
    set: (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
    get: (key) => ipcRenderer.invoke('secure-store:get', key)
  },

  // ============ 服务层 API ============
  api: {
    parse: async (file) => ipcRenderer.invoke('api:parse', file),
    parsePDF: async (file, onProgress) => {
      let progressListener;
      if (typeof onProgress === 'function') {
        progressListener = (e, data) => onProgress(data);
        ipcRenderer.on('parse-pdf:progress', progressListener);
      }
      try {
        return await ipcRenderer.invoke('api:parse-pdf', file);
      } finally {
        if (progressListener) {
          ipcRenderer.removeListener('parse-pdf:progress', progressListener);
        }
      }
    },
    extract: async (docId) => ipcRenderer.invoke('api:extract', docId),
    graphBuild: async (options) => ipcRenderer.invoke('api:graph:build', options),
    graphQuery: async (params) => ipcRenderer.invoke('api:graph:query', params),
    match: async (params) => ipcRenderer.invoke('api:match', params),
    listDocuments: async () => ipcRenderer.invoke('api:documents'),
    deleteDocument: async (id) => ipcRenderer.invoke('api:documents:delete', { id }),
    search: async (params) => ipcRenderer.invoke('api:search', params),
    listIdeas: async () => ipcRenderer.invoke('api:ideas:list'),
    createIdea: async (idea) => ipcRenderer.invoke('api:ideas:create', idea),
    updateIdea: async (params) => ipcRenderer.invoke('api:ideas:update', params),
    deleteIdea: async (id) => ipcRenderer.invoke('api:ideas:delete', { id }),
    recommendIdeaNodes: async (params) => ipcRenderer.invoke('api:ideas:recommend', params),
    linkIdea: async (params) => ipcRenderer.invoke('api:ideas:link', params),
    unlinkIdea: async (params) => ipcRenderer.invoke('api:ideas:unlink', params),
    setLLMProvider: async (config) => ipcRenderer.invoke('api:set-llm-provider', config),
    setKGProvider: async (config) => ipcRenderer.invoke('api:set-kg-provider', config)
  },

  // ============ Ollama 自动安装与模型管理 ============
  ollama: {
    detect: () => ipcRenderer.invoke('ollama:detect'),
    list: () => ipcRenderer.invoke('ollama:list'),
    pull: (model) => ipcRenderer.invoke('ollama:pull', model),
    install: () => ipcRenderer.invoke('ollama:install'),
    onPullProgress: (callback) => {
      const listener = (e, data) => callback(data);
      ipcRenderer.on('ollama:pull:progress', listener);
      return () => ipcRenderer.removeListener('ollama:pull:progress', listener);
    },
    onInstallProgress: (callback) => {
      const listener = (e, data) => callback(data);
      ipcRenderer.on('ollama:install:progress', listener);
      return () => ipcRenderer.removeListener('ollama:install:progress', listener);
    }
  },

  // ============ 事件监听（主进程 → 渲染进程） ============
  // 每个 onXxx 返回取消订阅函数，调用方可在组件卸载时调用以避免内存泄漏
  onOpenFile: (callback) => {
    const listener = (event, filePath) => callback(filePath);
    ipcRenderer.on('open-file', listener);
    return () => ipcRenderer.removeListener('open-file', listener);
  },
  onOpenExamFile: (callback) => {
    const listener = (event, filePath) => callback(filePath);
    ipcRenderer.on('open-exam-file', listener);
    return () => ipcRenderer.removeListener('open-exam-file', listener);
  },
  onExportGraph: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('export-graph', listener);
    return () => ipcRenderer.removeListener('export-graph', listener);
  },
  onClearAll: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('clear-all', listener);
    return () => ipcRenderer.removeListener('clear-all', listener);
  },
  onSwitchView: (callback) => {
    const listener = (event, view) => callback(view);
    ipcRenderer.on('switch-view', listener);
    return () => ipcRenderer.removeListener('switch-view', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  onOpenAISettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-ai-settings', listener);
    return () => ipcRenderer.removeListener('open-ai-settings', listener);
  },
  onToggleLocalLLM: (callback) => {
    const listener = (event, enabled) => callback(enabled);
    ipcRenderer.on('toggle-local-llm', listener);
    return () => ipcRenderer.removeListener('toggle-local-llm', listener);
  },
  onToggleGraphRAG: (callback) => {
    const listener = (event, enabled) => callback(enabled);
    ipcRenderer.on('toggle-graphrag', listener);
    return () => ipcRenderer.removeListener('toggle-graphrag', listener);
  },
  onShowHelp: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('show-help', listener);
    return () => ipcRenderer.removeListener('show-help', listener);
  },
  onToggleLeftPanel: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('toggle-left-panel', listener);
    return () => ipcRenderer.removeListener('toggle-left-panel', listener);
  },
  onToggleRightPanel: (callback) => {
    const listener = event => callback();
    ipcRenderer.on('toggle-right-panel', listener);
    return () => ipcRenderer.removeListener('toggle-right-panel', listener);
  },
  onZoomGraph: (callback) => {
    const listener = (event, scale) => callback(scale);
    ipcRenderer.on('zoom-graph', listener);
    return () => ipcRenderer.removeListener('zoom-graph', listener);
  },
  onFitGraph: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('fit-graph', listener);
    return () => ipcRenderer.removeListener('fit-graph', listener);
  },
  onBackendError: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('backend-error', listener);
    return () => ipcRenderer.removeListener('backend-error', listener);
  },

  // ============ Python 日志监听 ============
  // LogPanel 通过 onPythonLog 注册回调、offPythonLog 注销回调
  // channel 名称 'python-log' 与主进程发送日志的 channel 一致
  onPythonLog: (callback) => {
    const listener = (event, msg) => callback(msg);
    _pythonLogListeners.set(callback, listener);
    ipcRenderer.on('python-log', listener);
  },
  offPythonLog: (callback) => {
    const listener = _pythonLogListeners.get(callback);
    if (listener) {
      ipcRenderer.removeListener('python-log', listener);
      _pythonLogListeners.delete(callback);
    }
  }
});
