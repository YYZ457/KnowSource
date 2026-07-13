// ============================================================
// @module core/parser
// 职责：文档解析（PDF/Word/图片 → 结构化文本 + 图片）
// 依赖：pdfjsLib (优先 npm 模块导入，回退全局 CDN), Tesseract (优先 npm 模块导入，回退全局 CDN), mammoth (npm 模块)
// 依赖方向：只能被上层（core/services / core/pipeline）调用，不可反向依赖
// 公开 API: parsePDF, parseWord, ocrImage, extractTextBlocksFromPage,
//           mergePageContent, renderPageToCanvas, terminateOcrWorker
// ============================================================

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES 模块中需要自行定义 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 让 pdfjs-dist 的 require('canvas') 实际加载 @napi-rs/canvas（Electron 主进程无 DOM）
try {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const canvasMod = require('@napi-rs/canvas');
  const Module = require('module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'canvas') {
      return require.resolve('@napi-rs/canvas');
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  // 同时把 DOM API 注入全局
  if (canvasMod.DOMMatrix && typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = canvasMod.DOMMatrix;
  if (canvasMod.Path2D && typeof globalThis.Path2D === 'undefined') globalThis.Path2D = canvasMod.Path2D;
} catch (e) { /* 浏览器环境无需处理 */ }

// 定位本地语言包目录：打包后在 resources/traineddata，开发期在项目根目录
function resolveTraineddataDir() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'traineddata'));
  }
  candidates.push(process.cwd());
  // __dirname 是 core/parser/index.js 所在目录，向上两级到项目根
  try {
    candidates.push(path.resolve(__dirname, '..', '..'));
  } catch (e) {}

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'chi_sim.traineddata')) && fs.existsSync(path.join(dir, 'eng.traineddata'))) {
      return dir;
    }
  }
  // 找不到则返回最可能的目录，让 tesseract.js 自己报错
  return process.resourcesPath ? path.join(process.resourcesPath, 'traineddata') : process.cwd();
}

// 定位 pdfjs CMap 目录：打包后在 resources/cmaps，开发期在 node_modules/pdfjs-dist/cmaps
function resolveCMapUrl() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'cmaps'));
  }
  try {
    candidates.push(path.resolve(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'cmaps'));
  } catch (e) {}

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return undefined;
}

// 优先使用 npm 模块（打包后离线可用），回退到全局 CDN（仅开发期兼容旧页面）
async function getPdfjsLib() {
  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.js');
    const lib = mod.default || mod;
    // 设置 worker：优先使用同目录下的 worker 文件
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      try {
        const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.js');
        if (workerMod.default) {
          lib.GlobalWorkerOptions.workerSrc = workerMod.default;
        }
      } catch (e) {
        // 回退：使用 fake worker（主线程运行）
        if (lib.GlobalWorkerOptions) {
          lib.GlobalWorkerOptions.workerSrc = '';
        }
      }
    }
    return lib;
  } catch (e) {
    // npm 模块不可用时，回退到全局 CDN（仅开发期兼容旧页面）
    if (typeof pdfjsLib !== 'undefined') return pdfjsLib;
    throw e;
  }
}

async function getTesseract() {
  try {
    const mod = await import('tesseract.js');
    return mod.default || mod;
  } catch (e) {
    if (typeof Tesseract !== 'undefined') return Tesseract;
    throw e;
  }
}

// ============ Canvas 工具（兼容浏览器 DOM 与 Node.js 主进程） ============
// 生产环境后端在 Electron 主进程运行，document 未定义，
// 需要通过 @napi-rs/canvas 提供 canvas 实现，否则扫描版 PDF OCR、
// PDF 内嵌图片提取、Word 文档解析会失败。
let _nodeCanvas = null;
async function getNodeCanvas() {
  if (_nodeCanvas !== null) return _nodeCanvas;
  try {
    const mod = await import('@napi-rs/canvas');
    _nodeCanvas = mod.default || mod;
  } catch (e) {
    _nodeCanvas = false; // 标记不可用，避免重复尝试
  }
  return _nodeCanvas;
}

async function createCanvas(width, height) {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const nodeCanvas = await getNodeCanvas();
  if (nodeCanvas) {
    return nodeCanvas.createCanvas(width, height);
  }
  throw new Error('Canvas 不可用：当前环境无 DOM 且未安装 @napi-rs/canvas');
}

// ============ 超时工具函数 ============
/**
 * 带超时的 Promise.race，超时后自动清理定时器，避免定时器泄漏。
 * @param {Promise} promise - 需要执行的 Promise
 * @param {number} ms - 超时毫秒数
 * @param {string} errorMsg - 超时时的错误消息
 * @returns {Promise} 原始 Promise 的结果，或在超时时 reject
 */
function raceWithTimeout(promise, ms, errorMsg) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(errorMsg)), ms); })
  ]).finally(() => clearTimeout(timeoutId));
}

/**
 * 为任意 Promise 添加超时保护，超时后 reject。
 * @param {Promise} promise - 需要保护的 Promise
 * @param {number} ms - 超时毫秒数
 * @param {string} operation - 操作名称（用于错误消息）
 * @returns {Promise} 原始 Promise 的结果，或在超时时 reject
 */
function withTimeout(promise, ms, operation = 'operation') {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms); })
  ]).finally(() => clearTimeout(timeoutId));
}

// 自定义 pdfjs CanvasFactory，使用 @napi-rs/canvas，避免 pdfjs 在 Node 环境 require('canvas')
class NodeCanvasFactory {
  constructor() {
    this.nodeCanvas = null;
  }
  async init() {
    if (!this.nodeCanvas) {
      const mod = await getNodeCanvas();
      this.nodeCanvas = mod;
    }
  }
  create(width, height) {
    if (!this.nodeCanvas) throw new Error('NodeCanvasFactory 未初始化');
    const canvas = this.nodeCanvas.createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext || !canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    if (canvasAndContext) {
      if (canvasAndContext.canvas) {
        canvasAndContext.canvas = null;
      }
      if (canvasAndContext.context) {
        canvasAndContext.context = null;
      }
    }
    // 清理内部状态，释放 nodeCanvas 引用
    this.nodeCanvas = null;
  }
}

// 跟踪 PDF operator list 中的变换矩阵，提取带位置信息的内嵌图片
async function extractImagesFromPageWithPositions(page, pdfjsLib) {
  const images = [];
  if (!pdfjsLib || !pdfjsLib.OPS) return images;
  try {
    const viewport = page.getViewport({ scale: 1 });
    const pageArea = viewport.width * viewport.height;
    const ops = await withTimeout(page.getOperatorList(), 30000, 'PDF getOperatorList');
    const { fnArray, argsArray } = ops;

    const identity = [1, 0, 0, 1, 0, 0];
    let ctm = [...identity];
    const stack = [];

    for (let j = 0; j < fnArray.length; j++) {
      const fn = fnArray[j];
      const args = argsArray[j];

      if (fn === pdfjsLib.OPS.save) {
        stack.push([...ctm]);
      } else if (fn === pdfjsLib.OPS.restore) {
        ctm = stack.pop() || [...identity];
      } else if (fn === pdfjsLib.OPS.transform) {
        ctm = multiplyMatrices(ctm, args);
      } else if (fn === pdfjsLib.OPS.paintImageXObject) {
        try {
          const img = await raceWithTimeout(
            page.objs.get(args[0]),
            3000,
            'img timeout'
          );
          if (img && img.width >= 30 && img.height >= 30) {
            const dataUrl = await imageToDataUrl(img);
            if (dataUrl) {
              const xs = [0, ctm[0], ctm[2], ctm[0] + ctm[2]].map(v => v + ctm[4]);
              const ys = [0, ctm[1], ctm[3], ctm[1] + ctm[3]].map(v => v + ctm[5]);
              const x = Math.min(...xs);
              const y = Math.min(...ys);
              const width = Math.max(...xs) - x;
              const height = Math.max(...ys) - y;
              // 跳过占满整页的背景图/水印
              if (width * height > pageArea * 0.9) continue;
              images.push({
                x, y,
                centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
                width, height,
                dataUrl,
                page: page.pageNumber
              });
            }
          }
        } catch (e) { /* 忽略单张图片提取失败 */ }
      } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
        const img = args[0];
        if (img && img.width >= 30 && img.height >= 30) {
          const dataUrl = await imageToDataUrl(img);
          if (dataUrl) {
            const xs = [0, ctm[0], ctm[2], ctm[0] + ctm[2]].map(v => v + ctm[4]);
            const ys = [0, ctm[1], ctm[3], ctm[1] + ctm[3]].map(v => v + ctm[5]);
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            const width = Math.max(...xs) - x;
            const height = Math.max(...ys) - y;
            if (width * height > pageArea * 0.9) continue;
            images.push({
              x, y,
              centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
              width, height,
              dataUrl,
              page: page.pageNumber
            });
          }
        }
      }
    }
  } catch (e) { /* 忽略页面图片提取失败 */ }
  return images;
}

// ============ 1. PDF解析（使用pdf.js） ============
// options:
//   - maxOcrPages: 扫描版PDF时最多OCR的页数（默认 Infinity，不限制）
//   - signal: AbortSignal，支持取消解析
//   - maxPreviewImages: 扫描版保存为展示用的页面图片数量上限（默认 Infinity）
//   - knownScanned: 调用方已确认是扫描版PDF时设为 true，跳过第一遍文本提取以避免重复解析
// onProgress 回调参数：{ currentPage, totalPages, stage: 'text'|'ocr'|'merge', percent, log }
async function parsePDF(file, onProgress, options = {}) {
  const maxOcrPages = options.maxOcrPages ?? Infinity;
  const maxPreviewImages = options.maxPreviewImages ?? 20;
  const signal = options.signal || null;
  // 暂停检查：页间可暂停，与 parsePDFPages (services/api/handlers/parse.js) 保持一致
  const pauseCheck = options.pauseCheck || null;
  // 调用方已确认是扫描版（如 parse.js 的 parsePDFPages 已提取过文字层且字符稀薄），
  // 此时跳过 parsePDF 内部的第一遍文本提取，避免对大 PDF 重复解析所有页面
  const knownScanned = options.knownScanned === true;
  const pdfjsLib = await getPdfjsLib();

  function checkSignal() {
    if (signal && signal.aborted) {
      const err = new Error(signal.reason || '解析已取消');
      err.code = 'CANCELLED';
      throw err;
    }
  }

  function reportProgress({ currentPage, totalPages, stage, percent, log }) {
    if (onProgress) {
      onProgress({ currentPage, totalPages, stage, percent, log });
    }
  }

  // ★ 检查pdf.js是否加载
  if (!pdfjsLib || !pdfjsLib.getDocument) {
    throw new Error('pdf.js库未加载，请检查网络连接后刷新页面重试');
  }

  // ★ 检查文件有效性
  if (!file || !file.size) {
    throw new Error('文件无效或为空');
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new Error('文件过大（超过100MB），请上传较小的PDF文件');
  }

  let arrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (e) {
    throw new Error('读取文件失败: ' + e.message);
  }

  let pdf;
  try {
    const cMapUrl = resolveCMapUrl();
    const docOptions = {
      data: arrayBuffer,
      disableFontFace: true,        // ★ 禁用字体加载，避免某些PDF卡住
      isEvalSupported: false,       // ★ 禁用eval，提高兼容性
      disableRange: true,           // ★ 禁用range请求，避免CORS问题
      disableStream: true           // ★ 禁用stream，避免CORS问题
    };
    if (cMapUrl) {
      docOptions.cMapUrl = cMapUrl.replace(/\\/g, '/') + '/';
      docOptions.cMapPacked = true;
    }
    // 标准字体目录：打包后在 resources/standard_fonts
    if (process.resourcesPath) {
      const sfDir = path.join(process.resourcesPath, 'standard_fonts');
      if (fs.existsSync(sfDir)) {
        docOptions.standardFontDataUrl = sfDir.replace(/\\/g, '/') + '/';
      }
    }
    pdf = await withTimeout(pdfjsLib.getDocument(docOptions).promise, 30000, 'PDF load');
    // 释放 arrayBuffer 引用，让 GC 回收大块内存
    arrayBuffer = null;
  } catch (e) {
    throw new Error('PDF解析失败，文件可能已损坏: ' + e.message);
  }

  const totalPages = pdf.numPages;
  if (!totalPages || totalPages === 0) {
    await pdf.destroy().catch(() => {});
    throw new Error('PDF文件没有页面');
  }
  // 使用数组收集文本片段，避免大PDF的 += 拼接性能问题
  const textParts = [];
  let images = [];

  try {
  // 第一遍：提取每页的文字块（含位置）和内嵌图片（含位置），判断是否为扫描版PDF
  // 当 knownScanned 为 true 时（调用方已通过 parsePDFPages 确认文字层稀薄），
  // 跳过第一遍文本提取，直接进入 OCR 流程，避免对大 PDF 重复逐页解析
  const pageData = [];
  if (!knownScanned) {
  for (let i = 1; i <= totalPages; i++) {
    checkSignal();
    if (pauseCheck) await pauseCheck();
    try {
      const page = await withTimeout(pdf.getPage(i), 30000, `PDF getPage(${i})`);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      const textContent = await withTimeout(page.getTextContent(), 30000, `PDF getTextContent(${i})`);

      // ★ 智能文字提取：支持多栏排版、页眉页脚过滤、字号自适应
      const textBlocks = extractTextBlocksFromPage(textContent, pageWidth, pageHeight);

      // ★ 提取带位置信息的内嵌图片（用于后续按阅读顺序 OCR 插入）
      // 达到预览图片上限后跳过后续图片提取，避免内存爆炸
      let pageImages = [];
      if (images.length < maxPreviewImages) {
        pageImages = await extractImagesFromPageWithPositions(page, pdfjsLib);
        const remaining = maxPreviewImages - images.length;
        if (pageImages.length > remaining) {
          pageImages = pageImages.slice(0, remaining);
        }
      }
      images.push(...pageImages);

      pageData.push({ page: i, pageHeight, textBlocks, pageImages });
    } catch (pageErr) {
      // 单页提取失败不中断整体流程，跳过该页继续
      console.warn(`[parsePDF] 第 ${i} 页文本提取失败: ${pageErr.message}`);
      pageData.push({ page: i, pageHeight: 0, textBlocks: [], pageImages: [] });
    }

    reportProgress({
      currentPage: i,
      totalPages,
      stage: 'text',
      percent: Math.round((i / totalPages) * 15),
      log: `正在提取文字层... 第 ${i}/${totalPages} 页`
    });
  }
  } // end if (!knownScanned)

  // 判断是否为扫描版PDF：平均每页字符数 < 50
  // 当 knownScanned 为 true 时直接判定为扫描版，跳过字符统计
  const isScanned = knownScanned || (() => {
    const totalChars = pageData.reduce((s, pd) => s + pd.textBlocks.reduce((ss, b) => ss + b.text.replace(/\s/g, '').length, 0), 0);
    return (totalChars / totalPages) < 50;
  })();

  // 如果是扫描版PDF，对每一页进行整页 OCR
  if (isScanned) {
    images = []; // 扫描版使用整页截图替代内嵌图片，避免重复
    let previewAccumulator = '';
    // 限制OCR页数，默认不限制
    const ocrPages = maxOcrPages === Infinity ? totalPages : Math.min(totalPages, maxOcrPages);
    for (let i = 1; i <= ocrPages; i++) {
      checkSignal();
      if (pauseCheck) await pauseCheck();
      const page = await withTimeout(pdf.getPage(i), 30000, `PDF getPage(OCR ${i})`);
      reportProgress({
        currentPage: i,
        totalPages: ocrPages,
        stage: 'ocr',
        percent: 15 + Math.round(((i - 1) / ocrPages) * 80),
        log: `正在进行 OCR 识别... 第 ${i}/${ocrPages} 页`,
        previewText: previewAccumulator
      });
      let ocrText = '';
      try {
        // 渲染页面为canvas（高分辨率以提高OCR精度，大页面会自动降采样）
        const canvas = await renderPageToCanvas(page, 2.0);
        // 将canvas转为dataURL进行OCR
        const dataUrl = canvas.toDataURL('image/png');
        // toDataURL 是同步阻塞操作，大图片可能阻塞事件循环 100-500ms，
        // 此处让出事件循环，使 HTTP 服务器能处理进度轮询请求，避免界面"卡死"。
        // setImmediate 在 Node/Electron 主进程可用；浏览器回退到 setTimeout(0)。
        await new Promise(resolve => {
          (typeof setImmediate === 'function' ? setImmediate : setTimeout)(resolve);
        });
        // OCR识别（传递细粒度进度）
        ocrText = await ocrImage(dataUrl, (p) => {
          reportProgress({
            currentPage: i,
            totalPages: ocrPages,
            stage: 'ocr',
            percent: 15 + Math.round(((i - 1 + p) / ocrPages) * 80),
            log: `正在进行 OCR 识别... 第 ${i}/${ocrPages} 页`,
            previewText: previewAccumulator
          });
        });

        // 同时保存页面图片（用于展示）
        if (i <= maxPreviewImages) {
          images.push({
            page: i,
            dataUrl: dataUrl,
            width: canvas.width,
            height: canvas.height,
            isOriginal: true
          });
        }
      } catch (pageErr) {
        const errMsg = pageErr && pageErr.message ? pageErr.message : String(pageErr);
        console.warn(`[parsePDF] 第 ${i} 页 OCR 失败/超时: ${errMsg}`);
        ocrText = `[第${i}页识别失败：${errMsg}]`;
      }
      const pageSection = `\n--- 第${i}页(OCR) ---\n${ocrText}\n`;
      textParts.push(pageSection);
      // 限制预览累积器大小，避免大 PDF 导致内存增长和传输开销
      // 仅保留最近 2 页的 OCR 文本（滑动窗口）
      previewAccumulator += pageSection;
      if (previewAccumulator.length > 4000) {
        previewAccumulator = previewAccumulator.slice(-4000);
      }

      reportProgress({
        currentPage: i,
        totalPages: ocrPages,
        stage: 'ocr',
        percent: 15 + Math.round((i / ocrPages) * 80),
        log: `OCR 识别完成第 ${i}/${ocrPages} 页`,
        previewText: previewAccumulator
      });
    }
    // 释放OCR worker
    await terminateOcrWorker();

    // 如果有更多页面未OCR，添加提示
    if (ocrPages < totalPages) {
      textParts.push(`\n\n[提示：共${totalPages}页，已OCR前${ocrPages}页。完整解析可取消页数限制]\n`);
    }
  } else {
    // 文本型PDF：把图片 OCR 结果按阅读顺序插入到文字层中
    for (const pd of pageData) {
      checkSignal();
      if (pauseCheck) await pauseCheck();
      const pageImages = pd.pageImages || [];
      const pageText = await mergePageContent(pd.textBlocks, pageImages, (p) => {
        reportProgress({
          currentPage: pd.page,
          totalPages,
          stage: 'merge',
          percent: 15 + Math.round(((pd.page - 1 + p) / totalPages) * 80),
          log: `正在合并页面内容... 第 ${pd.page}/${totalPages} 页`
        });
      });
      textParts.push(`\n--- 第${pd.page}页 ---\n${pageText}\n`);
    }
    // 释放OCR worker（复用结束）
    await terminateOcrWorker();
  }

  // 修复 PDF 重影导致的相邻字符重复
  const cleanedText = collapseGhostDuplicates(textParts.join(''));
  return { text: cleanedText, images, totalPages, isScanned };
  } finally {
    // 销毁PDF文档对象，释放内存（确保异常路径也能清理）
    if (pdf) {
      try { await pdf.destroy(); } catch (e) { /* 忽略销毁错误 */ }
    }
  }
}

// ============ 1a. 智能PDF文字提取（支持多栏排版） ============
// 解决问题：文字顺序乱、多栏排版、页眉页脚、字号混排
// 返回按阅读顺序（从上到下）排列的文本块数组，每个块含 y 坐标，便于与图片 OCR 结果合并
function extractTextBlocksFromPage(textContent, pageWidth, pageHeight) {
  // 1. 收集所有text item，提取坐标和字号
  const items = [];
  for (const item of textContent.items) {
    if (!item.str || item.str.length === 0) continue;
    // transform: [a, b, c, d, e, f]
    // a,d 缩放，b,c 旋转，e X坐标，f Y坐标
    const a = item.transform[0], b = item.transform[1];
    const d = item.transform[3];
    const x = item.transform[4];
    const y = item.transform[5];
    // 字号 = sqrt(a² + b²)
    const fontSize = Math.sqrt(a * a + b * b);
    // 旋转角度（弧度）
    const rotation = Math.atan2(b, a);
    items.push({
      x, y, str: item.str,
      fontSize,
      width: item.width || 0,
      height: item.height || fontSize,
      rotation
    });
  }

  if (items.length === 0) return [];

  // 2. 过滤旋转文字（竖排文字暂不处理，避免干扰）
  const normalItems = items.filter(it => Math.abs(it.rotation) < 0.3);
  const rotatedItems = items.filter(it => Math.abs(it.rotation) >= 0.3);

  // 3. 检测多栏排版
  // 思路：统计X坐标分布，如果存在明显的"间隙"（某段X范围文字很少），
  // 则认为是多栏排版，按栏分别处理
  const columns = detectColumns(normalItems, pageWidth);

  // 4. 对每一栏分别按行分组
  let allLines = [];
  for (const col of columns) {
    const colItems = normalItems.filter(it => it.x >= col.x1 && it.x <= col.x2);
    const colLines = groupItemsIntoLines(colItems);
    allLines = allLines.concat(colLines);
  }

  // 5. 添加旋转文字（作为单独行）
  for (const it of rotatedItems) {
    allLines.push({ y: it.y, items: [it], isRotated: true });
  }

  // 6. 按Y坐标排序所有行（从上到下，Y大的在上）
  allLines.sort((a, b) => b.y - a.y);

  // 7. 过滤页眉页脚
  // 页眉：Y > pageHeight * 0.93 且字号小
  // 页脚：Y < pageHeight * 0.07 且字号小
  const headerY = pageHeight * 0.93;
  const footerY = pageHeight * 0.07;
  // 统计中位数字号，用于判断"小字号"
  const fontSizes = normalItems.map(it => it.fontSize).sort((a, b) => a - b);
  const medianFontSize = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 10;

  const filteredLines = allLines.filter(line => {
    // 页眉页脚区域且字号明显小于正文
    if (line.y > headerY && line.items[0] && line.items[0].fontSize < medianFontSize * 0.85) return false;
    if (line.y < footerY && line.items[0] && line.items[0].fontSize < medianFontSize * 0.85) return false;
    return true;
  });

  // 8. 把每行转成文本块 { y, text }
  const blocks = [];
  for (const line of filteredLines) {
    // 行内按X排序
    line.items.sort((a, b) => a.x - b.x);
    let lineText = '';
    let prevEndX = null;
    let prevItem = null;
    for (const item of line.items) {
      if (prevEndX !== null && prevItem) {
        const gap = item.x - prevEndX;
        // 间距判断：是否需要加空格
        const avgCharWidth = Math.max(2, item.fontSize * 0.5);
        if (gap > avgCharWidth * 1.2 && !lineText.endsWith(' ') && !item.str.startsWith(' ')) {
          const lastChar = lineText.slice(-1);
          const firstChar = item.str[0];
          const isCjkLast = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(lastChar);
          const isCjkFirst = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(firstChar);
          // 中英文之间加空格，中文之间不加
          if (!isCjkLast || !isCjkFirst) {
            lineText += ' ';
          }
        }
      }
      lineText += item.str;
      prevEndX = item.x + (item.width || item.str.length * item.fontSize * 0.5);
      prevItem = item;
    }
    const trimmed = lineText.trim();
    if (trimmed) blocks.push({ y: line.y, text: trimmed });
  }

  return blocks;
}

/**
 * 修复 PDF 重影导致的相邻字符重复，如 "条件件与与独立" -> "条件与独立"
 * 策略：迭代折叠，直到没有相邻重复对为止；同时支持整词级重复折叠。
 * 安全限制：所有迭代循环最多执行 MAX_ITERATIONS 次，防止病态输入导致死循环。
 */
function collapseGhostDuplicates(str) {
  if (!str || str.length < 4) return str;
  const MAX_ITERATIONS = 5;
  let result = str;
  let changed = true;
  let iter = 0;
  // 单字重影折叠：仅折叠连续重复 ≥3 次的单字（如 "慢慢慢慢" → "慢"）
  // 阈值 3 可保护合法叠词（"慢慢""匆匆"等双字叠词不折叠）
  // PDF 重影通常导致 3+ 次重复，而正常文本极少出现三字叠
  while (changed && iter < MAX_ITERATIONS) {
    changed = false;
    let r = '';
    let i = 0;
    while (i < result.length) {
      const c = result[i];
      // 检测 3+ 次连续重复的中文字符
      if (i < result.length - 2 && c === result[i + 1] && c === result[i + 2] && /[\u4e00-\u9fa5]/.test(c)) {
        r += c;
        // 跳过所有连续重复
        let j = i + 1;
        while (j < result.length && result[j] === c) j++;
        i = j;
        changed = true;
      } else {
        r += c;
        i++;
      }
    }
    result = r;
    iter++;
  }

  // 英文整词重影（如 "IntroductionIntroduction"）
  let prev;
  iter = 0;
  do {
    prev = result;
    result = result.replace(/([a-zA-Z]{3,})\1/g, '$1');
    iter++;
  } while (result !== prev && iter < MAX_ITERATIONS);

  // CJK 整词/短语重影（如 "概率模型概率模型"）
  // 仅当某个长度≥4 的 CJK 片段连续重复≥2 次时折叠
  // 阈值 4 可保护短合法重复短语（如 "我们我们""正文正文"）
  iter = 0;
  do {
    prev = result;
    result = result.replace(/([\u4e00-\u9fa5]{4,})\1+/g, '$1');
    iter++;
  } while (result !== prev && iter < MAX_ITERATIONS);

  return result;
}

// PDF 变换矩阵乘法：m1 * m2
function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

// 将 pdfjs-dist 提取的 image 对象转为 dataURL（支持 HTMLImageElement 和 raw data）
async function imageToDataUrl(img) {
  if (!img) return null;
  try {
    const canvas = await createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    if (img.data && img.data.length > 0) {
      try {
        const canvas = await createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(img.width, img.height);
        if (img.data.length === img.width * img.height * 4) {
          imageData.data.set(img.data);
        } else if (img.data.length === img.width * img.height * 3) {
          for (let p = 0; p < img.data.length; p += 3) {
            const idx = (p / 3) * 4;
            imageData.data[idx] = img.data[p];
            imageData.data[idx + 1] = img.data[p + 1];
            imageData.data[idx + 2] = img.data[p + 2];
            imageData.data[idx + 3] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
      } catch (e2) { /* 忽略 */ }
    }
  }
  return null;
}

// 按阅读顺序合并文字块与图片 OCR 结果（Y 坐标从上到下）
async function mergePageContent(textBlocks, pageImages, onImageProgress, ocrFn = ocrImage) {
  if (!pageImages || pageImages.length === 0) {
    return textBlocks.map(b => b.text).join('\n');
  }

  const textItems = textBlocks.map(b => ({ type: 'text', y: b.y, text: b.text }));
  const imageItems = [];
  for (let idx = 0; idx < pageImages.length; idx++) {
    const img = pageImages[idx];
    const ocrText = await ocrFn(img.dataUrl, (p) => {
      if (onImageProgress) {
        // 单张图片进度映射到整张图片在该页中的进度
        const pageProgress = (idx + (p || 0)) / pageImages.length;
        onImageProgress(pageProgress);
      }
    });
    if (ocrText && ocrText.trim()) {
      imageItems.push({ type: 'image', y: img.centerY, text: ocrText.trim() });
    }
  }

  // 按 Y 坐标从大到小排序（PDF 坐标系 Y 向上，Y 大=页面上方）
  const allItems = [...textItems, ...imageItems].sort((a, b) => b.y - a.y);
  return allItems.map(it => it.text).join('\n');
}

// 检测多栏排版：分析X坐标分布，找出栏间隙
function detectColumns(items, pageWidth) {
  if (items.length === 0) return [{ x1: 0, x2: pageWidth }];

  // 文字item太少时不做多栏检测（容易误判）
  if (items.length < 20) return [{ x1: 0, x2: pageWidth }];

  // 统计X坐标直方图（bin宽度=pageWidth/50）
  const binCount = 50;
  const binWidth = pageWidth / binCount;
  const histogram = new Array(binCount).fill(0);
  for (const it of items) {
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(it.x / binWidth)));
    histogram[bin]++;
  }

  // 只在页面中间区域找栏间隙（30%~70%范围）
  // 栏间隙通常在页面正中间附近
  const startBin = Math.floor(binCount * 0.3);
  const endBin = Math.floor(binCount * 0.7);
  const avgDensity = items.length / binCount;
  // 阈值：低于平均密度的10%（更严格，避免误判）
  const threshold = Math.max(1, avgDensity * 0.10);

  // 找最深的波谷
  let bestGap = null;
  let bestGapScore = 0;
  for (let i = startBin; i < endBin; i++) {
    if (histogram[i] <= threshold) {
      let gapStart = i;
      let gapEnd = i;
      while (gapEnd < endBin && histogram[gapEnd] <= threshold) gapEnd++;
      const gapWidth = gapEnd - gapStart;
      // 间隙宽度至少3个bin（约页面宽度的6%）才算栏分隔
      if (gapWidth >= 3 && gapWidth > bestGapScore) {
        bestGapScore = gapWidth;
        bestGap = { x1: gapStart * binWidth, x2: gapEnd * binWidth };
      }
      i = gapEnd;
    }
  }

  if (bestGap) {
    // 双栏排版
    return [
      { x1: 0, x2: bestGap.x1 },
      { x1: bestGap.x2, x2: pageWidth }
    ];
  }

  // 单栏
  return [{ x1: 0, x2: pageWidth }];
}

// 将items按Y坐标分组为行
function groupItemsIntoLines(items) {
  if (items.length === 0) return [];

  // 按Y降序排序（上到下）
  items.sort((a, b) => b.y - a.y);

  // 动态计算行高容差：基于中位数字号
  const fontSizes = items.map(it => it.fontSize).sort((a, b) => a - b);
  const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 10;
  // 行高容差 = 字号 * 0.6（比一半稍大，容许下标/上标）
  const yTolerance = Math.max(3, medianFontSize * 0.6);

  const lines = [];
  let currentLine = { y: items[0].y, items: [items[0]] };

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    // 同一行：Y坐标接近
    if (Math.abs(item.y - currentLine.y) <= yTolerance) {
      currentLine.items.push(item);
      // 更新行的Y为平均值，提高后续判断稳定性
      currentLine.y = (currentLine.y * (currentLine.items.length - 1) + item.y) / currentLine.items.length;
    } else {
      lines.push(currentLine);
      currentLine = { y: item.y, items: [item] };
    }
  }
  lines.push(currentLine);

  return lines;
}

// ============ 1b. Word文档解析（使用mammoth.js，无 DOM 依赖） ============
async function parseWord(file, onProgress) {
  let arrayBuffer = await file.arrayBuffer();
  if (onProgress) onProgress(0, 1, '正在解析Word文档...');

  // 动态导入 mammoth（与其他 getXxxLib 函数保持一致）
  const mammothMod = await import('mammoth');
  const mammoth = mammothMod.default || mammothMod;
  // mammoth.convertToHtml 返回 { value: html, messages }
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value || '';
  // 释放原始文件 buffer 引用，让 GC 回收大块内存
  arrayBuffer = null;

  if (onProgress) onProgress(1, 1, '解析完成');

  // 提取图片（mammoth 将内嵌图片转为 <img src="data:...">）— 无 DOM 依赖
  const images = [];
  const imgRegex = /<img[^>]+src="(data:[^"]+)"[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    images.push({
      page: 1,
      dataUrl: imgMatch[1],
      width: 200,
      height: 200
    });
  }

  // 将 HTML 转为纯文本（保留段落结构）— 无 DOM 依赖，使用正则
  // 块级标签转为换行，其他标签直接 strip，HTML 实体解码
  let text = html
    .replace(/<\/?(p|div|h[1-6]|li|tr|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, images, totalPages: 1 };
}

// ============ 1c. PPTX 解析（使用 jszip，无外部二进制依赖） ============
async function parsePPTX(file, onProgress) {
  const JSZip = (await import('jszip')).default;
  let arrayBuffer = await file.arrayBuffer();

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('PPTX 文件为空');
  }
  if (arrayBuffer.byteLength > 100 * 1024 * 1024) {
    throw new Error('PPTX 文件过大（超过100MB），请上传较小的文件');
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch (e) {
    throw new Error('PPTX 解压失败，文件可能已损坏: ' + (e && e.message ? e.message : String(e)));
  }
  // 释放原始文件 buffer 引用，zip 对象已持有解压后的数据
  arrayBuffer = null;

  // 从 presentation.xml 获取幻灯片顺序
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string') || '';
  const slideMatches = [...presentationXml.matchAll(/<p:sldId[^>]*\sid="(\d+)"[^>]*\sr:id="([^"]+)"/g)];

  // 解析关系映射：r:id -> Target
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string') || '';
  const relMap = {};
  for (const match of relsXml.matchAll(/<Relationship[^>]*\sId="([^"]+)"[^>]*\sTarget="([^"]+)"/g)) {
    relMap[match[1]] = match[2];
  }

  // 按 presentation.xml 中的顺序收集幻灯片文件路径
  const slidePaths = [];
  for (const m of slideMatches) {
    const target = relMap[m[2]];
    if (target) {
      // Target 可能是相对路径如 "slides/slide1.xml" 或绝对路径如 "/ppt/slides/slide1.xml"
      const normalized = target.replace(/^\//, '');
      slidePaths.push(normalized.startsWith('ppt/') ? normalized : `ppt/${normalized}`);
    }
  }

  // 如果 presentation.xml 没解析出顺序，回退到直接枚举 slides 目录
  if (slidePaths.length === 0) {
    const allFiles = Object.keys(zip.files);
    const fallback = allFiles
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml$/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml$/i)?.[1] || '0', 10);
        return na - nb;
      });
    slidePaths.push(...fallback);
  }

  const totalPages = slidePaths.length;
  if (totalPages === 0) {
    throw new Error('PPTX 中没有找到幻灯片');
  }

  let fullText = '';
  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideXml = await zip.file(slidePath)?.async('string') || '';

    // 按段落 <a:p> 提取文本，保留换行结构
    const paragraphs = [];
    for (const pMatch of slideXml.matchAll(/<a:p\b[^>]*>(.*?)<\/a:p>/gs)) {
      const pXml = pMatch[1];
      const textItems = [];
      for (const match of pXml.matchAll(/<a:t(?:[^>]*)>([^<]*)<\/a:t>/g)) {
        textItems.push(decodeXmlEntities(match[1]));
      }
      const pText = textItems.join('').trim();
      if (pText) paragraphs.push(pText);
    }

    const slideText = paragraphs.join('\n').trim();
    if (slideText) {
      fullText += `\n--- 第${i + 1}页 ---\n${slideText}\n`;
    }

    if (onProgress) onProgress(i + 1, totalPages, `正在解析第 ${i + 1}/${totalPages} 页...`);
  }

  return { text: fullText, images: [], totalPages };
}

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}



// ============ 2. OCR识别（Tesseract.js） ============
// 创建OCR worker（复用，避免重复加载语言包）
let _ocrWorker = null;
let _ocrWorkerPromise = null;
// 当前提式的 OCR 进度回调。
// Tesseract.js 的 logger 在 createWorker 时绑定，worker 复用后无法更换。
// 因此用模块级可变引用，使每次 ocrImage 调用都能更新回调，
// 确保多页 PDF OCR 时每一页的进度都能正确传递到前端。
let _currentOcrProgress = null;
async function getOcrWorker() {
  if (_ocrWorker) return _ocrWorker;
  if (_ocrWorkerPromise) return _ocrWorkerPromise;

  _ocrWorkerPromise = (async () => {
    const Tesseract = await getTesseract();
    const langPath = resolveTraineddataDir();
    console.log(`[tesseract] 使用本地语言包目录: ${langPath}`);

    // tesseract.js v5 默认 gzip=true，会寻找 .traineddata.gz；
    // 本地只准备了 .traineddata，且 createWorker 内部错误会被吞掉导致永远挂起，
    // 因此显式关闭 gzip，并加整体超时防护。
    const createPromise = Tesseract.createWorker('chi_sim+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && _currentOcrProgress) {
          _currentOcrProgress(m.progress);
        }
      },
      langPath,
      gzip: false,
      errorHandler: err => console.error('[tesseract] worker error:', err)
    });
    let initTimeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      initTimeoutId = setTimeout(() => reject(new Error('OCR worker 初始化超时')), 60000);
    });
    let worker;
    try {
      worker = await Promise.race([createPromise, timeoutPromise]);
    } finally {
      // 成功路径也必须清除定时器，避免泄漏
      clearTimeout(initTimeoutId);
    }

    // 设置OCR参数以提高中文识别率
    await worker.setParameters({
      // PSM 3 = 全自动页面分割（默认）
      tessedit_pageseg_mode: '3',
      // 保留词间空格
      preserve_interword_spaces: '1',
    });
    _ocrWorker = worker;
    return worker;
  })();

  try {
    return await _ocrWorkerPromise;
  } catch (e) {
    // 初始化失败时重置锁，允许下次重新尝试
    _ocrWorkerPromise = null;
    throw e;
  } finally {
    // 成功后如果已有 _ocrWorker，可清空 Promise 锁避免长期引用
    if (_ocrWorker) _ocrWorkerPromise = null;
  }
}

// 单页 OCR 超时时间（毫秒），避免大图片导致解析卡死
const OCR_PAGE_TIMEOUT = 60000;

async function ocrImage(file, onProgress) {
  _currentOcrProgress = onProgress || null;
  const worker = await getOcrWorker();
  let recognizeTimeoutId;
  try {
    // Wrap the recognize call with timeout
    // 关键：recognize 的 Promise 即使被 race 丢弃也仍会在后台运行
    // 必须挂 .catch() 防止 unhandled promise rejection
    const recognizePromise = worker.recognize(file);
    // 吞掉后台仍在运行的 recognize 的 rejection（超时后 worker 会被 terminate）
    recognizePromise.catch(() => {});

    const result = await Promise.race([
      recognizePromise,
      new Promise((_, reject) => {
        recognizeTimeoutId = setTimeout(() => reject(new Error('OCR timeout')), OCR_PAGE_TIMEOUT);
      })
    ]).finally(() => clearTimeout(recognizeTimeoutId));
    return result?.data?.text || '';
  } catch (err) {
    // 超时或异常后必须 terminate worker 并置 _ocrWorker=null，避免竞态
    clearTimeout(recognizeTimeoutId);
    try { await worker.terminate(); } catch (_) {}
    _ocrWorker = null;
    _ocrWorkerPromise = null;
    console.warn('[OCR] Recognition failed:', err.message);
    return '';
  } finally {
    // 清理进度回调，避免后续复用 worker 时回调到已过期的闭包
    _currentOcrProgress = null;
  }
}

// 释放OCR worker
async function terminateOcrWorker() {
  if (_ocrWorker) {
    await _ocrWorker.terminate();
    _ocrWorker = null;
  }
}

// 将PDF页面渲染为canvas，返回dataURL（兼容浏览器 DOM 与 Node.js 主进程）
// 对超大页面自动降低渲染倍率，避免内存与 OCR 耗时爆炸
async function renderPageToCanvas(page, scale = 2.0) {
  const viewport = page.getViewport({ scale: 1 });
  const pixelCount = viewport.width * viewport.height;
  // 若页面像素超过 300 万，降低倍率；超过 800 万进一步降低
  let actualScale = scale;
  if (pixelCount > 8_000_000) {
    actualScale = 0.8;
  } else if (pixelCount > 3_000_000) {
    actualScale = 1.2;
  }
  const renderViewport = page.getViewport({ scale: actualScale });
  const canvas = await createCanvas(renderViewport.width, renderViewport.height);
  const ctx = canvas.getContext('2d');
  const canvasFactory = new NodeCanvasFactory();
  await canvasFactory.init();
  try {
    await page.render({ canvasContext: ctx, viewport: renderViewport, canvasFactory }).promise;
  } finally {
    // 渲染后销毁canvasFactory，释放内部资源
    canvasFactory.destroy();
  }
  return canvas;
}

export { parsePDF, parseWord, parsePPTX, ocrImage, extractTextBlocksFromPage, mergePageContent, renderPageToCanvas, terminateOcrWorker };
