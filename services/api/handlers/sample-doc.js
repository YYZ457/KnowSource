/**
 * @module services/api/handlers/sample-doc
 * 职责：POST /documents/import-sample — 导入内置示例文档
 * 用于新手引导时自动加载经典论文，无需用户手动上传
 */
import path from 'path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { parseHandler } from './parse.js';
import { storage } from '../../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 内置示例文档列表 — 3篇经典中文综述论文，体现跨文档知识网络 */
const SAMPLE_DOCS = [
  {
    file: '深度学习研究综述.pdf',
    name: '深度学习研究综述（尹宝才）.pdf',
    type: 'pdf'
  },
  {
    file: '卷积神经网络研究综述.pdf',
    name: '卷积神经网络研究综述（李彦冬）.pdf',
    type: 'pdf'
  },
  {
    file: '视觉注意力机制综述.pdf',
    name: '视觉注意力机制综述（王文冠）.pdf',
    type: 'pdf'
  }
];

/**
 * 查找 sample_docs 目录
 * 开发环境: 项目根目录/sample_docs
 * 打包环境: resources/sample_docs (electron-builder extraResources)
 */
function getSampleDocsDir() {
  // 打包环境
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'sample_docs');
    if (fs.existsSync(packed)) return packed;
  }
  // 开发环境 — 从 handlers 目录回溯到项目根
  return path.resolve(__dirname, '../../../sample_docs');
}

/**
 * 检查示例文档是否已导入（按文件名匹配）
 */
function isSampleAlreadyImported(docName) {
  try {
    const docs = Array.from(storage.documents.values());
    return docs.some(d => d.name === docName);
  } catch {
    return false;
  }
}

/**
 * 导入示例文档
 * 不指定 name 时导入全部示例文档，指定 name 时只导入匹配的文档
 * 读取 PDF 文件 → base64 编码 → 调用 parseHandler 解析
 */
export async function importSampleDoc({ name } = {}) {
  const sampleDir = getSampleDocsDir();
  const targets = name
    ? SAMPLE_DOCS.filter(s => s.name === name)
    : SAMPLE_DOCS;

  if (targets.length === 0) {
    throw new Error(`未找到匹配的示例文档: ${name}`);
  }

  const results = [];
  for (const target of targets) {
    const filePath = path.join(sampleDir, target.file);

    if (!fs.existsSync(filePath)) {
      console.warn(`[sample-doc] 示例文档不存在: ${target.file}`);
      continue;
    }

    // 如果已导入则跳过
    if (isSampleAlreadyImported(target.name)) {
      results.push({ success: true, name: target.name, skipped: true });
      continue;
    }

    // 读取文件并 base64 编码
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    // 调用 parseHandler 解析文档
    try {
      const result = await parseHandler({
        name: target.name,
        content: base64,
        type: target.type
      });
      results.push({ success: true, name: target.name, doc: result });
    } catch (e) {
      console.error(`[sample-doc] 导入失败 ${target.name}:`, e.message);
      results.push({ success: false, name: target.name, error: e.message });
    }
  }

  const imported = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  return {
    success: true,
    message: `导入完成: ${imported} 篇新文档, ${skipped} 篇已存在`,
    docs: results,
    doc: results[0]?.doc || null
  };
}
