/**
 * @file test-build-pdf.js
 * @description 端到端测试：解析 PDF → 运行 pipeline → 构建知识图谱
 *   验证整合后的 llm-extractor + heading-split + 多轮规范化在项目本体中正常工作。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { parseHandler } from '../services/api/handlers/parse.js';
import { graphBuildHandler } from '../services/api/handlers/graph-build.js';
import { setKGProvider, createLLMProvider } from '../services/llm-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_PATH = process.argv[2] || path.join(process.env.USERPROFILE || '/tmp', 'Desktop', 'PSSnotesP3t.pdf');
const MODEL = process.argv[3] || 'qwen2.5:1.5b';

async function main() {
  console.log(`[test-build-pdf] PDF: ${PDF_PATH}`);
  console.log(`[test-build-pdf] Model: ${MODEL}`);

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF 不存在: ${PDF_PATH}`);
    process.exit(1);
  }

  // 设置 KG Provider
  const provider = createLLMProvider('ollama', {
    model: MODEL,
    baseUrl: 'http://127.0.0.1:11434'
  });
  setKGProvider(provider);

  // 1. 解析 PDF
  const base64 = fs.readFileSync(PDF_PATH).toString('base64');
  const name = path.basename(PDF_PATH);
  console.log('[test-build-pdf] 正在解析 PDF...');
  const doc = await parseHandler({ name, content: base64, type: 'pdf' });
  console.log(`[test-build-pdf] 解析完成: ${doc.meta.totalPages} 页, ${doc.rawText.length} 字符, fontSizeStats: ${doc.fontSizeStats?.length || 0}`);

  // 2. 构建图谱
  console.log('[test-build-pdf] 正在构建知识图谱...');
  const result = await graphBuildHandler({
    documents: [{
      docId: doc.docId,
      name: doc.name,
      content: doc.rawText,
      type: doc.type
    }],
    options: {
      extractOptions: {
        splitMode: 'heading',
        maxTerms: 80,
        maxTermsPerChunk: 20,
        enableGlobalNormalize: true
      }
    }
  });

  console.log('\n===== 构建结果 =====');
  console.log(`节点数: ${result.nodes.length}`);
  console.log(`边数: ${result.edges.length}`);
  console.log(`合并数: ${result.stats.mergedCount}`);
  console.log(`跨文档连接: ${result.stats.crossLinks}`);

  // 3. 找出 entity 类型的节点
  const entityNodes = result.nodes.filter(n => n.type === 'entity');
  console.log(`\n实体节点 (${entityNodes.length} 个):`);
  entityNodes.slice(0, 30).forEach(n => console.log(`  - ${n.content} (weight=${n.weight})`));
  if (entityNodes.length > 30) console.log(`  ... 还有 ${entityNodes.length - 30} 个`);

  // 4. 保存结果
  const outDir = path.join(path.resolve(__dirname, '..'), 'debug-output-build');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'nodes.json'), JSON.stringify(result.nodes, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'edges.json'), JSON.stringify(result.edges, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(result.stats, null, 2), 'utf-8');
  console.log(`\n结果已保存到: ${outDir}`);
}

main().catch(e => {
  console.error('[test-build-pdf] 失败:', e);
  process.exit(1);
});
