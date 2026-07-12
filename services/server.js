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
  // catch 未处理的异常，防止客户端 socket 悬挂
  handleHttpRequest(req, res).catch((e) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: e.message }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[知源] 后端服务已启动: http://127.0.0.1:${PORT}`);
});

// HTTP 服务器超时设置
// 禁用 server.requestTimeout（它会覆盖 /parse 的 30 分钟超时），
// 改用 server.timeout 和 req.setTimeout 分别控制
server.timeout = 1800000;        // 30 分钟：整个请求的最大处理时间
server.keepAliveTimeout = 5000;  // 5 秒：keep-alive 空闲超时
server.requestTimeout = 0;       // 禁用：由 server.timeout 和 req.setTimeout 分别控制

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[知源] 端口 ${PORT} 已被占用，后端服务无法启动。`);
    console.error('  可能原因：另一个知源实例正在运行，或其他程序占用了该端口。');
    console.error('  解决方法：关闭占用端口的程序，或通过 PORT 环境变量指定其他端口。');
    process.exit(1);
  }
  console.error('[知源] server error:', err.message);
});

// ============ 全局异常处理 ============
// 防止未捕获的 Promise rejection 或异常导致进程无日志退出
process.on('unhandledRejection', (reason) => {
  console.error('[知源] 未处理的 Promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[知源] 未捕获的异常:', err);
  gracefulShutdown('uncaughtException');
});

// ============ 优雅关闭 ============
// 进程收到 SIGINT（Ctrl+C）或 SIGTERM 时，先关闭 HTTP 服务器并清理 OCR worker，
// 避免残留子进程和未完成的请求。

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return; // 防止重复触发
  shuttingDown = true;
  console.log(`\n[知源] 收到 ${signal} 信号，正在关闭后端服务...`);

  // 强制退出定时器：如果 10 秒内未能优雅关闭，强制退出
  const forceExitTimer = setTimeout(() => {
    console.warn('[知源] 优雅关闭超时，强制退出');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

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
    clearTimeout(forceExitTimer);
    console.log('[知源] 后端服务已停止');
    process.exit(0);
  }, 200);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
