// ============================================================
//  知源 Desktop — Preload 脚本（安全桥接）
//  使用 contextBridge 暴露有限的 API 给渲染进程
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

// sandbox 模式下 process.env 不包含主进程运行时设置的变量，
// 通过 additionalArguments (process.argv) 获取 token 和 port
const ksTokenArg = process.argv.find(a => typeof a === 'string' && a.startsWith('--ks-token='));
const ksPortArg = process.argv.find(a => typeof a === 'string' && a.startsWith('--ks-port='));
const ksToken = ksTokenArg ? ksTokenArg.split('=')[1] : '';
const ksPort = ksPortArg ? ksPortArg.split('=')[1] : (process.env.PORT || '8000');

contextBridge.exposeInMainWorld('KSElectron', {
  // ============ 文件操作 ============
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),

  // ============ 环境信息 ============
  getEnvInfo: () => ipcRenderer.invoke('env:info'),
  getToken: () => ipcRenderer.invoke('env:token'),
  env: {
    backendPort: ksPort,
    apiToken: ksToken
  },

  // ============ 系统安全存储（模型配置 / API Key） ============
  secureStore: {
    get: (key) => ipcRenderer.invoke('secure-store:get', key),
    set: (key, value) => ipcRenderer.invoke('secure-store:set', key, value)
  },

  // ============ 事件监听（主进程 → 渲染进程） ============
  // 每个 onXxx 返回取消订阅函数，调用方可在组件卸载时调用以避免内存泄漏
  onOpenFile: (callback) => {
    const listener = (event, filePath) => callback(filePath);
    ipcRenderer.on('open-file', listener);
    return () => ipcRenderer.removeListener('open-file', listener);
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

  // ============ 进度事件监听 ============
  onOllamaPullProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ollama:pull:progress', listener);
    return () => ipcRenderer.removeListener('ollama:pull:progress', listener);
  },
  onOllamaInstallProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ollama:install:progress', listener);
    return () => ipcRenderer.removeListener('ollama:install:progress', listener);
  },
  onParsePdfProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('parse-pdf:progress', listener);
    return () => ipcRenderer.removeListener('parse-pdf:progress', listener);
  },
});
