/** @module services/server
 *  职责：启动 Node HTTP 后端，挂载 services/api/router
 */
import http from 'node:http';
import { handleHttpRequest } from './api/router.js';
import { initPromptStore } from './api/handlers/prompts.js';

// 启动时加载用户提示词覆盖与任务禁用列表
try { initPromptStore(); } catch (e) { console.warn('[server] 加载提示词覆盖失败:', e.message); }

const PORT = process.env.PORT || 8000;

const server = http.createServer((req, res) => {
  // 对 /parse 路径单独设置更长超时（30 分钟），因为 PDF 解析+OCR 可能很耗时
  if (req.url && req.url.startsWith('/parse')) {
    req.setTimeout(30 * 60 * 1000); // 30 分钟
  }
  handleHttpRequest(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[知源] 后端服务已启动: http://127.0.0.1:${PORT}`);
});

// HTTP 服务器超时设置，避免慢速请求耗尽连接
server.timeout = 300000;         // 5 分钟：整个请求的最大处理时间（/parse 路径已单独延长）
server.keepAliveTimeout = 5000;  // 5 秒：keep-alive 空闲超时
server.requestTimeout = 300000;  // 5 分钟：请求头接收超时（增大以兼容大文件上传）

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[知源] 端口 ${PORT} 已被占用，后端服务无法启动。`);
    console.error('  可能原因：另一个知源实例正在运行，或其他程序占用了该端口。');
    console.error('  解决方法：关闭占用端口的程序，或通过 PORT 环境变量指定其他端口。');
    process.exit(1);
  }
  console.error('[知源] server error:', err.message);
});

// ============ 优雅关闭 ============
// 进程收到 SIGINT（Ctrl+C）或 SIGTERM 时，先关闭 HTTP 服务器并清理 OCR worker，
// 避免残留子进程和未完成的请求。

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return; // 防止重复触发
  shuttingDown = true;
  console.log(`\n[知源] 收到 ${signal} 信号，正在关闭后端服务...`);

  // 1. 停止接受新连接，等待已有连接完成
  server.close(() => {
    console.log('[知源] HTTP 服务器已关闭');
  });

  // 2. 终止 OCR worker，避免残留子进程
  try {
    const { terminateOcrWorker } = await import('../core/parser/index.js');
    await terminateOcrWorker();
    console.log('[知源] OCR worker 已终止');
  } catch (e) {
    // OCR 模块未加载或 worker 不存在，忽略
  }

  // 3. 给持久化定时器一点时间完成最后的写入（storage.js 使用 100ms 防抖）
  setTimeout(() => {
    console.log('[知源] 后端服务已停止');
    process.exit(0);
  }, 200);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
