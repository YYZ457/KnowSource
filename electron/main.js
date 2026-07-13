// ============================================================
// 知源 Desktop — Electron 主进程
//  功能：窗口管理、文件访问、IPC桥接
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

// 全局异常处理，避免未捕获的 Promise 拒绝和异常导致进程静默崩溃
process.on('unhandledRejection', (reason, promise) => {
  console.error('[main] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught Exception:', err);
  try {
    dialog.showErrorBox('主进程异常', err.message);
  } catch {}
  app.exit(1);
});

// 必须在任何导入后端服务（storage.js）之前设置数据目录，
// 否则 storage.js 会回退到 app.asar 内部路径，导致 ENOTDIR 错误。
process.env.KNOWLEDGE_IDE_DATA_DIR = app.getPath('userData');

// 本地后端 API 认证令牌：防止其他本地进程/网页任意访问后端接口
const LOCAL_API_TOKEN = crypto.randomUUID();
process.env.KNOWLEDGE_IDE_API_TOKEN = LOCAL_API_TOKEN;

// CSP connect-src 运行时白名单：除本地服务外，只允许用户配置的 LLM baseUrl
const allowedConnectOrigins = new Set();

// 监听后端 settings handler 发出的 LLM 配置变更事件，实时更新 CSP 白名单
process.on('llm-config-changed', ({ baseUrl }) => {
  if (!baseUrl) return;
  try {
    allowedConnectOrigins.add(new URL(baseUrl).origin);
    console.log('[Electron] CSP connect-src 白名单已更新:', baseUrl);
  } catch {
    console.warn('[Electron] 无法解析 LLM baseUrl:', baseUrl);
  }
});

let mainWindow = null;
let backendServer = null;
const recentOpenedFiles = new Set();
const hasExplicitBackendPort = typeof process.env.PORT === 'string' && process.env.PORT.trim() !== '';
let backendPort = Number.parseInt(process.env.PORT || '8000', 10);
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
  backendPort = 8000;
}

// 单实例锁：防止用户多次打开应用导致端口/数据目录竞态
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[Electron] 已有实例在运行，退出当前实例');
  app.quit();
  process.exit(0);
}
app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ============ 启动本地后端服务 ============
async function startBackendService() {
  // 数据目录已在主进程顶层设置，这里直接复用。
  // 使用 Electron 的 userData 根目录（已经由 Electron 创建并确保可写）。

  // 先检查端口是否已被本应用后端占用（通过 HTTP 健康检查，避免误判其他服务）
  const isOurs = await isOurBackendRunning(backendPort);
  if (isOurs) {
    console.log('[Electron] 检测到本应用后端服务已在运行');
    process.env.PORT = String(backendPort);
    return;
  }

  // 在主进程内直接启动后端 HTTP 服务
  const http = require('http');
  const { handleHttpRequest } = await import('../services/api/router.js');

  // 启动时加载用户提示词覆盖与任务禁用列表（与 services/server.js 保持一致）
  // 若不调用，Electron 生产模式下用户自定义的提示词会在重启后"丢失"（数据仍在磁盘但未加载到注册表）
  try {
    const { initPromptStore } = await import('../services/api/handlers/prompts.js');
    initPromptStore();
  } catch (e) {
    console.warn('[Electron] 加载提示词覆盖失败:', e.message);
  }

  const createBackendServer = () => {
    const server = http.createServer((req, res) => {
      // 对 /parse 路径单独设置更长超时（30 分钟），因为 PDF 解析+OCR 可能很耗时
      if (req.url && req.url.startsWith('/parse')) {
        req.setTimeout(30 * 60 * 1000); // 30 分钟
      }
      handleHttpRequest(req, res);
    });
    // HTTP 服务器超时设置，与 services/server.js 保持一致，避免慢速请求耗尽连接
    server.timeout = 300000;
    server.keepAliveTimeout = 5000;
    server.requestTimeout = 300000;
    return server;
  };

  // 显式 PORT 必须严格遵守；默认 8000 被占用时自动寻找可用本地端口。
  const candidatePorts = hasExplicitBackendPort
    ? [backendPort]
    : Array.from({ length: 21 }, (_, index) => 8000 + index);
  let lastError = null;
  for (const port of candidatePorts) {
    const server = createBackendServer();
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      backendServer = server;
      backendPort = port;
      // BrowserWindow 创建前更新环境变量，preload 才能拿到实际端口。
      process.env.PORT = String(port);
      backendStopped = false;
      console.log(`[Electron] 后端服务已启动: http://127.0.0.1:${port}`);
      return;
    } catch (error) {
      lastError = error;
      try { server.close(); } catch {}
      if (!hasExplicitBackendPort && error.code === 'EADDRINUSE') {
        console.warn(`[Electron] 端口 ${port} 已被占用，尝试下一个端口`);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('8000-8020 端口均不可用');
}

/**
 * 通过 HTTP 请求检测端口上的服务是否为本应用后端。
 * 发送 GET /documents 请求，检查响应是否为 JSON 且包含 documents 字段。
 */
function isOurBackendRunning(port = backendPort) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/documents`, {
      timeout: 1000,
      headers: LOCAL_API_TOKEN ? { 'X-Knowledge-IDE-Token': LOCAL_API_TOKEN } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // 本应用后端 /documents 返回数组或 { documents: [...] }
          if (Array.isArray(parsed) || (parsed && Array.isArray(parsed.documents))) {
            resolve(true);
            return;
          }
        } catch (e) { /* 非 JSON，不是本应用 */ }
        resolve(false);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 退出流程标记，防止 stopBackendService 重复调用
let backendStopped = false

async function stopBackendService() {
  if (backendStopped) return
  backendStopped = true
  // 先把内存中的脏数据严格落盘，再关闭 OCR worker 与 HTTP 服务。
  try {
    const storageModule = await import('../services/storage.js')
    await storageModule.flushAll?.()
  } catch (error) {
    console.error('[Electron] 退出前保存数据失败:', error.message)
  }
  try {
    const { terminateOcrWorker } = await import('../core/parser/index.js')
    await terminateOcrWorker()
  } catch {}
  if (backendServer) {
    const server = backendServer
    backendServer = null
    await new Promise((resolve) => {
      try { server.close(resolve) } catch { resolve() }
    })
  }
}

// ============ 创建主窗口 ============
function buildCsp() {
  // 收紧 connect-src / frame-src：仅允许本应用后端端口，而非 localhost:* / 127.0.0.1:* 通配。
  // 通配符会让渲染层一旦发生 XSS 即可向本机任意端口的本地服务外联数据。
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const localhostOrigin = `http://localhost:${backendPort}`;
  const connect = ["'self'", backendOrigin, localhostOrigin, ...allowedConnectOrigins];
  const frame = ["'self'", 'blob:', backendOrigin, localhostOrigin];
  // 修复：开发模式下放宽 CSP 以兼容 Vite HMR
  if (!app.isPackaged) {
    connect.push('ws://localhost:*', 'http://localhost:*');
    return "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src " + connect.join(' ') + "; font-src 'self' data:; frame-src " + frame.join(' ') + "; object-src 'none';";
  }
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src " + connect.join(' ') + "; font-src 'self' data:; frame-src " + frame.join(' ') + "; object-src 'none';";
}

function isAllowedAppNavigation(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (!app.isPackaged) {
      return parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === '5173';
    }
    if (parsed.protocol !== 'file:') return false;
    const distRoot = path.resolve(__dirname, '../dist');
    const targetPath = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(distRoot, targetPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function openExternalHttpUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    shell.openExternal(parsed.toString()).catch((error) => {
      console.warn('[Electron] 打开外部链接失败:', error.message);
    });
  } catch {
    // 非法 URL 直接忽略，不交给操作系统处理。
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1400,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    title: '知源 — 知识图谱构建器',
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    }
  });

  // 等首帧完整绘制后再显示，避免启动阶段的黑闪和半绘制界面。
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  // CSP：通过响应头直接设置，比 dom-ready 注入 meta 更可靠，确保覆盖 file:// 协议加载的页面。
  // 注意：对 PDF 响应不设置 CSP，避免干扰 Chromium 内置 PDF 查看器（PDFium 需加载内部资源）。
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    delete headers['Content-Security-Policy'];
    delete headers['content-security-policy'];
    // PDF 响应不添加 CSP，避免 object-src 'none' 等限制阻止 PDFium 渲染
    const contentTypeRaw = headers['Content-Type'] || headers['content-type'] || '';
    const contentType = Array.isArray(contentTypeRaw) ? contentTypeRaw.join(';') : String(contentTypeRaw);
    const isPdfResponse = contentType.includes('application/pdf') || (details.url && details.url.includes('/pdf'));
    if (!isPdfResponse) {
      headers['Content-Security-Policy'] = [buildCsp()];
    }
    callback({ responseHeaders: headers });
  });

  // 默认阻止 webview 嵌入，仅允许用于 PDF 预览的独立 partition，并强制关闭危险能力
  // 注意：partition 属性位于 params 对象中，而非 webPreferences（Electron API 规范）。
  //       之前误用 webPreferences.partition（始终为 undefined）会导致所有 webview 被阻止，
  //       PDF 预览功能完全失效。
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.partition !== 'persist:pdfviewer') {
      event.preventDefault();
      return;
    }
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.enableRemoteModule = false;
    delete webPreferences.preload;
    delete webPreferences.additionalArguments;
  });

  // 限制窗口导航、弹窗与权限请求，防止渲染层被控后跳转或请求敏感权限
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url)) {
      event.preventDefault();
      openExternalHttpUrl(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  // 加载主页面：生产环境加载 Vite 构建产物，开发环境指向 Vite dev server
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  // 仅在非打包的开发环境打开 DevTools
  if (!app.isPackaged && process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ 菜单栏 ============
const appMenu = Menu.buildFromTemplate([
  {
    label: '知源',
    submenu: [
      { label: '关于知源', role: 'about' },
      { type: 'separator' },
      { label: '偏好设置', accelerator: 'CmdOrCtrl+,', click: () => {
        mainWindow?.webContents.send('open-settings');
      }},
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
    ]
  },
  {
    label: '文件',
    submenu: [
      { label: '打开文件...', accelerator: 'CmdOrCtrl+O', click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'],
          filters: [
            { name: '支持的文档', extensions: ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'md', 'markdown', 'txt', 'jpg', 'jpeg', 'png'] }
          ]
        });
        if (!result.canceled && result.filePaths[0]) {
          const selectedPath = path.resolve(result.filePaths[0]);
          recentOpenedFiles.add(selectedPath);
          mainWindow?.webContents.send('open-file', selectedPath);
        }
      }},
      { type: 'separator' },
      { label: '导出图谱...', accelerator: 'CmdOrCtrl+E', click: () => {
        mainWindow?.webContents.send('export-graph');
      }},
      { type: 'separator' },
      { label: '全部清除', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => {
        mainWindow?.webContents.send('clear-all');
      }}
    ]
  },
  {
    label: '视图',
    submenu: [
      { label: '左侧面板', accelerator: 'CmdOrCtrl+Shift+L', click: () => {
        mainWindow?.webContents.send('toggle-left-panel');
      }},
      { type: 'separator' },
      { label: '文献', accelerator: 'CmdOrCtrl+1', click: () => {
        mainWindow?.webContents.send('switch-view', 'documents');
      }},
      { label: '知识图谱', accelerator: 'CmdOrCtrl+2', click: () => {
        mainWindow?.webContents.send('switch-view', 'graph');
      }},
      { label: '灵感', accelerator: 'CmdOrCtrl+3', click: () => {
        mainWindow?.webContents.send('switch-view', 'idea');
      }},
      { type: 'separator' },
      { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => {
        mainWindow?.webContents.send('zoom-graph', 1.2);
      }},
      { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => {
        mainWindow?.webContents.send('zoom-graph', 0.8);
      }},
      { label: '适配视图', accelerator: 'CmdOrCtrl+0', click: () => {
        mainWindow?.webContents.send('fit-graph');
      }},
      { type: 'separator' },
      // 修复：生产环境隐藏开发者工具和重新加载，避免信息泄漏
      ...(app.isPackaged ? [] : [
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' }
      ])
    ]
  },
  {
    label: 'AI',
    submenu: [
      { label: '模型设置...', accelerator: 'CmdOrCtrl+Shift+A', click: () => {
        mainWindow?.webContents.send('open-ai-settings');
      }}
    ]
  },
  {
    label: '帮助',
    submenu: [
      { label: '使用说明', accelerator: 'F1', click: () => {
        mainWindow?.webContents.send('show-help');
      }},
      { label: '关于', click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '关于 知源',
          message: `知源 — 知识图谱构建器 v${app.getVersion()}`,
          detail: '基于 Electron + 无监督 NLP + 可选 AI 增强\n纯本地运行，无需联网'
        });
      }}
    ]
  }
]);

// ============ IPC 处理 ============
async function setupIPC() {
  // 注册后端 API 的 IPC 桥接（供 preload 中 window.KSElectron.api 使用）
  const { registerIpcHandlers } = await import('../services/api/router.js');
  registerIpcHandlers(ipcMain);

  // 文件对话框
  ipcMain.handle('dialog:openFile', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options || {});
    // 记录用户通过对话框选择的文件路径，供 file:read 白名单校验
    if (!result.canceled && result.filePaths) {
      for (const fp of result.filePaths) {
        recentOpenedFiles.add(path.resolve(fp));
      }
    }
    return result;
  });

  // 保存文件
  ipcMain.handle('dialog:saveFile', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options || {});
    return result;
  });

  // 读取文件内容
  ipcMain.handle('file:read', async (event, filePath) => {
    // 仅允许读取应用数据目录和用户通过对话框选择的文件
    const userDataPath = app.getPath('userData');
    const allowedDirs = [userDataPath];
    const resolved = path.resolve(filePath);
    // 使用 path.relative 安全校验：相对路径不以 .. 开头且非绝对路径才允许
    const isAllowed = allowedDirs.some(dir => {
      const rel = path.relative(path.resolve(dir), resolved);
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    if (!isAllowed) {
      // 检查是否是最近通过对话框选择的文件
      if (!recentOpenedFiles.has(resolved)) {
        throw new Error('Access denied: file outside allowed directories');
      }
    }
    // 文件大小检查：超过 50MB 拒绝读取，避免内存溢出
    const stats = await fs.promises.stat(filePath);
    if (stats.size > 50 * 1024 * 1024) {
      throw new Error(`文件过大（${(stats.size / 1024 / 1024).toFixed(1)}MB），超过50MB限制`);
    }
    return await fs.promises.readFile(filePath);
  });

  // 文件是否存在
  ipcMain.handle('file:exists', async (event, filePath) => {
    // 与 file:read 一致的目录白名单校验（使用 path.relative 安全校验）
    const userDataPath = app.getPath('userData');
    const allowedDirs = [userDataPath];
    const resolved = path.resolve(filePath);
    const isAllowed = allowedDirs.some(dir => {
      const rel = path.relative(path.resolve(dir), resolved);
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    if (!isAllowed) {
      if (!recentOpenedFiles.has(resolved)) {
        throw new Error('Access denied: file outside allowed directories');
      }
    }
    return fs.existsSync(filePath);
  });

  // 环境信息（异步执行，避免阻塞主进程）
  ipcMain.handle('env:info', async () => {
    const { execFile } = require('child_process');
    const nodeVer = process.version;
    let pythonVer = 'unknown';
    try {
      pythonVer = await new Promise((resolve) => {
        // 优先尝试 python3（Mac/Linux 常见），回退到 python（Windows 常见）
        execFile('python3', ['--version'], { timeout: 5000 }, (err, stdout) => {
          if (err) {
            execFile('python', ['--version'], { timeout: 5000 }, (err2, stdout2) => {
              if (err2) { resolve('not found'); return; }
              resolve(stdout2.toString().trim());
            });
            return;
          }
          resolve(stdout.toString().trim());
        });
      });
    } catch (e) {
      pythonVer = 'not found';
    }
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: nodeVer,
      pythonVersion: pythonVer,
      appPath: __dirname
    };
  });

  // ============ 安全存储（API Key 等敏感信息） ============
  const secureStoreFile = path.join(app.getPath('userData'), 'secure-store.enc');

  // 安全 key 校验：拒绝 __proto__ / constructor / prototype 等危险键，
  // 避免 store[key] = value 触发原型污染（即便影响范围有限，也作为纵深防御）。
  function isSafeStoreKey(key) {
    return typeof key === 'string' && key.length > 0 &&
      key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
  }

  ipcMain.handle('secure-store:set', async (event, key, value) => {
    try {
      if (!isSafeStoreKey(key)) {
        return { success: false, error: 'Invalid store key' };
      }
      if (!safeStorage.isEncryptionAvailable()) {
        return { success: false, error: '系统安全存储不可用，模型配置未保存' };
      }
      let store = {};
      if (fs.existsSync(secureStoreFile)) {
        const encrypted = await fs.promises.readFile(secureStoreFile);
        try {
          const decrypted = safeStorage.decryptString(encrypted);
          store = JSON.parse(decrypted);
        } catch {
          // 旧版明文或损坏内容不得继续读取；下一次保存直接覆盖为加密数据。
          console.warn('[Electron] 安全存储内容无法解密，将以新的加密配置覆盖');
          store = {};
        }
      }
      store[key] = value;
      const json = JSON.stringify(store);
      const encrypted = safeStorage.encryptString(json);
      await fs.promises.writeFile(secureStoreFile, encrypted, { mode: 0o600 });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('secure-store:get', async (event, key) => {
    try {
      if (!isSafeStoreKey(key)) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(secureStoreFile)) return null;
      const encrypted = await fs.promises.readFile(secureStoreFile);
      const decrypted = safeStorage.decryptString(encrypted);
      const store = JSON.parse(decrypted);
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    } catch (e) {
      return null;
    }
  });

  // LLM / KG 模型配置同步到主进程后端服务
  async function applyProviderConfig(config, setterName) {
    // 深拷贝避免修改调用方数据
    config = { ...config };
    // 兼容旧配置
    if (config.provider === 'openai') {
      config.provider = 'openai-compatible';
      config.vendor = config.vendor || 'openai';
    }
    // 将用户配置的 LLM baseUrl 加入 CSP connect-src 白名单
    if (config.baseUrl) {
      try {
        allowedConnectOrigins.add(new URL(config.baseUrl).origin);
      } catch {
        console.warn('[Electron] 无法解析 LLM baseUrl:', config.baseUrl);
      }
    }
    const { setLLMProvider, setKGProvider, createLLMProvider } = await import('../services/llm-provider.js');
    const { setEmbeddingProvider, createProvider: createEmbeddingProvider } = await import('../services/embedding-provider.js');
    const setter = setterName === 'setLLMProvider' ? setLLMProvider : setKGProvider;
    setter(createLLMProvider(config.provider, {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      vendor: config.vendor
    }));
    // 同步设置 embedding provider，按供应商默认模型选择，不覆盖 LLM 模型名
    setEmbeddingProvider(createEmbeddingProvider(config.provider, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      vendor: config.vendor
    }));
  }

  ipcMain.handle('api:set-llm-provider', async (event, config) => {
    await applyProviderConfig(config, 'setLLMProvider');
    return { success: true };
  });

  ipcMain.handle('api:set-kg-provider', async (event, config) => {
    await applyProviderConfig(config, 'setKGProvider');
    return { success: true };
  });

  // ============ Ollama 自动安装与模型管理 ============
  // Ollama 检测（异步执行，避免阻塞主进程）
  ipcMain.handle('ollama:detect', async () => {
    const { execFile } = require('child_process');
    try {
      const output = await new Promise((resolve, reject) => {
        execFile('ollama', ['--version'], { encoding: 'utf-8', timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      return { installed: true, version: output.trim() };
    } catch (e) {
      return { installed: false, version: null };
    }
  });

  // Ollama 列出已安装模型（异步执行，避免阻塞主进程）
  ipcMain.handle('ollama:list', async () => {
    const { execFile } = require('child_process');
    try {
      const output = await new Promise((resolve, reject) => {
        execFile('ollama', ['list'], { encoding: 'utf-8', timeout: 10000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      // 解析输出为模型列表（跳过表头）
      // ollama list 输出格式: NAME ID SIZE MODIFIED
      const lines = output.trim().split('\n').slice(1);
      return lines.map(line => {
        const match = line.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+\s+\w+)\s+(.+)$/);
        if (match) {
          return { name: match[1], id: match[2], size: match[3], modified: match[4] };
        }
        // fallback: 简单分割
        const parts = line.trim().split(/\s+/);
        return { name: parts[0], id: parts[1] || '', size: parts.slice(2, -2).join(' ') || '', modified: parts.slice(-2).join(' ') || '' };
      }).filter(m => m.name);
    } catch (e) {
      return [];
    }
  });

  // Ollama 拉取模型（流式进度）
  ipcMain.handle('ollama:pull', async (event, modelName) => {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
      const proc = spawn('ollama', ['pull', modelName], { encoding: 'utf-8' });
      let lastProgress = '';
      let destroyed = false;

      // 窗口关闭时终止 ollama pull 进程
      const onSenderDestroyed = () => {
        destroyed = true;
        try { proc.kill('SIGTERM'); } catch (_) {}
      };
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.once('destroyed', onSenderDestroyed);
      }

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        // ollama pull 输出格式: "pulling manifest... pulling xxx... 45% 120MB/s"
        const match = text.match(/(\d+)%/);
        if (match) {
          lastProgress = match[1] + '%';
        }
        if (destroyed || event.sender.isDestroyed()) {
          try { proc.kill('SIGTERM'); } catch (_) {}
          return;
        }
        event.sender.send('ollama:pull:progress', { model: modelName, progress: lastProgress, raw: text.trim() });
      });

      proc.stderr.on('data', (data) => {
        if (destroyed || event.sender.isDestroyed()) return;
        event.sender.send('ollama:pull:progress', { model: modelName, progress: lastProgress, raw: data.toString().trim() });
      });

      proc.on('exit', (code) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.removeListener('destroyed', onSenderDestroyed);
        }
        if (destroyed) return; // 窗口已关闭，不处理结果
        if (code === 0) {
          resolve({ success: true, model: modelName });
        } else {
          reject(new Error(`ollama pull failed with code ${code}`));
        }
      });

      proc.on('error', (e) => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.removeListener('destroyed', onSenderDestroyed);
        }
        reject(new Error(`Failed to start ollama: ${e.message}`));
      });
    });
  });

  // Ollama 安装（按平台下载对应安装包，但不再自动执行未验证二进制）
  ipcMain.handle('ollama:install', async (event) => {
    const https = require('https');

    // 按平台选择下载 URL
    let downloadUrl, downloadPath;
    if (process.platform === 'win32') {
      downloadUrl = 'https://ollama.com/download/OllamaSetup.exe';
      downloadPath = path.join(app.getPath('temp'), 'OllamaSetup.exe');
    } else if (process.platform === 'darwin') {
      downloadUrl = 'https://ollama.com/download/Ollama-darwin.zip';
      downloadPath = path.join(app.getPath('temp'), 'Ollama-darwin.zip');
    } else {
      // Linux: 指引用户到官方安装页面
      return { success: false, error: 'Linux 请访问 https://ollama.com/download 安装 Ollama', manualUrl: 'https://ollama.com/download' };
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(downloadPath);
      const download = (url) => {
        https.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            const loc = response.headers.location;
            if (!loc) { reject(new Error('Redirect without location')); return; }
            download(loc);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`Unexpected status ${response.statusCode}`));
            return;
          }
          const totalSize = parseInt(response.headers['content-length'] || 0);
          if (totalSize && totalSize < 1_000_000) {
            reject(new Error('File size suspicious'));
            return;
          }
          let downloaded = 0;
          response.on('data', (chunk) => {
            downloaded += chunk.length;
            const percent = totalSize ? Math.round(downloaded / totalSize * 100) : 0;
            if (event.sender && !event.sender.isDestroyed()) {
              event.sender.send('ollama:install:progress', { percent, downloaded, totalSize });
            }
          });
          response.pipe(file);
          file.on('finish', () => {
            file.close(async () => {
              // 安全策略：不自动执行下载的安装包，改为打开所在文件夹让用户手动安装
              try {
                await shell.showItemInFolder(downloadPath);
                resolve({ success: true, downloadPath, manual: true });
              } catch (e) {
                resolve({ success: false, error: e.message, downloadPath });
              }
            });
          });
        }).on('error', (e) => {
          reject(new Error(`Download failed: ${e.message}`));
        });
      };
      download(downloadUrl);
    });
  });

  // PDF 解析（在主进程执行，避免把 pdfjs / canvas / tesseract 等 Node 原生模块打包进前端）
  ipcMain.handle('api:parse-pdf', async (event, { name, base64 }) => {
    const { parsePDF } = await import('../core/parser/index.js');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || buffer.length === 0) {
      throw new Error('PDF base64 内容为空');
    }
    // 构造类 File 对象，复用 parsePDF 接口
    const bytes = Uint8Array.from(buffer);
    const file = {
      name,
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    };
    return await parsePDF(file, (p) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('parse-pdf:progress', { name, ...p });
      }
    });
  });
}

// ============ 应用生命周期 ============
app.whenReady().then(async () => {
  Menu.setApplicationMenu(appMenu);
  await setupIPC();
  let backendOk = true;
  try {
    await startBackendService();
  } catch (e) {
    backendOk = false;
    console.error('[Electron] 启动后端服务失败:', e.message);
    // 端口被其他应用占用时，给用户明确提示
    const { dialog } = require('electron');
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: '后端服务启动失败',
      message: `知源后端服务启动失败：${e.message}`,
      detail: `可能原因：\n• 端口 ${backendPort} 被其他程序占用\n• 系统权限不足\n\n是否仍要打开应用？（部分功能将不可用）`,
      buttons: ['仍要打开', '退出'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice === 1) {
      app.quit();
      return;
    }
  }
  createWindow();
  // 后端启动失败时，通知渲染进程显示错误提示
  if (!backendOk && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('backend-error', { port: backendPort });
    });
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // macOS 关闭所有窗口后重新激活：若后端已停止，先重启后端再创建窗口
      if (!backendServer) {
        try {
          await startBackendService();
        } catch (e) {
          console.error('[Electron] 重新激活时启动后端服务失败:', e.message);
        }
      }
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// will-quit: 在应用退出前异步清理后端和 OCR worker，确保子进程被正确终止
app.on('will-quit', async (event) => {
  if (backendStopped) return // 已清理过
  event.preventDefault()
  let cleanupTimer
  const cleanupTimeout = new Promise((resolve) => {
    cleanupTimer = setTimeout(() => {
      console.warn('[Electron] 退出清理超过 5 秒，强制结束')
      resolve()
    }, 5000)
  })
  Promise.race([stopBackendService(), cleanupTimeout]).finally(() => {
    clearTimeout(cleanupTimer)
    app.exit(0)
  })
});
