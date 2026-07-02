/** @module services/ollama-detector
 *  职责：智能检测本地 Ollama 服务，必要时尝试启动或返回安装建议
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URLS = [
  'http://127.0.0.1:11434',
  'http://localhost:11434'
];

const OLLAMA_EXECUTABLE_PATHS = {
  win32: [
    path.join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    path.join('C:', 'Program Files', 'Ollama', 'ollama.exe'),
    path.join('C:', 'Program Files (x86)', 'Ollama', 'ollama.exe')
  ],
  darwin: [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    path.join(homedir(), '.ollama', 'ollama')
  ],
  linux: [
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    path.join(homedir(), '.ollama', 'ollama')
  ]
};

let customOllamaPath = '';

export function setCustomOllamaPath(p) {
  customOllamaPath = p || '';
}

export function getCustomOllamaPath() {
  return customOllamaPath;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchModels(baseUrl) {
  const url = baseUrl.replace(/\/$/, '') + '/api/tags';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const models = (data.models || []).map(m => ({
      name: m.name || m.model || '',
      size: m.size || 0
    }));
    return models;
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

function normalizeCustomPath(inputPath) {
  if (!inputPath) return null;
  const trimmed = inputPath.trim();
  if (!trimmed) return null;

  // 如果用户填的是目录，自动补全可执行文件名
  try {
    const st = statSync(trimmed);
    if (st.isDirectory()) {
      const exeName = platform() === 'win32' ? 'ollama.exe' : 'ollama';
      const full = path.join(trimmed, exeName);
      if (existsSync(full)) return full;
      return trimmed;
    }
  } catch {
    // 不是目录则继续按文件处理
  }

  return trimmed;
}

function getDefaultExecutableCandidates() {
  const candidates = [];
  const paths = OLLAMA_EXECUTABLE_PATHS[platform()] || OLLAMA_EXECUTABLE_PATHS.linux;
  for (const p of paths) {
    if (existsSync(p)) candidates.push(p);
  }
  const pathName = platform() === 'win32' ? 'ollama.exe' : 'ollama';
  candidates.push(pathName);
  return candidates;
}

async function tryStartOllama(bin, urls, maxWait) {
  let startError = null;
  try {
    // 先尝试 `ollama list`，它通常会自动拉起服务
    await new Promise((resolve, reject) => {
      execFile(bin, ['list'], { encoding: 'utf-8', timeout: 8000 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout || stderr || '');
      });
    });
  } catch (e) {
    startError = e;
    // 如果失败，尝试显式启动 serve
    try {
      const options = platform() === 'win32'
        ? { windowsHide: true, detached: false }
        : { detached: false };
      const proc = spawn(bin, ['serve'], options);
      proc.on('error', () => {});
      proc.on('exit', () => {});
    } catch (spawnErr) {
      startError = spawnErr;
    }
  }

  // 轮询等待服务就绪
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    for (const url of urls) {
      const models = await fetchModels(url);
      if (models) {
        return { available: true, models, baseUrl: url, started: true };
      }
    }
    await sleep(1000);
  }

  const reason = startError?.message || '无法启动服务';
  return { available: false, started: false, error: `Ollama 启动失败：${reason}` };
}

/**
 * 智能检测 Ollama
 * @param {{baseUrl?:string, tryStart?:boolean, maxWait?:number, customPath?:string}} options
 * @returns {Promise<{available:boolean, models:Array, started?:boolean, installed?:boolean, error?:string, detail?:string, baseUrl?:string, customPath?:string}>}
 */
export async function detectOllama(options = {}) {
  const { baseUrl, tryStart = true, maxWait = 30000, customPath } = options;
  const urls = baseUrl ? [baseUrl] : DEFAULT_BASE_URLS;
  const activePath = normalizeCustomPath(customPath) || normalizeCustomPath(customOllamaPath);

  // 1. 如果用户填了自定义路径，先校验路径是否真实存在
  if (customPath || customOllamaPath) {
    if (!activePath) {
      return { available: false, models: [], installed: false, customPath: activePath || undefined, error: '自定义路径不能为空' };
    }
    if (!existsSync(activePath)) {
      return {
        available: false,
        models: [],
        installed: false,
        customPath: activePath,
        error: `指定路径不存在：${activePath}`
      };
    }
  }

  // 2. 再尝试所有已知地址（服务可能已经在运行）
  for (const url of urls) {
    const models = await fetchModels(url);
    if (models) {
      return { available: true, models, baseUrl: url, installed: true, customPath: activePath || undefined };
    }
  }

  // 3. 未运行：尝试用自定义路径 / 默认路径 / PATH 启动
  if (tryStart) {
    const candidates = activePath
      ? [activePath, ...getDefaultExecutableCandidates()]
      : getDefaultExecutableCandidates();

    const seen = new Set();
    let lastError = null;
    for (const bin of candidates) {
      if (!bin) continue;
      const key = bin.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const binExists = existsSync(bin);
      const isPathFallback = !binExists && (bin === 'ollama' || bin === 'ollama.exe');
      if (!binExists && !isPathFallback) continue;

      const result = await tryStartOllama(bin, urls, maxWait);
      if (result.available) {
        return {
          available: true,
          models: result.models,
          baseUrl: result.baseUrl,
          installed: true,
          started: true,
          customPath: bin === activePath ? activePath : undefined
        };
      }

      if (result.error) lastError = result.error;
    }

    if (activePath && lastError) {
      return { available: false, models: [], installed: true, started: false, customPath: activePath, error: lastError };
    }
  }

  return { available: false, models: [], installed: false, customPath: activePath || undefined, error: '未检测到 Ollama' };
}

/**
 * 仅检测是否安装（不启动服务）
 */
export function isOllamaInstalled(explicitPath) {
  const normalized = normalizeCustomPath(explicitPath) || normalizeCustomPath(customOllamaPath);
  if (normalized) return existsSync(normalized);
  const candidates = getDefaultExecutableCandidates();
  return candidates.some(c => existsSync(c));
}
