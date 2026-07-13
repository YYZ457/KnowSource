/** @module services/api/handlers/parse
 *  职责：POST /parse — 文档解析
 */
import path from 'path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { splitTextbook } from '../../../core/extractor/index.js';
import { parsePDF as parsePDFOCR, parsePPTX, ocrImage, terminateOcrWorker } from '../../../core/parser/index.js';
import { storage, getCurrentProjectId, writeRawBuffer, readRawBuffer, deleteRawFile, isProjectSwitching } from '../../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getResourceDir(name) {
  // 生产打包后 extraResources 会放在 resources/ 下；开发时回退到 node_modules
  const packed = process.resourcesPath
    ? path.join(process.resourcesPath, name)
    : '';
  if (packed && fs.existsSync(packed)) {
    return packed + '/';
  }
  return path.resolve(__dirname, `../../../node_modules/pdfjs-dist/${name}/`) + '/';
}

const PDFJS_CMAP_URL = getResourceDir('cmaps');
const PDFJS_STANDARD_FONT_URL = getResourceDir('standard_fonts');

// 为当前 PDF 解析任务创建取消/暂停控制器
function createTaskController(taskId) {
  const controller = new AbortController();
  // 监听外部任务状态，被取消时触发 abort
  const interval = setInterval(() => {
    if (storage.taskProgress.taskId === taskId && storage.taskProgress.status === 'cancelled') {
      controller.abort(storage.taskProgress.log || '已取消');
    }
  }, 150);
  // 暂停检查：页间可暂停，OCR 单页内部无法暂停
  const pauseCheck = async () => {
    while (storage.taskProgress.taskId === taskId && storage.taskProgress.status === 'paused') {
      await new Promise(resolve => setTimeout(resolve, 200));
      // 暂停期间也检查取消状态，避免暂停后被取消仍无法退出
      if (storage.taskProgress.taskId === taskId && storage.taskProgress.status === 'cancelled') {
        const err = new Error('解析已取消');
        err.code = 'CANCELLED';
        throw err;
      }
    }
  };
  const stopWatcher = () => clearInterval(interval);
  return { controller, pauseCheck, stopWatcher };
}

export function pauseParse() {
  storage.pauseTask();
  return { success: true, status: storage.taskProgress.status };
}

export function resumeParse() {
  storage.resumeTask();
  return { success: true, status: storage.taskProgress.status };
}

export function cancelParse() {
  storage.cancelTask();
  return { success: true, status: storage.taskProgress.status };
}

export function getDocuments() {
  // 对已存储的文档应用字体编码修复（一次性，修复后标记 _fontFixed）
  for (const doc of storage.documents.values()) {
    if (!doc._fontFixed && doc.rawText) {
      doc.rawText = fixPdfFontMojibake(doc.rawText);
      doc._fontFixed = true;
    }
  }
  return Array.from(storage.documents.values());
}

/**
 * 修复 PDF.js 文本提取中常见的 UTF-8 → Latin-1 误码（Mojibake）
 *
 * 当 PDF.js 从内嵌字体提取文本时，某些多字节 UTF-8 字符会被逐字节当作 Latin-1 字符返回。
 * 例如中文"第"的 UTF-8 编码是 E7 AC AC，被拆成三个 Latin-1 字符 ç ¬ ¬。
 * 间隔号"·"(U+00B7) 的 UTF-8 编码是 C2 B7，被拆成 Â ·。
 *
 * 策略：将字符串中 C1 控制字符和 Latin-1 补充字符（U+0080~U+00FF）按字节重新组合为 UTF-8。
 * 仅在检测到明显的 Mojibake 模式时触发，避免误伤合法的 Latin-1 文本。
 */
// PDFStringTranslateTable 反向映射表（与 fixBookmarkEncoding 共用）
// pdfjs-dist 在无 BOM 时使用此表解码 PDF 字符串，0x80-0xA0 范围与标准 Latin-1/Windows-1252 不同
const PDF_STRING_REVERSE_MAP = {
  0x2022: 0x80, 0x2020: 0x81, 0x2021: 0x82, 0x2026: 0x83, 0x2014: 0x84,
  0x2013: 0x85, 0x0192: 0x86, 0x2044: 0x87, 0x2039: 0x88, 0x203A: 0x89,
  0x2212: 0x8A, 0x2030: 0x8B, 0x201E: 0x8C, 0x201C: 0x8D, 0x201D: 0x8E,
  0x2018: 0x8F, 0x2019: 0x90, 0x201A: 0x91, 0x2122: 0x92, 0xFB01: 0x93,
  0xFB02: 0x94, 0x0141: 0x95, 0x0152: 0x96, 0x0160: 0x97, 0x0178: 0x98,
  0x017D: 0x99, 0x0131: 0x9A, 0x0142: 0x9B, 0x0153: 0x9C, 0x0161: 0x9D,
  0x017E: 0x9E, 0x20AC: 0xA0
};

function fixLatin1Mojibake(text) {
  if (!text || typeof text !== 'string') return text;

  // 快速检测：是否包含大量 U+0080~U+00FF 范围的字符
  // 正常英文论文几乎不包含这些字符；中文论文如果被误码则大量出现
  const highByteCount = (text.match(/[\u0080-\u00FF]/g) || []).length;
  if (highByteCount < 3) return text; // 少量可能是合法的 Latin-1 字符（如 é, ñ）

  // 如果文本已包含大量 CJK 字符，说明编码正确，无需修复
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjkCount > highByteCount * 0.5) return text;

  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) {
        bytes[i] = code;
      } else if (code <= 255) {
        // 0xA1-0xFF 范围：直接取字节值
        bytes[i] = code;
      } else if (PDF_STRING_REVERSE_MAP[code] != null) {
        // 0x80-0xA0 范围：使用反向映射表还原原始字节
        bytes[i] = PDF_STRING_REVERSE_MAP[code];
      } else {
        // 其他多字节字符（如已正确解码的中文/日文/特殊符号），取低字节
        bytes[i] = code & 0xFF;
      }
    }
    const fixed = Buffer.from(bytes).toString('utf8');

    // 验证：修复后的文本应该包含更少的替换字符（U+FFFD）和更少的 C1 控制字符
    const fixedHighByteCount = (fixed.match(/[\u0080-\u00FF\uFFFD]/g) || []).length;
    // 如果修复后高字节字符显著减少，则使用修复版本
    if (fixedHighByteCount < highByteCount * 0.5) {
      return fixed;
    }
    return text;
  } catch {
    return text;
  }
}

/**
 * 修复中文 PDF 字体编码问题（非 Latin-1 Mojibake）
 *
 * 部分中文 PDF 使用自定义字体编码，将常用标点/空格映射为不相关的汉字：
 *   - 空格 → "摇" (U+6447)，如 "北京摇 100124" 应为 "北京 100124"
 *   - 连字符 → "鄄" (U+9144)，如 "31鄄32" 应为 "31-32"
 *   - 句点 → "郾" (U+90FE)，如 "3郾 2" 应为 "3.2"
 *   - 乘号 → "伊" (U+4F0A)，如 "n伊 n" 应为 "n×n"
 *
 * 策略：通过频率检测判断是否为字体编码问题，然后进行字符替换。
 * 仅在检测到明显异常时触发，避免误伤合法使用这些汉字的文本。
 */
function fixPdfFontMojibake(text) {
  if (!text || typeof text !== 'string') return text;

  // 检测"摇"字符是否被用作空格（频率检测）
  // 正常中文文本中"摇"极少出现；如果出现 5 次以上，几乎可以确定是字体编码问题
  const yaoCount = (text.match(/摇/g) || []).length;
  const hasFontIssue = yaoCount >= 5;

  if (!hasFontIssue) {
    // 即使"摇"不频繁，仍检查"鄄"和"郾"是否出现在数字上下文中
    let result = text;
    result = result.replace(/(\d)鄄(\d)/g, '$1-$2');
    result = result.replace(/(\d)郾\s*/g, '$1.');
    return result;
  }

  let result = text;

  // 1. 替换"摇"为空格
  result = result.replace(/摇/g, ' ');

  // 2. 折叠中文字符之间的空格："北 京 工 业" → "北京工业"
  let prev;
  let iter = 0;
  do {
    prev = result;
    result = result.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
    iter++;
  } while (result !== prev && iter < 10);

  // 3. "鄄"在数字/英文之间 → 连字符
  result = result.replace(/(\d)鄄(\d)/g, '$1-$2');
  result = result.replace(/([a-zA-Z])鄄([a-zA-Z])/g, '$1-$2');

  // 4. "郾"在数字后 → 句点
  result = result.replace(/(\d)郾\s*/g, '$1.');

  // 5. "伊"在数字/变量之间 → 乘号
  result = result.replace(/(\d|[a-zA-Z])伊\s*(\d|[a-zA-Z])/g, '$1×$2');

  // 6. "冶" → 右引号 "（字体编码将右引号映射为"冶"）
  //    仅在词语后面出现时替换（避免误替换正常的"冶金"等词）
  result = result.replace(/([a-zA-Z\u4e00-\u9fa5\)\]])冶/g, '$1"');

  // 7. "啄" → δ（数学公式中的 delta）
  //    "啄"在深度学习论文中几乎不会作为正常汉字出现，可安全替换
  result = result.replace(/啄/g, 'δ');

  // 8. "忆" → 撇号 ′（数学公式中的导数符号，如 h忆(x) → h′(x)）
  //    需保护合法词汇"记忆"——先替换为占位符，再替换剩余"忆"，最后恢复
  result = result.replace(/记忆/g, '\x00MEM\x00');
  result = result.replace(/忆/g, "'");
  result = result.replace(/\x00MEM\x00/g, '记忆');

  // 9. 清理多余空格
  result = result.replace(/  +/g, ' ');
  result = result.replace(/\n /g, '\n');

  return result;
}

export function deleteDocument({ id } = {}) {
  if (isProjectSwitching()) {
    throw new Error('项目正在切换中，请稍后再试');
  }
  if (!id || !storage.documents.has(id)) {
    throw new Error('文档不存在: ' + id);
  }
  storage.documents.delete(id);

  // 删除磁盘上保存的原始文件（如果存在）
  deleteRawFile(id);

  // 只删除该文档对应的节点和边，保留其他文档及 Idea 节点
  if (storage.graph && storage.graph.nodes) {
    const nodesToRemove = new Set();
    for (const node of storage.graph.nodes) {
      // 匹配 document 节点本身、source.docId 或 meta.docId 为该文档的节点、
      // 以及以该 docId 为前缀的 heading/entity 节点（兼容旧格式）
      if (
        node.id === id ||
        node.source?.docId === id ||
        node.meta?.docId === id ||
        node.id.startsWith(`${id}_`) ||
        node.id.startsWith(`h_${id}_`)
      ) {
        nodesToRemove.add(node.id);
      }
    }

    storage.graph.nodes = storage.graph.nodes.filter(n => !nodesToRemove.has(n.id));
    storage.graph.edges = storage.graph.edges.filter(
      e => !nodesToRemove.has(e.from) && !nodesToRemove.has(e.to)
    );

    if (storage.graph.stats) {
      storage.graph.stats.nodeCount = storage.graph.nodes.length;
      storage.graph.stats.edgeCount = storage.graph.edges.length;
    }
  }

  return { success: true, id };
}

export async function parseHandler({ name, content, type } = {}) {
  if (isProjectSwitching()) {
    throw new Error('项目正在切换中，请稍后再试');
  }
  // 记录任务启动时的 projectId，写入前校验，避免切换项目后数据串写
  const startProjectId = getCurrentProjectId();

  // 生成 docId（使用 crypto.randomUUID 避免碰撞）
  const docId = 'doc-' + randomUUID().slice(0, 8);

  // 检测类型
  const docType = type || detectType(name);

  // 为所有文档类型重置任务进度，避免前端轮询读到上一次任务的残留进度
  // （非 PDF 文档原本不会重置 taskProgress，导致轮询竞态条件）
  const taskId = `parse:${docId}`;
  storage.resetTaskProgress(taskId);

  // 获取文本内容
  let text = content || '';
  // 临时保存原始二进制 base64，解析完成后写入 uploads 目录并从内存释放，
  // 文档对象中不再长期保留完整 base64
  let originalBase64 = '';

  // 对前端上传的 base64 内容进行统一解码。
  // PDF/Word/PPTX 在各自分支内处理二进制解码；其余类型（text/markdown/code 等）
  // 在此统一解码为 UTF-8 文本，避免 rawText/sections 中残留 base64 导致后续
  // 图谱构建、搜索、展示全部异常。
  //
  // 注意：仅当内容确实为 base64 编码时才解码。判断依据：
  //   1. 内容仅包含 base64 合法字符 [A-Za-z0-9+/=\s]
  //   2. 内容中不包含非 ASCII 字符（如中文），因为 base64 编码后的文本不会包含原始字符
  // 这样可以兼容直接传入纯文本的调用方（如 E2E 测试、API 直调）。
  if (docType !== 'pdf' && docType !== 'pdf-extracted' && docType !== 'docx' && docType !== 'pptx' && docType !== 'image') {
    const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(text) && !/[^\x00-\x7F]/.test(text) && text.trim().length > 0;
    if (looksLikeBase64) {
      try {
        originalBase64 = text;
        const decoded = Buffer.from(text, 'base64').toString('utf-8');
        if (decoded && decoded.length > 0) {
          text = decoded;
        }
      } catch (e) {
        console.warn(`[parse] 非二进制类型 "${name}" base64 解码失败，保留原始内容:`, e.message);
      }
    }
  }

  // PDF 解析：前端传 base64，后端解码后提取文本（按页保留边界）
  let totalPages = 0;
  let fontSizeStats = [];
  let isScanned = false;
  let bookmarks = [];
  if (docType === 'pdf') {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('PDF 内容为空，请确认文件已正确读取为 base64');
      }
      originalBase64 = text;

      let buffer = Buffer.from(text, 'base64');
      if (!buffer || buffer.length === 0) {
        throw new Error('base64 解码后为空');
      }

      // 初始化 PDF 解析任务状态，供前端轮询进度与控制
      // 注意：使用 pdfTaskId 而非 taskId，避免遮蔽外层 parse:${docId} 的 taskId 变量
      const pdfTaskId = `pdf-parse:${docId}`;
      storage.resetTaskProgress(pdfTaskId);
      const { controller, pauseCheck, stopWatcher } = createTaskController(pdfTaskId);

      try {
        const parsed = await parsePDFPages(buffer, { signal: controller.signal, pauseCheck, taskId: pdfTaskId });
        text = parsed.text;
        totalPages = parsed.totalPages;
        fontSizeStats = parsed.fontSizeStats || [];
        bookmarks = parsed.bookmarks || [];

        // 若文字层极少，尝试 OCR（扫描版/图片 PDF）
        // 阈值与 core/parser 对齐：平均每页 < 50 字符视为扫描版
        const effectiveText = text.trim();
        const textLenPerPage = totalPages > 0 ? effectiveText.length / totalPages : 0;
        // 检测重复内容模式：某些 PDF 字体编码不兼容时，pdfjs-dist 只能提取页眉/期刊名等
        // 重复内容，而非正文。此时字符数可能超过阈值，但内容高度重复。
        // 策略：去掉页码标记后，统计非空唯一行的数量；若唯一行数 < 页数的 1/2，视为提取失败
        const linesNoMarkers = effectiveText
          .replace(/^---\s*第\d+页\s*---$/gm, '')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0);
        const uniqueLines = new Set(linesNoMarkers);
        const isRepetitiveContent = totalPages > 2 && uniqueLines.size < totalPages * 0.5;
        if (effectiveText.length < 100 || textLenPerPage < 50 || isRepetitiveContent) {
          try {
            console.warn(`[parse] PDF "${name}" 文字层稀薄（${effectiveText.length} 字符 / ${totalPages} 页${isRepetitiveContent ? '，检测到重复内容' : ''}），尝试 OCR...`);
            // 进入 OCR 阶段时清空之前的文字层预览，避免旧标记残留
            storage.setTaskProgress({ taskId: pdfTaskId, stage: 'parse-ocr', percent: 15, log: '检测到扫描版/图片 PDF，正在进行 OCR 识别...', totalPages, previewText: '' });
            const fileLike = {
              name: name || 'document.pdf',
              size: buffer.length,
              arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
            };
            const ocrResult = await withTimeout(
              parsePDFOCR(fileLike, (p) => {
                storage.setTaskProgress({ taskId: pdfTaskId, ...p, totalPages: p.totalPages });
              }, { signal: controller.signal, pauseCheck, maxOcrPages: Infinity, knownScanned: true }),
              600000,
              'parsePDFOCR'
            );
            if (ocrResult && ocrResult.text && ocrResult.text.trim().length > effectiveText.length) {
              text = ocrResult.text;
              totalPages = ocrResult.totalPages || totalPages;
              isScanned = !!ocrResult.isScanned;
            }
            await terminateOcrWorker();
          } catch (ocrErr) {
            if (ocrErr.code === 'CANCELLED') throw ocrErr;
            console.warn(`[parse] PDF "${name}" OCR 失败:`, ocrErr.message);
            await terminateOcrWorker();
          }
        }

        if (!text.trim()) {
          console.warn(`[parse] PDF "${name}" 未提取到文字，可能是扫描版或图片 PDF`);
        }
      } finally {
        stopWatcher();
        // 释放 PDF buffer 引用，让 GC 回收大块内存
        buffer = null;
        // 取消或异常时强制清理 OCR worker，避免僵尸进程
        try { await terminateOcrWorker(); } catch (_) {}
      }

      // 修复 PDF.js 文本提取中常见的 UTF-8 → Latin-1 误码
      // 现象：中文字符"第1页"变成"ç¬¬1é¡µ"，间隔号"·"变成"â"
      // 原因：PDF.js 的 getTextContent 返回的字符串中某些字符的 UTF-8 字节
      //       被逐字节当作 Latin-1 字符处理，导致多字节字符拆散
      // 修复：检测是否为误码，将误码字节重新组合为正确的 UTF-8 字符
      text = fixLatin1Mojibake(text);
      // 修复中文 PDF 字体编码问题："摇"→空格, "鄄"→连字符, "郾"→句点
      text = fixPdfFontMojibake(text);
    } catch (e) {
      if (e.code === 'CANCELLED') {
        throw new Error('PDF 解析已取消');
      }
      throw new Error('PDF 解析失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // PDF OCR 解析结果：新界面已在浏览器端通过 core/parser 完成 OCR/文本层提取
  if (docType === 'pdf-extracted') {
    try {
      if (!content || typeof content !== 'object') {
        throw new Error('PDF 提取结果格式错误');
      }
      text = content.text || '';
      // 修复中文 PDF 字体编码问题
      text = fixPdfFontMojibake(text);
      originalBase64 = content.rawBase64 || '';
      totalPages = content.totalPages || 0;
      isScanned = !!content.isScanned;
      if (!text.trim()) {
        console.warn(`[parse] PDF "${name}" OCR 结果为空`);
      }
    } catch (e) {
      throw new Error('PDF OCR 结果处理失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // Word 解析：前端传 base64，后端解码后用 mammoth 提取文本和 HTML
  let rawHtml = '';
  if (docType === 'docx') {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('Word 内容为空，请确认文件已正确读取为 base64');
      }
      originalBase64 = text;

      const mammoth = await import('mammoth');
      let buffer = Buffer.from(text, 'base64');
      if (!buffer || buffer.length === 0) {
        throw new Error('base64 解码后为空');
      }

      storage.setTaskProgress({ taskId, stage: 'parse-text', percent: 10, log: '正在解析 Word 文档...', totalPages: 1 });

      // 两个 mammoth 调用都加超时保护，避免大文档卡死
      const [textResult, htmlResult] = await Promise.all([
        withTimeout(mammoth.extractRawText({ buffer }), 120000, 'mammoth.extractRawText'),
        withTimeout(mammoth.convertToHtml({ buffer }), 120000, 'mammoth.convertToHtml')
      ]);
      text = textResult.value || '';
      rawHtml = htmlResult.value || '';

      storage.setTaskProgress({ taskId, stage: 'parse-text', percent: 90, log: 'Word 文档解析完成', totalPages: 1 });

      // 当 mammoth 没有生成可用 HTML 时，用纯文本构造简洁 HTML 作为回退
      if (!rawHtml.trim() && text.trim()) {
        rawHtml = textToHtml(text);
      }

      // 释放 Word buffer 引用
      buffer = null;

      if (!text.trim()) {
        console.warn(`[parse] Word "${name}" 未提取到文字`);
      }
    } catch (e) {
      throw new Error('Word 解析失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // PPTX 解析：前端传 base64，后端解码后用 jszip 提取每页文字
  if (docType === 'pptx') {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('PPTX 内容为空，请确认文件已正确读取为 base64');
      }
      originalBase64 = text;

      let buffer = Buffer.from(text, 'base64');
      if (!buffer || buffer.length === 0) {
        throw new Error('base64 解码后为空');
      }

      const fileLike = {
        name: name || 'presentation.pptx',
        size: buffer.length,
        arrayBuffer: async () => buffer.slice().buffer
      };
      // 传递 onProgress 回调，将 parsePPTX 的 (current, total, log) 适配为 storage 进度
      const parsed = await parsePPTX(fileLike, (current, total, log) => {
        storage.setTaskProgress({
          taskId,
          stage: 'parse-text',
          percent: total > 0 ? Math.round((current / total) * 100) : 0,
          currentPage: current,
          totalPages: total,
          log: log || `正在解析第 ${current}/${total} 页...`
        });
      });
      text = parsed.text || '';
      totalPages = parsed.totalPages || 0;

      // 释放 PPTX buffer 引用
      buffer = null;

      if (!text.trim()) {
        console.warn(`[parse] PPTX "${name}" 未提取到文字`);
      }
    } catch (e) {
      throw new Error('PPTX 解析失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // 图片 OCR 解析：前端传 base64，后端解码后用 ocrImage 提取文本
  if (docType === 'image') {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('图片内容为空，请确认文件已正确读取为 base64');
      }
      originalBase64 = text;

      let buffer = Buffer.from(text, 'base64');
      if (!buffer || buffer.length === 0) {
        throw new Error('base64 解码后为空');
      }

      // 构造 data URL 字符串供 ocrImage 使用。
      // ocrImage 内部将输入直接传给 Tesseract.js 的 worker.recognize()，
      // 而 Tesseract.js v5 的 loadImage 在 Node 环境仅支持 string(URL/路径/data URL)
      // 和 Buffer，不识别含 arrayBuffer() 的普通对象（会导致 new Uint8Array(obj) 抛错）。
      // data URL 是跨环境最可靠的输入格式，与 parsePDF/mergePageContent 调用 ocrImage 的方式一致。
      const mimeType = getImageMimeType(name);
      const dataUrl = `data:${mimeType};base64,${text}`;

      storage.setTaskProgress({ taskId, stage: 'parse-ocr', percent: 10, log: '正在 OCR 识别图片...', totalPages: 1, previewText: '' });

      const ocrText = await ocrImage(dataUrl, (p) => {
        storage.setTaskProgress({ taskId, stage: 'parse-ocr', percent: 10 + Math.round(p * 80), log: `OCR 识别中 ${Math.round(p * 100)}%`, totalPages: 1, previewText: '' });
      });

      text = ocrText || '';
      totalPages = 1;
      isScanned = true;

      // 释放 buffer 引用
      buffer = null;

      try { await terminateOcrWorker(); } catch (_) {}

      if (!text.trim()) {
        console.warn(`[parse] 图片 "${name}" OCR 未提取到文字`);
      }
    } catch (e) {
      try { await terminateOcrWorker(); } catch (_) {}
      throw new Error('图片 OCR 解析失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // 切分章节
  const chapters = splitTextbook(text);

  // 将原始二进制持久化到 uploads 目录，文档对象只保留 filePath/fileSize
  let filePath = '';
  let fileSize = 0;
  if (originalBase64) {
    const sourceBuffer = Buffer.from(originalBase64, 'base64');
    const persisted = writeRawBuffer(docId, sourceBuffer);
    filePath = persisted.filePath;
    fileSize = persisted.fileSize;
    originalBase64 = '';
  }

  const doc = {
    docId,
    type: docType,
    name: name || 'untitled',
    sections: chapters.flatMap(ch => ch.sections || []),
    meta: {
      docId,
      type: docType,
      name: name || 'untitled',
      size: fileSize || text.length,
      totalPages,
      isScanned,
      parsedAt: Date.now()
    },
    rawText: text,
    rawHtml,
    filePath,
    fileSize,
    fontSizeStats,
    bookmarks
  };

  // 注册到共享存储
  // 文档对象不再保留完整 rawBase64，原始文件已写入 uploads 目录
  // 写入前校验当前 projectId 是否与任务启动时的 projectId 一致，避免切换项目后数据串写
  if (getCurrentProjectId() !== startProjectId) {
    // 项目已切换，清理已写入的原始文件
    if (filePath) deleteRawFile(docId);
    throw new Error('项目已切换，解析结果已丢弃');
  }
  storage.documents.set(docId, doc);

  // 解析任务结束，将任务进度重置为 idle，避免非 PDF 文档解析后 taskProgress 长期处于 running，
  // 导致项目切换、删除等操作被误拦截。
  storage.taskProgress = { taskId: null, status: 'idle', stage: '', percent: 0, log: '' };

  return doc;
}

function detectType(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pptx')) return 'pptx';
  if (n.endsWith('.doc')) {
    // mammoth 不支持老式 .doc 二进制格式，给出明确提示
    throw new Error('不支持老式 .doc 格式，请将文件另存为 .docx 后再导入');
  }
  if (n.endsWith('.ppt')) {
    throw new Error('不支持老式 .ppt 二进制格式，请将文件另存为 .pptx 后再导入');
  }
  if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif') || n.endsWith('.bmp') || n.endsWith('.webp')) return 'image';
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'markdown';
  if (n.endsWith('.js') || n.endsWith('.py') || n.endsWith('.ts')) return 'code';
  return 'text';
}

/**
 * 根据图片文件名推断 MIME 类型，用于构造 data URL 供 OCR 使用。
 * @param {string} name - 文件名
 * @returns {string} MIME 类型字符串
 */
function getImageMimeType(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.bmp')) return 'image/bmp';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/** 将纯文本包装为安全 HTML（Word HTML 不可用时回退） */
function textToHtml(text) {
  if (!text) return '';
  const paragraphs = text.split(/\n\s*\n+/).filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) return '';
  return paragraphs.map(p => {
    const escaped = p
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<p>${escaped}</p>`;
  }).join('');
}

/**
 * 为 Promise 添加超时保护，避免 getPage / getTextContent 等操作无限挂起。
 * @param {Promise} promise - 原始 Promise
 * @param {number} ms - 超时毫秒数
 * @param {string} label - 操作名称（用于错误信息）
 * @returns {Promise} 带超时保护的 Promise
 */
function withTimeout(promise, ms, label = '操作') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 使用 pdfjs-dist 按页提取文本，并按 y 坐标重排行结构。
 * 对每行记录最大字号，在疑似标题行前插入 [fsXX] 标记，供 headings.js 利用。
 * 同时提取 PDF 原生书签（outline），在每个书签对应页插入 [bookmark:Lx] 标记。
 * 返回 { text, totalPages, fontSizeStats, bookmarks }。
 */
async function parsePDFPages(buffer, options = {}) {
  const { signal, pauseCheck, taskId } = options;
  function checkSignal() {
    if (signal && signal.aborted) {
      const err = new Error(signal.reason || '解析已取消');
      err.code = 'CANCELLED';
      throw err;
    }
  }

  // 在 Node/Electron 主进程环境注入 @napi-rs/canvas 提供的 DOM API，
  // 避免 pdfjs-dist 自动尝试 require('canvas') 失败。
  try {
    const { DOMMatrix, Path2D } = await import('@napi-rs/canvas');
    if (typeof globalThis.DOMMatrix === 'undefined' && DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
    if (typeof globalThis.Path2D === 'undefined' && Path2D) globalThis.Path2D = Path2D;
  } catch (e) { /* 浏览器环境或 canvas 不可用时无需处理 */ }

  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.js')).default;

  const data = new Uint8Array(buffer);
  const pdf = await withTimeout(
    pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: false,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL
    }).promise,
    30000,
    'getDocument'
  );

  try {
  const totalPages = pdf.numPages;

  // 提取 PDF 原生书签（outline），递归遍历书签树
  const bookmarks = [];
  try {
    const outline = await pdf.getOutline();
    if (outline && outline.length > 0) {
      await collectBookmarks(outline, 0, bookmarks, pdf);
    }
  } catch (e) {
    // 书签提取失败不影响主流程
    console.warn('[parsePDFPages] 书签提取失败:', e && e.message ? e.message : String(e));
  }

  // 按页码聚合书签，便于在文本流中插入标记
  const bookmarksByPage = new Map();
  for (const bm of bookmarks) {
    if (!bookmarksByPage.has(bm.page)) bookmarksByPage.set(bm.page, []);
    bookmarksByPage.get(bm.page).push(bm);
  }

  let fullText = '';
  // 预览文本只保留最近若干页，避免逐页累积导致 O(n^2) 传输量：
  // 前端每 300ms 轮询一次进度，若每次都传输完整累积文本，500 页 PDF 总传输量约 250MB。
  // 总进度由下方 setTaskProgress 的 currentPage/totalPages 字段提供，预览仅用于展示。
  const PREVIEW_MAX_PAGES = 2;
  const PREVIEW_MAX_CHARS = 2000;
  const recentPageSections = [];
  const fontSizeStats = [];
  for (let i = 1; i <= totalPages; i++) {
    checkSignal();
    if (pauseCheck) await pauseCheck();
    const page = await withTimeout(pdf.getPage(i), 30000, `getPage(${i})`);
    const textContent = await withTimeout(page.getTextContent(), 30000, `getTextContent(${i})`);
    const lines = groupItemsIntoLines(textContent.items);
    const pageAvgHeight = computeAverageLineHeight(lines);

    let pageText = '';
    for (const line of lines) {
      const lineText = line.text.trim();
      if (!lineText) continue;
      // 当行高显著大于页面平均行高时，插入字号标记
      if (pageAvgHeight > 0 && line.maxHeight >= pageAvgHeight * 1.35) {
        const fontSize = Math.round(line.maxHeight * 10) / 10;
        pageText += `[fs${fontSize}] ${lineText}\n`;
        fontSizeStats.push({ page: i, size: fontSize, text: lineText });
      } else {
        pageText += `${lineText}\n`;
      }
    }

    // 在该页的书签位置插入 [bookmark:Lx] 标记
    const pageBookmarks = bookmarksByPage.get(i);
    if (pageBookmarks && pageBookmarks.length > 0) {
      const bookmarkMarks = pageBookmarks
        .map(bm => `[bookmark:L${bm.level + 1}] ${bm.title}`)
        .join('\n');
      pageText = `${bookmarkMarks}\n${pageText}`;
    }

    const pageSection = `\n--- 第${i}页 ---\n${pageText}\n`;
    fullText += pageSection;

    // 维护最近页的滑动窗口，生成有界预览文本，避免累积传输导致 O(n^2) 性能退化
    recentPageSections.push(pageSection);
    if (recentPageSections.length > PREVIEW_MAX_PAGES) {
      recentPageSections.shift();
    }
    let previewText = recentPageSections.join('');
    // 安全兜底：截断到固定长度，防止单页文本过长
    if (previewText.length > PREVIEW_MAX_CHARS) {
      previewText = previewText.slice(-PREVIEW_MAX_CHARS);
    }

    if (taskId) {
      storage.setTaskProgress({
        taskId,
        stage: 'parse-text',
        percent: Math.round((i / totalPages) * 15),
        currentPage: i,
        totalPages,
        previewText,
        log: `正在提取文字层... 第 ${i}/${totalPages} 页`
      });
    }
  }

  return { text: fullText, totalPages, fontSizeStats, bookmarks };
  } finally {
    // 销毁 PDF 文档对象，释放内存，避免 pdfjs 内部资源泄漏
    try { await pdf.destroy(); } catch (_) {}
  }
}

/**
 * 修复 PDF 书签标题的编码问题。
 * 根因：pdfjs-dist 的 stringToPDFString (pdf.worker.js:4352) 在无 BOM 时使用
 * PDFStringTranslateTable (pdf.worker.js:4351) 解码，该表与标准 Windows-1252
 * 在 0x80-0xA0 范围完全不同。例如字节 0x8B 被映射为 U+2030(‰) 而非
 * Windows-1252 的 0x89→‰。这导致 UTF-8 中文书签（如"课程复习"）中含 0x8B/0x8D/0xA0
 * 等字节时被错误解码为 ‰/"/€ 等字符。
 * 修复：使用 PDFStringTranslateTable 的精确反向映射表还原原始字节，再按 UTF-8 解码。
 */
function fixBookmarkEncoding(title) {
  if (!title) return '';
  // 使用模块级共享的 PDF_STRING_REVERSE_MAP（已在外部定义）
  try {
    // 快速检测：若无 >127 的字符，无需修复
    let needsFix = false;
    for (let i = 0; i < title.length; i++) {
      if (title.charCodeAt(i) > 127) { needsFix = true; break; }
    }
    if (!needsFix) return title;

    const bytes = new Uint8Array(title.length);
    for (let i = 0; i < title.length; i++) {
      const code = title.charCodeAt(i);
      if (code < 128) {
        bytes[i] = code;
      } else if (code <= 255) {
        // 0xA1-0xFF 范围：PDFStringTranslateTable 无映射，原样保留
        bytes[i] = code;
      } else if (PDF_STRING_REVERSE_MAP[code] != null) {
        // 0x80-0xA0 范围的特殊字符：还原为原始字节
        bytes[i] = PDF_STRING_REVERSE_MAP[code];
      } else {
        // 无法映射的字符（理论上中文书签不会出现），取低字节避免崩溃
        bytes[i] = code & 0xff;
      }
    }
    const decoded = new TextDecoder('utf-8').decode(bytes);
    // 如果解码后包含 CJK 字符，说明确实是 UTF-8 误编码
    if (/[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
    // 如果解码产生替换字符，说明不是 UTF-8，返回原始字符串
    if (decoded.includes('\uFFFD')) {
      return title;
    }
    return decoded;
  } catch (e) {
    return title;
  }
}

/**
 * 递归收集 PDF 书签，解析每个书签的目标页码。
 * @param {Array} items - pdf.getOutline() 返回的书签数组
 * @param {number} level - 当前层级（从 0 开始）
 * @param {Array} out - 输出数组，元素结构 { title, page, level }
 * @param {object} pdf - pdfjs 文档对象
 */
async function collectBookmarks(items, level, out, pdf) {
  for (const item of items) {
    try {
      const title = fixBookmarkEncoding((item.title || '').trim());
      if (!title) continue;

      let page = 0;
      const dest = item.dest;
      let resolvedDest = null;
      if (typeof dest === 'string') {
        // named destination
        resolvedDest = await pdf.getDestination(dest);
      } else if (Array.isArray(dest)) {
        // explicit destination
        resolvedDest = dest;
      }

      if (resolvedDest && resolvedDest.length > 0) {
        const pageRef = resolvedDest[0];
        if (pageRef) {
          try {
            const pageIndex = await pdf.getPageIndex(pageRef);
            page = pageIndex + 1; // 0-based 转 1-based
          } catch (e) {
            // 解析页码失败，跳过该书签的页码
          }
        }
      }

      out.push({ title, page, level });

      // 递归处理子书签
      if (item.items && item.items.length > 0) {
        await collectBookmarks(item.items, level + 1, out, pdf);
      }
    } catch (e) {
      // 单个书签解析失败，跳过，不影响其他书签
      continue;
    }
  }
}

function groupItemsIntoLines(items) {
  // 先按 (x, y, text) 去重，避免 PDF 中重复渲染同一字符
  const seen = new Set();
  const uniqueItems = [];
  for (const item of items) {
    if (!item.str) continue;
    const transform = item.transform || [0, 0, 0, 0, 0, 0];
    const x = transform[4];
    const y = transform[5];
    const key = `${x.toFixed(1)},${y.toFixed(1)},${item.str}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }

  // 计算 y 坐标中位间距，用于动态行聚合阈值（替代固定 2px 桶）
  const sortedYs = uniqueItems.map(item => {
    const t = item.transform || [0, 0, 0, 0, 0, 0];
    return t[5];
  }).sort((a, b) => b - a);
  let medianGap = 0;
  if (sortedYs.length >= 2) {
    const gaps = [];
    for (let i = 0; i < sortedYs.length - 1; i++) gaps.push(sortedYs[i] - sortedYs[i + 1]);
    gaps.sort((a, b) => a - b);
    medianGap = gaps[Math.floor(gaps.length / 2)] || 0;
  }
  const yTolerance = Math.max(2, medianGap * 0.4);

  // 按动态 yTolerance 聚合成行（y 从大到小，PDF 坐标系原点在左下角）
  const sortedItems = uniqueItems.map(item => {
    const t = item.transform || [0, 0, 0, 0, 0, 0];
    return { x: t[4], y: t[5], height: item.height || 0, text: item.str };
  }).sort((a, b) => b.y - a.y);

  const rows = [];
  for (const it of sortedItems) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= yTolerance) {
      last.items.push({ x: it.x, text: it.text, height: it.height });
    } else {
      rows.push({ y: it.y, items: [{ x: it.x, text: it.text, height: it.height }] });
    }
  }

  return rows.map(row => {
    // 按 x 排序，并合并位置非常接近且文本相同的相邻片段（去重冗余）
    row.items.sort((a, b) => a.x - b.x);
    const deduped = [];
    for (const it of row.items) {
      const last = deduped[deduped.length - 1];
      // PDF 重影：同一字符被绘制多次，位置略偏移但高度相同/相近
      if (last && it.text === last.text) {
        const charWidth = it.height * (isCJK(it.text) ? 1.0 : 0.5);
        if (Math.abs(it.x - last.x) < charWidth * 0.65) {
          continue;
        }
      }
      deduped.push(it);
    }
    const text = deduped.map(it => it.text).join('');
    const maxHeight = deduped.reduce((m, it) => Math.max(m, it.height), 0);
    return { text: collapseGhostDuplicates(text), maxHeight };
  });
}

function isCJK(text) {
  return /[\u4e00-\u9fa5\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/.test(text);
}

/**
 * 修复 PDF 重影导致的相邻字符重复，如 "条件件与与独立" -> "条件与独立"
 * 策略（迭代折叠，直到稳定）：
 *   1. 中文：把相邻重复对折叠为单字符；迭代处理，解决 4 次重影。
 *   2. 英文：如果连续重复的多字符英文词（≥3字母）出现 ≥2 处，则折叠（如 "IntroIntro" -> "Intro"）。
 *      仅处理整词级重影，不处理单词内合法双字母（如 "book" 的 "oo"）。
 *   3. CJK 整词/短语重影（如 "概率模型概率模型"）。
 */
function collapseGhostDuplicates(str) {
  if (!str || str.length < 4) return str;

  // 迭代上限，避免极端输入导致无限循环
  const MAX_ITERATIONS = 5;

  // === 中文相邻字符重影（迭代）===
  let result = str;
  let changed = true;
  let iter = 0;
  while (changed && iter < MAX_ITERATIONS) {
    changed = false;
    iter++;
    let r = '';
    let i = 0;
    while (i < result.length) {
      const c = result[i];
      if (i < result.length - 1 && c === result[i + 1] && /[\u4e00-\u9fa5]/.test(c)) {
        r += c;
        i += 2;
        changed = true;
      } else {
        r += c;
        i++;
      }
    }
    result = r;
  }

  // === 英文整词重影（迭代）===
  let prev;
  iter = 0;
  do {
    prev = result;
    result = result.replace(/([a-zA-Z]{3,})\1/g, '$1');
    iter++;
  } while (result !== prev && iter < MAX_ITERATIONS);

  // === CJK 整词/短语重影（迭代）===
  iter = 0;
  do {
    prev = result;
    result = result.replace(/([\u4e00-\u9fa5]{2,})\1+/g, '$1');
    iter++;
  } while (result !== prev && iter < MAX_ITERATIONS);

  return result;
}

function computeAverageLineHeight(lines) {
  const heights = lines.map(l => l.maxHeight).filter(h => h > 0);
  if (heights.length === 0) return 0;
  // 用中位数更鲁棒，避免标题行拉高均值
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  return median;
}

/**
 * 按 docId 获取 PDF 原始字节，供前端通过 HTTP 直接渲染。
 * @param {{id: string}} param
 * @returns {{buffer: Buffer, name: string}}
 */
export function serveDocumentPdf({ id } = {}) {
  if (!id || !storage.documents.has(id)) {
    throw new Error('文档不存在: ' + id);
  }
  const doc = storage.documents.get(id);
  if (doc.type !== 'pdf' && doc.type !== 'pdf-extracted') {
    throw new Error('文档不是 PDF: ' + id);
  }
  let buffer = null;
  // 优先从 uploads 目录读取原始二进制
  if (doc.filePath) {
    buffer = readRawBuffer(id);
  }
  // 兼容旧版数据：若未写入磁盘但内存/JSON 中仍有 rawBase64
  if (!buffer && doc.rawBase64) {
    buffer = Buffer.from(doc.rawBase64, 'base64');
  }
  if (!buffer || buffer.length === 0) {
    throw new Error('PDF 原始数据缺失: ' + id);
  }
  return { buffer, name: doc.name || 'document.pdf' };
}
