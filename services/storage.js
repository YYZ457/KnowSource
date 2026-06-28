/** @module services/storage
 *  职责：共享内存存储 + JSON 文件持久化（支持多项目管理）
 *  持久化范围：projects / documents / ideas / graph
 *  每个项目的数据存储在 DATA_DIR/<projectId>/ 子目录下
 *  任务进度仍保留在内存中（重启后自然清空）
 */
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { readFile, writeFile, rm, rename } from 'node:fs/promises';
import { dirname, join, sep, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDataDir() {
  // 1. 优先使用 Electron 主进程设置的环境变量
  if (process.env.KNOWLEDGE_IDE_DATA_DIR) {
    return process.env.KNOWLEDGE_IDE_DATA_DIR;
  }

  // 2. 开发模式：回退到项目根目录下的 data 文件夹
  const devFallback = join(__dirname, '..', 'data');

  // 3. 生产模式兜底：如果代码被打包在 app.asar 内部，__dirname 会指向 asar 文件内部，
  //    直接写入会导致 ENOTDIR。此时回退到用户主目录下的 .knowledge-ide/data。
  if (__dirname.includes(`${sep}app.asar${sep}`) || __dirname.endsWith(`${sep}app.asar`)) {
    return join(homedir(), '.knowledge-ide', 'data');
  }

  return devFallback;
}

const DATA_DIR = resolveDataDir();
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

const NO_PERSIST = process.env.KNOWLEDGE_IDE_NO_PERSIST === '1';

// 文件级 Promise 写锁：保证同一文件不会被并发写入
class WriteLock {
  constructor() {
    this.promise = Promise.resolve();
  }
  acquire() {
    let release;
    const newPromise = new Promise(resolve => { release = () => resolve(); });
    const prev = this.promise;
    this.promise = prev.then(() => newPromise, () => newPromise);
    // 等待前一个写操作完成后，拿到 release 令牌再执行本次写入
    return prev.then(() => release, () => release);
  }
}
const fileLocks = new Map();
function getFileLock(filePath) {
  if (!fileLocks.has(filePath)) {
    fileLocks.set(filePath, new WriteLock());
  }
  return fileLocks.get(filePath);
}

// 记录最近一次磁盘写入错误，供前端查询（避免错误静默丢失）
let lastWriteError = null;

// ============ 项目路径管理 ============

let currentProjectId = null;
let projectsCache = null;
// 记录 projects.json 的最后修改时间（mtimeMs），用于检测外部程序修改后失效缓存
let projectsCacheMtime = null;
// 记忆上次使用的项目 ID，重启后恢复到上次使用的项目而非列表第一个
let lastUsedProjectId = null;
// 并发锁：防止项目切换/创建/删除操作并发执行导致数据串写
let projectSwitching = false;

function getProjectDir(projectId = currentProjectId) {
  if (!projectId) return DATA_DIR;
  return join(DATA_DIR, projectId);
}

function getDocumentsFile(projectId = currentProjectId) {
  return join(getProjectDir(projectId), 'documents.json');
}

function getIdeasFile(projectId = currentProjectId) {
  return join(getProjectDir(projectId), 'ideas.json');
}

function getGraphFile(projectId = currentProjectId) {
  return join(getProjectDir(projectId), 'graph.json');
}

function getUploadsDir(projectId = currentProjectId) {
  return join(getProjectDir(projectId), 'uploads');
}

function getUploadFilePath(docId, projectId = currentProjectId) {
  // 安全校验：docId 来源于服务端生成（doc-XXXXXXXX / idea-XXXXXXXX 等），
  // 但 importProjectData 会把用户导入数据中的 doc.docId/id 直接传入此处。
  // 必须阻断 "../../../etc/passwd" 之类的路径遍历，否则可写入/读取/删除 uploads 目录之外的文件。
  if (typeof docId !== 'string' || docId.length === 0) {
    throw new Error('[storage] 非法 docId：不能为空');
  }
  // 禁止路径分隔符与 ".." 段（阻断 ../ 和 ..\ 遍历）
  if (/[\\/]/.test(docId) || docId.includes('..')) {
    throw new Error(`[storage] 非法 docId（疑似路径遍历）：${docId}`);
  }
  const uploadsDir = getUploadsDir(projectId);
  const filePath = join(uploadsDir, `${docId}.bin`);
  // 容器校验（兜底）：解析后的绝对路径必须仍位于 uploads 目录之内
  const rel = relative(uploadsDir, filePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`[storage] docId 解析后路径越界：${docId}`);
  }
  return filePath;
}

// ============ 文件系统工具 ============

function ensureDataDir() {
  if (existsSync(DATA_DIR)) {
    const st = statSync(DATA_DIR);
    if (!st.isDirectory()) {
      throw new Error(`[storage] 数据路径 ${DATA_DIR} 已存在但不是目录，请删除后重试`);
    }
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  // 确保当前项目目录存在
  if (currentProjectId) {
    const projDir = join(DATA_DIR, currentProjectId);
    if (!existsSync(projDir)) {
      mkdirSync(projDir, { recursive: true });
    }
  }
}

async function loadJSON(filePath) {
  if (NO_PERSIST || !existsSync(filePath)) return null;
  let raw;
  try {
    raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[storage] 加载失败 ${filePath}:`, e.message);
    // 将损坏的原始内容备份到 .bak 文件，避免被后续 saveJSON 覆盖丢失
    if (raw !== undefined) {
      try {
        writeFileSync(filePath + '.bak', raw);
        console.warn(`[storage] 已备份损坏文件至 ${filePath}.bak`);
      } catch (bakErr) {
        console.error(`[storage] 备份失败:`, bakErr.message);
      }
    }
    return null;
  }
}

// 轮转备份数量
const BACKUP_COUNT = 3;

function rotateBackupSync(filePath) {
  try {
    // 先删除最旧的备份
    if (existsSync(`${filePath}.backup.${BACKUP_COUNT}`)) {
      rmSync(`${filePath}.backup.${BACKUP_COUNT}`, { force: true });
    }
    // 将旧备份依次后移
    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const oldPath = `${filePath}.backup.${i}`;
      const newPath = `${filePath}.backup.${i + 1}`;
      if (existsSync(oldPath)) {
        renameSync(oldPath, newPath);
      }
    }
    // 当前文件备份为 .backup.1
    if (existsSync(filePath)) {
      renameSync(filePath, `${filePath}.backup.1`);
    }
  } catch (e) {
    console.warn(`[storage] 备份轮转失败 ${filePath}:`, e.message);
  }
}

async function saveJSON(filePath, data) {
  if (NO_PERSIST) return;
  const release = await getFileLock(filePath).acquire();
  try {
    ensureDataDir();
    // 确保 filePath 的父目录存在。
    // ensureDataDir() 仅创建 DATA_DIR 和 currentProjectId 目录，
    // 但 saveJSON 可能被传入非当前项目的文件路径（例如 flushDocumentsSave
    // 在项目切换时使用切换前捕获的 projectId），此时目标项目目录可能尚未创建。
    const fileDir = dirname(filePath);
    if (fileDir !== DATA_DIR && !existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    const tmpFile = `${filePath}.tmp.${Date.now()}`;
    try {
      // 原子写入：先写临时文件，再重命名覆盖目标文件
      await writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      // 在重命名前执行备份轮转
      rotateBackupSync(filePath);
      await rename(tmpFile, filePath);
    } catch (e) {
      lastWriteError = { filePath, message: e.message, code: e.code, time: Date.now() };
      console.error(`[storage] 写入失败 ${filePath}:`, e.message);
      try { await rm(tmpFile, { force: true }); } catch {}
      throw e;
    }
  } finally {
    release();
  }
}

// ============ 持久化 Map ============

function stripRawBase64(item) {
  if (item && item.rawBase64) {
    const { rawBase64, ...rest } = item;
    return rest;
  }
  return item;
}

// ============ 原始文件二进制管理 ============

function ensureUploadsDir(projectId = currentProjectId) {
  if (!projectId) return;
  const dir = getUploadsDir(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 将文档原始二进制写入 uploads 目录
 * @param {string} docId
 * @param {Buffer} buffer
 * @param {string} [projectId]
 * @returns {{filePath: string, fileSize: number}}
 */
export function writeRawBuffer(docId, buffer, projectId = currentProjectId) {
  if (!projectId) throw new Error('[storage] 写入原始文件失败：未指定项目');
  ensureUploadsDir(projectId);
  const filePath = getUploadFilePath(docId, projectId);
  writeFileSync(filePath, buffer);
  return { filePath, fileSize: buffer.length };
}

/**
 * 从 uploads 目录读取文档原始二进制
 * @param {string} docId
 * @param {string} [projectId]
 * @returns {Buffer|null}
 */
export function readRawBuffer(docId, projectId = currentProjectId) {
  if (!projectId) return null;
  let filePath;
  try {
    filePath = getUploadFilePath(docId, projectId);
  } catch {
    // docId 非法（路径遍历等）：按文件不存在处理，避免抛错导致上层流程中断
    return null;
  }
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

/**
 * 删除文档原始二进制文件
 * @param {string} docId
 * @param {string} [projectId]
 */
export function deleteRawFile(docId, projectId = currentProjectId) {
  if (!projectId) return;
  let filePath;
  try {
    filePath = getUploadFilePath(docId, projectId);
  } catch {
    // docId 非法（路径遍历等）：直接跳过，绝不删除 uploads 目录之外的文件
    return;
  }
  try {
    rmSync(filePath, { force: true });
  } catch (e) {
    console.warn(`[storage] 删除原始文件失败 ${filePath}:`, e.message);
  }
}

/**
 * 迁移单个文档的 rawBase64 到 uploads 目录（一次性/幂等）
 * 将 doc.rawBase64 写入磁盘后替换为 filePath/fileSize，并删除 rawBase64 字段
 * @param {object} doc
 * @param {string} [projectId]
 * @returns {object} 处理后的 doc
 */
export function migrateDocumentRawBase64(doc, projectId = currentProjectId) {
  if (!doc || !projectId) return doc;
  if (doc.rawBase64 && typeof doc.rawBase64 === 'string') {
    try {
      const buffer = Buffer.from(doc.rawBase64, 'base64');
      const { filePath, fileSize } = writeRawBuffer(doc.docId || doc.id, buffer, projectId);
      doc.filePath = filePath;
      doc.fileSize = fileSize;
      delete doc.rawBase64;
    } catch (e) {
      console.error(`[storage] 迁移文档 ${doc.docId || doc.id} rawBase64 失败:`, e.message);
    }
  }
  return doc;
}

// 底层 Map（Proxy 包装前的原始引用，用于直接操作避免触发自动保存）
const documentsMap = new Map();
const ideasMap = new Map();

// 各数据的保存定时器
let documentsSaveTimer = null;
let ideasSaveTimer = null;
let graphSaveTimer = null;

async function runDocumentsSave(projectId) {
  if (NO_PERSIST || !projectId) return;
  const stripped = Array.from(documentsMap.values()).map(stripRawBase64);
  await saveJSON(getDocumentsFile(projectId), stripped);
}

async function runIdeasSave(projectId) {
  if (NO_PERSIST || !projectId) return;
  await saveJSON(getIdeasFile(projectId), Array.from(ideasMap.values()));
}

async function runGraphSave(projectId, value) {
  if (NO_PERSIST || !projectId) return;
  await saveJSON(getGraphFile(projectId), value);
}

function scheduleDocumentsSave() {
  if (NO_PERSIST) return;
  if (documentsSaveTimer) clearTimeout(documentsSaveTimer);
  // 在闭包中捕获当前 projectId，避免定时器回调触发时 currentProjectId 已被切换导致数据写入错误项目
  const projectId = currentProjectId;
  documentsSaveTimer = setTimeout(() => {
    documentsSaveTimer = null;
    runDocumentsSave(projectId).catch(e =>
      console.error(`[storage] 保存失败 documents:`, e.message)
    );
  }, 100);
}

function scheduleIdeasSave() {
  if (NO_PERSIST) return;
  if (ideasSaveTimer) clearTimeout(ideasSaveTimer);
  // 在闭包中捕获当前 projectId，避免定时器回调触发时 currentProjectId 已被切换导致数据写入错误项目
  const projectId = currentProjectId;
  ideasSaveTimer = setTimeout(() => {
    ideasSaveTimer = null;
    runIdeasSave(projectId).catch(e =>
      console.error(`[storage] 保存失败 ideas:`, e.message)
    );
  }, 100);
}

function scheduleGraphSave(value) {
  if (NO_PERSIST) return;
  if (graphSaveTimer) clearTimeout(graphSaveTimer);
  // 在闭包中捕获当前 projectId，避免定时器回调触发时 currentProjectId 已被切换导致数据写入错误项目
  const projectId = currentProjectId;
  graphSaveTimer = setTimeout(() => {
    graphSaveTimer = null;
    runGraphSave(projectId, value).catch(e =>
      console.error(`[storage] 保存失败 graph:`, e.message)
    );
  }, 100);
}

/**
 * 立即刷新待保存的 documents 数据（切换项目前调用，确保数据写入当前项目文件）
 */
async function flushDocumentsSave() {
  if (documentsSaveTimer) {
    clearTimeout(documentsSaveTimer);
    documentsSaveTimer = null;
  }
  if (NO_PERSIST) return;
  const projectId = currentProjectId;
  if (!projectId) return;
  try {
    await runDocumentsSave(projectId);
  } catch (e) {
    console.error(`[storage] flush documents 失败:`, e.message);
  }
}

/**
 * 立即刷新待保存的 ideas 数据
 */
async function flushIdeasSave() {
  if (ideasSaveTimer) {
    clearTimeout(ideasSaveTimer);
    ideasSaveTimer = null;
  }
  if (NO_PERSIST) return;
  const projectId = currentProjectId;
  if (!projectId) return;
  try {
    await runIdeasSave(projectId);
  } catch (e) {
    console.error(`[storage] flush ideas 失败:`, e.message);
  }
}

/**
 * 立即刷新待保存的 graph 数据
 */
async function flushGraphSave() {
  if (graphSaveTimer) {
    clearTimeout(graphSaveTimer);
    graphSaveTimer = null;
  }
  if (NO_PERSIST) return;
  const projectId = currentProjectId;
  if (!projectId || !graphTarget) return;
  try {
    await runGraphSave(projectId, graphTarget);
  } catch (e) {
    console.error(`[storage] flush graph 失败:`, e.message);
  }
}

/**
 * 创建持久化 Map 的 Proxy 包装器
 * 仅对变更方法（set/delete/clear）包装以触发保存；
 * 其他方法直接绑定原始 Map，避免 V8 receiver 检查失败。
 */
function createPersistedMap(map, scheduleSave) {
  return new Proxy(map, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        const isMutator = prop === 'set' || prop === 'delete' || prop === 'clear';
        if (isMutator) {
          return function (...args) {
            const result = value.apply(target, args);
            scheduleSave();
            return result;
          };
        }
        return value.bind(target);
      }
      return value;
    }
  });
}

// ============ Graph 监听 ============

// 监听对象变化并触发回调的通用 Proxy 工厂
function watchObject(obj, onChange) {
  return new Proxy(obj, {
    set(target, prop, value) {
      target[prop] = value;
      onChange(target);
      return true;
    },
    deleteProperty(target, prop) {
      const result = delete target[prop];
      onChange(target);
      return result;
    }
  });
}

// 底层 graph 对象引用（Proxy 包装前的原始引用，用于序列化和刷新保存）
let graphTarget = null;

/**
 * 替换 graph 并重新包装为 Proxy，确保后续修改仍能触发自动保存
 * 每次替换 graph 时递增 graphVersion，供 graph-query.js 判断缓存是否失效
 */
export function setGraph(value) {
  graphTarget = value;
  storage.graph = watchObject(value, (target) => {
    graphTarget = target;
    storage.graphVersion++; // 任何属性变更（nodes/edges/stats）都递增版本号
    if (!NO_PERSIST) {
      scheduleGraphSave(target);
    }
  });
  storage.graphVersion++; // graph 整体替换也递增版本号
}

// ============ 共享存储 ============

const storage = {
  documents: createPersistedMap(documentsMap, scheduleDocumentsSave),
  ideas: createPersistedMap(ideasMap, scheduleIdeasSave),
  graph: { nodes: [], edges: [], stats: {} }, // 初始占位，initialize() 中通过 setGraph 替换

  // 图谱版本号：每次 graph 被替换或其属性（nodes/edges/stats）被修改时递增。
  // 供 graph-query.js 判断缓存是否失效，替代脆弱的数组引用比较。
  graphVersion: 0,

  // 图谱构建标志：构建期间为 true，CRUD handler 据此拒绝操作，避免构建完成后覆盖用户的手动修改
  building: false,

  taskProgress: { taskId: null, status: 'idle', stage: '', percent: 0, log: '' },
  resetTaskProgress(taskId = null) {
    this.taskProgress = { taskId, status: 'running', stage: 'init', percent: 0, log: '', updatedAt: Date.now() };
  },
  setTaskProgress(update) {
    this.taskProgress = { ...this.taskProgress, ...update, updatedAt: Date.now() };
  },
  pauseTask() {
    if (this.taskProgress.taskId) {
      this.taskProgress = { ...this.taskProgress, status: 'paused' };
    }
  },
  resumeTask() {
    if (this.taskProgress.taskId) {
      this.taskProgress = { ...this.taskProgress, status: 'running' };
    }
  },
  cancelTask() {
    if (this.taskProgress.taskId) {
      this.taskProgress = { ...this.taskProgress, status: 'cancelled' };
    }
  }
};

// ============ 项目管理函数 ============

/**
 * 失效项目列表缓存，强制下次 loadProjects 从磁盘重新加载
 * 在外部修改了 projects.json 或需要确保缓存与磁盘一致时调用
 */
function invalidateProjectsCache() {
  projectsCache = null;
  projectsCacheMtime = null;
}

/**
 * 加载项目列表
 * 使用内存缓存确保 NO_PERSIST 模式下也能正常工作
 * 兼容旧版数组格式和新版对象格式 { lastUsedProjectId, projects }
 * 通过文件修改时间检测外部修改，若文件被外部程序改动则自动失效缓存
 * @returns {Promise<Array<{id, name, createdAt, updatedAt}>>}
 */
async function loadProjects() {
  // 缓存命中时，检查文件是否被外部修改（通过 mtime 判断）
  if (projectsCache !== null && !NO_PERSIST) {
    try {
      const st = statSync(PROJECTS_FILE);
      if (projectsCacheMtime !== null && st.mtimeMs !== projectsCacheMtime) {
        // 文件被外部修改，失效缓存以重新加载
        projectsCache = null;
      }
    } catch {
      // 文件不存在或读取 stat 失败，保持缓存（可能是文件尚未创建）
    }
  }

  if (projectsCache !== null) {
    return projectsCache;
  }
  const data = await loadJSON(PROJECTS_FILE);
  // 兼容旧版数组格式和新版对象格式
  if (Array.isArray(data)) {
    projectsCache = data;
  } else if (data && Array.isArray(data.projects)) {
    projectsCache = data.projects;
    lastUsedProjectId = data.lastUsedProjectId || null;
  } else {
    projectsCache = [];
  }

  // 记录文件修改时间，用于后续检测外部修改
  if (!NO_PERSIST) {
    try {
      projectsCacheMtime = statSync(PROJECTS_FILE).mtimeMs;
    } catch {
      projectsCacheMtime = null;
    }
  }

  return projectsCache;
}

/**
 * 保存项目列表（同时更新内存缓存）
 * 以对象格式 { lastUsedProjectId, projects } 持久化，记录上次使用的项目
 */
async function saveProjects(projects) {
  // 先写入磁盘，成功后再更新内存缓存，避免磁盘写入失败时缓存与磁盘不一致
  await saveJSON(PROJECTS_FILE, { lastUsedProjectId, projects });
  projectsCache = projects;
  // 更新文件修改时间，避免下次 loadProjects 误判为外部修改而失效缓存
  if (!NO_PERSIST) {
    try {
      projectsCacheMtime = statSync(PROJECTS_FILE).mtimeMs;
    } catch {
      projectsCacheMtime = null;
    }
  }
}

/**
 * 列出所有项目及当前项目 ID
 * 为每个项目附加 documentCount（当前项目使用内存中的文档数，其他项目从磁盘读取）
 */
export async function listProjects() {
  const projects = await loadProjects();
  // 为每个项目附加文档数量统计
  const projectsWithStats = await Promise.all(projects.map(async (p) => {
    let documentCount = 0;
    if (p.id === currentProjectId) {
      // 当前项目使用内存中的文档数量（可能尚未持久化到磁盘）
      documentCount = documentsMap.size;
    } else {
      try {
        const docs = await loadJSON(getDocumentsFile(p.id));
        documentCount = Array.isArray(docs) ? docs.length : 0;
      } catch {
        // 读取失败时默认为 0
      }
    }
    return { ...p, documentCount };
  }));
  // 按最近使用时间（updatedAt）降序排序：最近使用/切换过的项目排在前面
  // updatedAt 在切换项目时更新，也作为 lastUsedAt 的语义
  projectsWithStats.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  return { projects: projectsWithStats, currentProjectId };
}

/**
 * 获取当前项目 ID
 */
export function getCurrentProjectId() {
  return currentProjectId;
}

/**
 * 创建新项目
 * 原子性保证：先创建目录和数据文件，成功后才将项目加入列表。
 * 若创建目录或数据文件失败，不会将项目加入列表，并清理已创建的目录。
 * @param {string} name - 项目名称
 * @returns {Promise<{id, name, createdAt, updatedAt} | {error: string}>}
 */
export async function createProject(name) {
  // 并发锁：防止在项目切换期间创建新项目
  if (projectSwitching) {
    return { error: '项目正在切换中，请稍后再试' };
  }
  projectSwitching = true;
  try {
    ensureDataDir();
    const projectName = name || '未命名文件夹';

    // 检查名称是否重复
    const projects = await loadProjects();
    if (projects.some(p => p.name === projectName)) {
      return { error: '项目名称已存在' };
    }

    let id;
    do {
      id = 'proj-' + randomUUID().slice(0, 8);
    } while (existsSync(join(DATA_DIR, id)));
    const now = Date.now();
    const project = {
      id,
      name: projectName,
      description: '',
      createdAt: now,
      updatedAt: now
    };

    // 先创建项目目录和空数据文件（原子性：失败则不加入列表）
    const projDir = join(DATA_DIR, id);
    try {
      mkdirSync(projDir, { recursive: true });
      mkdirSync(join(projDir, 'uploads'), { recursive: true });
      await saveJSON(join(projDir, 'documents.json'), []);
      await saveJSON(join(projDir, 'ideas.json'), []);
      await saveJSON(join(projDir, 'graph.json'), { nodes: [], edges: [], stats: {} });
    } catch (e) {
      // 创建目录或数据文件失败，清理已创建的目录，不将项目加入列表
      console.error('[storage] 创建项目目录失败:', e.message);
      try {
        rmSync(projDir, { recursive: true, force: true });
      } catch (cleanErr) {
        console.error('[storage] 清理项目目录失败:', cleanErr.message);
      }
      return { error: '创建项目失败: ' + e.message };
    }

    // 目录和数据文件创建成功后，再将项目添加到列表并保存
    projects.push(project);
    await saveProjects(projects);

    return project;
  } finally {
    projectSwitching = false;
  }
}

/**
 * 删除项目（同时删除数据）
 * @param {string} id - 项目 ID
 * @returns {Promise<{success?: boolean, id?: string, error?: string}>}
 */
export async function deleteProject(id) {
  // 如果删除的是当前项目且图谱正在构建中，禁止删除
  // 避免 switchProjectCore 绕过 building 检查导致构建结果覆盖新项目数据
  if (currentProjectId === id && storage.building) {
    return { error: '图谱正在构建中，无法删除当前项目' };
  }
  // 并发锁：防止在项目切换期间删除项目
  if (projectSwitching) {
    return { error: '项目正在切换中，请稍后再试' };
  }
  projectSwitching = true;
  try {
    const projects = await loadProjects();
    const project = projects.find(p => p.id === id);
    if (!project) {
      return { error: '项目不存在' };
    }
    if (projects.length <= 1) {
      return { error: '不能删除最后一个项目' };
    }

    const filtered = projects.filter(p => p.id !== id);
    await saveProjects(filtered);

    // 如果删除的是当前项目，先切换到其他项目（flush 保存到当前项目），然后再删除目录。
    // 这样避免 switchProjectCore 内部的 flush 通过 ensureDataDir() 重新创建已删除的项目目录。
    if (currentProjectId === id) {
      // 如果有正在运行的任务，先取消，避免解析完成后写入已切换的项目
      if (storage.taskProgress.status === 'running' || storage.taskProgress.status === 'paused') {
        storage.cancelTask();
        // 等待任务真正停止，避免 cancelTask 异步未完成时 switchProjectCore 竞态
        await new Promise(r => setTimeout(r, 200));
      }
      const switchResult = await switchProjectCore(filtered[0].id);
      if (switchResult.error) {
        // 切换失败（如加载新项目数据异常），强制 flush 并清理定时器和内存数据后手动切换
        await flushDocumentsSave();
        await flushIdeasSave();
        await flushGraphSave();
        documentsMap.clear();
        ideasMap.clear();
        currentProjectId = filtered[0].id;
        lastUsedProjectId = filtered[0].id;
        storage.taskProgress = { taskId: null, status: 'idle', stage: '', percent: 0, log: '' };
        storage.building = false;
        try {
          await loadProjectData(filtered[0].id);
        } catch (loadErr) {
          console.error('[storage] 强制切换后加载项目数据失败:', loadErr.message);
          setGraph({ nodes: [], edges: [], stats: {} });
        }
      }
    }

    // 删除项目数据目录（此时 currentProjectId 已指向其他项目，不会通过 ensureDataDir() 重新创建目录）
    const projDir = join(DATA_DIR, id);
    try {
      rmSync(projDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[storage] 删除项目目录失败:`, e.message);
    }

    return { success: true, id };
  } finally {
    projectSwitching = false;
  }
}

/**
 * 更新项目属性（名称和/或描述）
 * renameProject 的扩展版本，支持同时更新名称和描述
 * @param {string} id - 项目 ID
 * @param {{ name?: string, description?: string }} updates - 要更新的字段
 * @returns {Promise<{id, name, description, createdAt, updatedAt} | {error: string}>}
 */
export async function updateProject(id, { name, description } = {}) {
  // 并发锁：防止在项目切换期间更新项目，避免数据串写
  if (projectSwitching) {
    return { error: '项目正在切换中，请稍后再试' };
  }
  const projects = await loadProjects();
  const project = projects.find(p => p.id === id);
  if (!project) {
    return { error: '项目不存在' };
  }

  // 更新名称（如果提供）
  if (name !== undefined) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return { error: '项目名称不能为空' };
    }
    if (projects.some(p => p.id !== id && p.name === trimmedName)) {
      return { error: '项目名称已存在' };
    }
    project.name = trimmedName;
  }

  // 更新描述（如果提供）
  if (description !== undefined) {
    project.description = description;
  }

  project.updatedAt = Date.now();
  await saveProjects(projects);
  return project;
}

/**
 * 重命名项目（向后兼容，委托给 updateProject）
 * @param {string} id - 项目 ID
 * @param {string} name - 新名称
 * @returns {Promise<{id, name, createdAt, updatedAt} | {error: string}>}
 */
export async function renameProject(id, name) {
  return updateProject(id, { name });
}

/**
 * 执行项目切换的核心逻辑（不含并发锁和状态检查）
 * 供 switchProject 和 deleteProject 内部调用，避免 deleteProject 内部调用 switchProject 时
 * 因 projectSwitching 标志而失败。
 * @param {string} projectId - 目标项目 ID
 * @returns {Promise<{success?: boolean, project?: object, error?: string}>}
 */
async function switchProjectCore(projectId) {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { error: '项目不存在' };
  }

  // 刷新当前项目的待保存数据（确保写入旧项目文件，并等待正在执行的保存完成）
  await flushDocumentsSave();
  await flushIdeasSave();
  await flushGraphSave();

  // 记录原项目 ID，用于加载失败时回滚
  const previousProjectId = currentProjectId;

  // 更新当前项目 ID（此后所有文件路径自动指向新项目）
  currentProjectId = projectId;
  // 记忆上次使用的项目，重启后恢复到该项目
  lastUsedProjectId = projectId;
  project.updatedAt = Date.now();
  await saveProjects(projects);

  // 确保新项目目录存在
  ensureDataDir();

  // 加载新项目数据到内存（失败时回滚 currentProjectId 并重新加载原项目数据）
  try {
    await loadProjectData(projectId);
  } catch (e) {
    console.error('[storage] 加载项目数据失败，回滚 currentProjectId:', e.message);
    // 失效项目缓存，确保下次 loadProjects 从磁盘读取最新数据
    invalidateProjectsCache();
    // 回滚到原项目 ID
    currentProjectId = previousProjectId;
    // 重新加载原项目数据（loadProjectData 可能已清空内存中的 Map）
    if (previousProjectId) {
      try {
        await loadProjectData(previousProjectId);
      } catch (reloadErr) {
        console.error('[storage] 重新加载原项目数据失败:', reloadErr.message);
        // 加载空数据作为最终回退
        documentsMap.clear();
        ideasMap.clear();
        setGraph({ nodes: [], edges: [], stats: {} });
      }
    } else {
      // 无原项目，加载空数据
      documentsMap.clear();
      ideasMap.clear();
      setGraph({ nodes: [], edges: [], stats: {} });
    }
    return { error: '加载项目数据失败: ' + e.message };
  }

  // 重置任务进度和构建标志
  storage.taskProgress = { taskId: null, status: 'idle', stage: '', percent: 0, log: '' };
  storage.building = false;

  return { success: true, project };
}

/**
 * 切换当前项目
 * - 检查并发锁和运行状态
 * - 刷新当前项目的待保存数据
 * - 更新文件路径指向新项目子目录
 * - 重新加载该项目的 documents/ideas/graph 到内存
 * @param {string} projectId - 目标项目 ID
 * @returns {Promise<{success?: boolean, project?: object, error?: string}>}
 */
export async function switchProject(projectId) {
  // 并发锁：防止多个 switchProject 请求并发执行
  if (projectSwitching) {
    return { error: '项目正在切换中，请稍后再试' };
  }

  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { error: '项目不存在' };
  }

  // 图谱构建期间禁止切换，避免数据丢失
  if (storage.building) {
    return { error: '图谱正在构建中，无法切换项目' };
  }

  // 文档解析期间（包括暂停状态）禁止切换，避免解析完成后写入新项目导致数据串写
  if (storage.taskProgress.status === 'running' || storage.taskProgress.status === 'paused') {
    return { error: '文档正在解析中，请等待解析完成或取消后再切换项目' };
  }

  projectSwitching = true;
  try {
    return await switchProjectCore(projectId);
  } finally {
    projectSwitching = false;
  }
}

/**
 * 导出项目数据为可序列化的 JSON 对象
 * 包含项目元信息、文档、Idea、图谱
 * 文档原始二进制在导出时会按需从 uploads 目录补回 rawBase64，保证备份/迁移完整性
 * @param {string} projectId - 要导出的项目 ID
 * @returns {Promise<object>} 导出的项目数据对象
 */
export async function exportProjectData(projectId) {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { error: '项目不存在' };
  }

  let documents, ideas, graph;
  if (projectId === currentProjectId) {
    // 当前项目：先 flush 待保存数据确保一致性，再从内存读取
    await flushDocumentsSave();
    await flushIdeasSave();
    await flushGraphSave();
    documents = Array.from(documentsMap.values()).map(d => {
      // 导出时若文档只有 filePath，则按需读取原始二进制补回 rawBase64，
      // 保证项目备份/迁移时不会丢失原始文件
      if (d.filePath && !d.rawBase64) {
        try {
          const buf = readRawBuffer(d.docId || d.id, projectId);
          if (buf) {
            return { ...d, rawBase64: buf.toString('base64') };
          }
        } catch (e) {
          console.warn(`[storage] 导出时读取原始文件失败 ${d.filePath}:`, e.message);
        }
      }
      return d;
    });
    ideas = Array.from(ideasMap.values());
    graph = graphTarget ? JSON.parse(JSON.stringify(graphTarget)) : { nodes: [], edges: [], stats: {} };
  } else {
    // 非当前项目：从磁盘读取数据文件，若文档只有 filePath 则按需补回 rawBase64
    documents = (await loadJSON(getDocumentsFile(projectId)) || []).map(d => {
      if (d.filePath && !d.rawBase64) {
        try {
          const buf = readRawBuffer(d.docId || d.id, projectId);
          if (buf) {
            return { ...d, rawBase64: buf.toString('base64') };
          }
        } catch (e) {
          console.warn(`[storage] 导出时读取原始文件失败 ${d.filePath}:`, e.message);
        }
      }
      return d;
    });
    ideas = await loadJSON(getIdeasFile(projectId)) || [];
    graph = await loadJSON(getGraphFile(projectId)) || { nodes: [], edges: [], stats: {} };
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    project: {
      name: project.name,
      description: project.description || ''
    },
    documents,
    ideas,
    graph
  };
}

/**
 * 导入项目数据（创建新项目并写入数据）
 * 自动处理重名：若项目名已存在则追加序号后缀
 * @param {object} data - 导出的项目数据对象
 * @param {string} [newName] - 可选的新项目名称（覆盖导出数据中的名称）
 * @returns {Promise<{success?: boolean, project?: object, error?: string}>}
 */
export async function importProjectData(data, newName) {
  if (!data || !Array.isArray(data.documents)) {
    return { error: '无效的项目数据格式' };
  }
  // 验证 ideas 数据结构：若提供则必须是数组
  if (data.ideas !== undefined && !Array.isArray(data.ideas)) {
    return { error: '无效的项目数据格式：ideas 必须是数组' };
  }
  // 验证 graph 数据结构：若提供则必须是对象且包含 nodes 数组
  if (data.graph !== undefined && (typeof data.graph !== 'object' || data.graph === null || !Array.isArray(data.graph.nodes))) {
    return { error: '无效的项目数据格式：graph 必须是包含 nodes 数组的对象' };
  }
  if (projectSwitching) {
    return { error: '项目正在切换中，请稍后再试' };
  }
  projectSwitching = true;
  try {
    ensureDataDir();
    let projectName = (newName || data.project?.name || '导入的项目').trim();
    const projects = await loadProjects();

    // 自动处理重名：追加序号后缀
    if (projects.some(p => p.name === projectName)) {
      let suffix = 1;
      while (projects.some(p => p.name === `${projectName} (${suffix})`)) {
        suffix++;
      }
      projectName = `${projectName} (${suffix})`;
    }

    let id;
    do {
      id = 'proj-' + randomUUID().slice(0, 8);
    } while (existsSync(join(DATA_DIR, id)));
    const now = Date.now();
    const project = {
      id,
      name: projectName,
      description: data.project?.description || '',
      createdAt: now,
      updatedAt: now
    };

    // 创建项目目录并写入导入的数据文件
    const projDir = join(DATA_DIR, id);
    try {
      mkdirSync(projDir, { recursive: true });
      mkdirSync(join(projDir, 'uploads'), { recursive: true });
      // 迁移可能存在的 rawBase64 到 uploads 目录，避免 documents.json 中保留大 base64
      const docsToImport = (data.documents || []).map(d => migrateDocumentRawBase64({ ...d }, id));
      await saveJSON(join(projDir, 'documents.json'), docsToImport);
      await saveJSON(join(projDir, 'ideas.json'), data.ideas || []);
      await saveJSON(join(projDir, 'graph.json'), data.graph || { nodes: [], edges: [], stats: {} });
    } catch (e) {
      // 写入失败时清理已创建的目录
      console.error('[storage] 导入项目写入数据失败:', e.message);
      try {
        rmSync(projDir, { recursive: true, force: true });
      } catch (cleanErr) {
        console.error('[storage] 清理项目目录失败:', cleanErr.message);
      }
      return { error: '导入项目失败: ' + e.message };
    }

    // 将新项目加入列表
    projects.push(project);
    await saveProjects(projects);

    return { success: true, project };
  } finally {
    projectSwitching = false;
  }
}

/**
 * 加载指定项目的数据到内存（直接操作底层 Map，绕过 Proxy 避免触发保存）
 * @param {string} projectId - 项目 ID
 */
async function loadProjectData(projectId) {
  // 直接操作底层 Map，绕过 Proxy 避免触发自动保存
  documentsMap.clear();
  ideasMap.clear();

  // 确保 uploads 目录存在，用于迁移旧版 rawBase64
  ensureUploadsDir(projectId);

  // 加载文档
  const docs = await loadJSON(getDocumentsFile(projectId)) || [];
  for (const item of docs) {
    // 向后兼容：旧版文档中内联 rawBase64，一次性迁移到 uploads 目录
    migrateDocumentRawBase64(item, projectId);
    documentsMap.set(item.id || item.docId, item);
  }

  // 加载 Idea
  const ideas = await loadJSON(getIdeasFile(projectId)) || [];
  for (const item of ideas) {
    ideasMap.set(item.id, item);
  }

  // 加载图谱
  const graphData = await loadJSON(getGraphFile(projectId)) || { nodes: [], edges: [], stats: {} };
  setGraph(graphData);
}

// ============ 数据迁移 ============

/**
 * 将旧版数据（DATA_DIR 根目录下的 documents.json/ideas.json/graph.json）
 * 迁移到指定项目子目录下
 * @param {string} projectId - 目标项目 ID
 */
async function migrateLegacyData(projectId) {
  const legacyFiles = [
    { legacy: join(DATA_DIR, 'documents.json'), target: getDocumentsFile(projectId) },
    { legacy: join(DATA_DIR, 'ideas.json'), target: getIdeasFile(projectId) },
    { legacy: join(DATA_DIR, 'graph.json'), target: getGraphFile(projectId) }
  ];

  for (const { legacy, target } of legacyFiles) {
    if (existsSync(legacy)) {
      try {
        const data = await readFile(legacy, 'utf-8');
        // 验证 JSON 有效性
        JSON.parse(data);
        await writeFile(target, data, 'utf-8');
        await rm(legacy);
        console.log(`[storage] 迁移 ${legacy} -> ${target}`);
      } catch (e) {
        console.error(`[storage] 迁移失败 ${legacy}:`, e.message);
      }
    }
  }
}

// ============ 初始化 ============

/**
 * 模块初始化：
 * 1. 加载项目列表，若无项目则创建默认项目
 * 2. 向后兼容：检测旧版数据并迁移到默认项目
 * 3. 设置当前项目并加载数据到内存
 */
async function initialize() {
  ensureDataDir();

  let projects = await loadProjects();

  if (projects.length === 0) {
    // 检查是否有旧版数据需要迁移
    const hasLegacyData = existsSync(join(DATA_DIR, 'documents.json')) ||
                          existsSync(join(DATA_DIR, 'ideas.json')) ||
                          existsSync(join(DATA_DIR, 'graph.json'));

    // 创建默认项目
    const defaultProject = await createProject('默认文件夹');
    if (defaultProject.error) {
      throw new Error('初始化默认项目失败: ' + defaultProject.error);
    }
    // 直接使用返回值，避免在 NO_PERSIST 模式下重新加载为空
    projects = [defaultProject];

    if (hasLegacyData && !NO_PERSIST) {
      console.log('[storage] 检测到旧版数据，开始迁移到默认项目...');
      await migrateLegacyData(defaultProject.id);
    }
  }

  // 设置当前项目：优先恢复上次使用的项目（若仍存在），否则使用第一个项目
  const lastValid = lastUsedProjectId && projects.some(p => p.id === lastUsedProjectId);
  currentProjectId = lastValid ? lastUsedProjectId : projects[0].id;
  lastUsedProjectId = currentProjectId;

  // 持久化 lastUsedProjectId（首次启动或从旧版数据迁移后需要写入）
  if (!NO_PERSIST) {
    await saveProjects(projects);
  }

  // 加载当前项目数据
  try {
    await loadProjectData(currentProjectId);
  } catch (e) {
    console.error('[storage] 加载项目数据失败:', e.message);
    // 使用空数据作为回退
    setGraph({ nodes: [], edges: [], stats: {} });
  }

  const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];
  console.log(`[storage] 初始化完成，当前项目: ${currentProject.name} (${currentProjectId})`);
}

// 顶层 await：阻塞模块加载直到 initialize() 完成，确保所有导入 storage 的模块
// 在使用 storage.documents / storage.graph 等数据时已完成初始化。
//
// 已知 trade-off：顶层 await 会阻塞整个模块图（所有导入 storage.js 的模块都会被挂起），
// 但这是当前架构下最安全的方式——storage 被 13+ 个 handler 模块直接导入并在请求处理时
// 同步访问，若改为导出 Promise 让调用方显式 await，需同步修改 server.js 及全部 handler
// 和测试文件（超过 5 个文件），引入 bug 的风险较高，故保留此模式。
//
// 如未来需要消除顶层 await，可：
//   1. 导出 initialize() 返回的 Promise（如 export const storageReady = initialize()）
//   2. 在 server.js 的 server.listen() 前 await storageReady
//   3. 在所有测试文件的 beforeAll 中 await storageReady
await initialize();

// ============ 导出 ============

export { DATA_DIR, getUploadsDir, getUploadFilePath };
export { storage, watchObject };
export { invalidateProjectsCache };

/**
 * 当前是否正在进行项目切换/创建/删除等敏感操作
 * 供 CRUD handler 拒绝并发写请求，避免数据串写
 * @returns {boolean}
 */
export function isProjectSwitching() {
  return projectSwitching;
}

/**
 * 获取最近一次磁盘写入错误（供前端查询，避免错误静默丢失）
 * @returns {{filePath: string, message: string, code?: string, time: number}|null}
 */
export function getStorageWriteError() {
  return lastWriteError;
}

/**
 * 重置最近一次磁盘写入错误（清空数据后调用，避免旧错误继续干扰前端）
 */
export function resetStorageWriteError() {
  lastWriteError = null;
}

export default storage;
