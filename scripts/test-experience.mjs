// G1 体验测试：用桌面 PDF 文件测试后端 API 完整流程
import fs from 'fs';
import http from 'http';

const PDF_FILES = [
  { name: 'PSSnotesP3t.pdf', path: 'C:\\Users\\YANYZ\\Desktop\\PSSnotesP3t.pdf' },
  { name: '2026springPSS_final.pdf', path: 'C:\\Users\\YANYZ\\Desktop\\2026springPSS_final.pdf' }
];

const BASE_URL = 'http://127.0.0.1:8000';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 8000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, data: text });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== G1 体验测试开始 ===\n');

  // 1. 解析两个 PDF 文件
  const docIds = [];
  for (const pdf of PDF_FILES) {
    console.log(`\n[1] 解析 PDF: ${pdf.name}`);
    const buf = fs.readFileSync(pdf.path);
    const base64 = buf.toString('base64');
    console.log(`    文件大小: ${(buf.length / 1024 / 1024).toFixed(2)} MB, base64 长度: ${base64.length}`);

    const res = await request('POST', '/parse', { name: pdf.name, content: base64, type: 'pdf' });
    console.log(`    响应状态: ${res.status}`);

    if (res.status !== 200) {
      console.error(`    解析失败:`, typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500));
      continue;
    }

    const doc = res.data;
    console.log(`    文档ID: ${doc.docId}`);
    console.log(`    总页数: ${doc.meta ? doc.meta.totalPages : 'N/A'}`);
    console.log(`    文本长度: ${doc.rawText ? doc.rawText.length : 0} 字符`);
    console.log(`    书签数量: ${doc.bookmarks ? doc.bookmarks.length : 0}`);
    if (doc.bookmarks && doc.bookmarks.length > 0) {
      console.log(`    前5个书签:`);
      doc.bookmarks.slice(0, 5).forEach((b, i) => {
        console.log(`      ${i + 1}. [L${b.level}] ${b.title} (页 ${b.page})`);
      });
    }
    console.log(`    文本前200字: ${(doc.rawText || '').slice(0, 200)}`);
    docIds.push(doc.docId);
  }

  // 2. 提取标题
  for (const docId of docIds) {
    console.log(`\n[2] 提取关键词: ${docId}`);
    const res = await request('POST', '/extract', { docId });
    console.log(`    响应状态: ${res.status}`);
    if (res.status === 200) {
      const entities = res.data.entities || [];
      console.log(`    关键词数量: ${entities.length}`);
      console.log(`    使用LLM: ${res.data.usedLLM}`);
      console.log(`    前10个关键词:`);
      entities.slice(0, 10).forEach((e, i) => {
        console.log(`      ${i + 1}. ${e.term} (score: ${e.score}, source: ${e.source})`);
      });
    } else {
      console.error(`    提取失败:`, typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300));
    }
  }

  // 3. 构建图谱（不传 documents，从 storage 获取）
  if (docIds.length > 0) {
    console.log(`\n[3] 构建知识图谱`);
    const res = await request('POST', '/graph/build', {});
    console.log(`    响应状态: ${res.status}`);
    if (res.status === 200) {
      const graph = res.data;
      console.log(`    节点数量: ${graph.nodes ? graph.nodes.length : 'N/A'}`);
      console.log(`    边数量: ${graph.edges ? graph.edges.length : 'N/A'}`);
      if (graph.nodes) {
        console.log(`    前5个节点:`);
        graph.nodes.slice(0, 5).forEach((n, i) => {
          console.log(`      ${i + 1}. ${n.content || n.label || n.id} (类型: ${n.type || '?'})`);
        });
      }
      if (graph.error) {
        console.error(`    构建错误: ${graph.error}`);
      }
    } else {
      console.error(`    构建失败:`, typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300));
    }
  }

  // 4. 搜索
  console.log(`\n[4] 搜索测试`);
  const searchRes = await request('POST', '/search', { keyword: '概率' });
  console.log(`    响应状态: ${searchRes.status}`);
  if (searchRes.status === 200) {
    const results = searchRes.data.results || [];
    console.log(`    搜索结果数量: ${results.length}`);
    results.slice(0, 3).forEach((r, i) => {
      console.log(`      ${i + 1}. [文档 ${r.docId || r.docName}] 页 ${r.page}: ${r.snippet ? r.snippet.slice(0, 80) : JSON.stringify(r).slice(0, 80)}`);
    });
  } else {
    console.error(`    搜索失败:`, typeof searchRes.data === 'string' ? searchRes.data.slice(0, 300) : JSON.stringify(searchRes.data).slice(0, 300));
  }

  // 5. 查询图谱（需要 action=stats 参数才能返回完整图谱）
  console.log(`\n[5] 查询图谱`);
  const queryRes = await request('GET', '/graph/query?action=stats');
  console.log(`    响应状态: ${queryRes.status}`);
  if (queryRes.status === 200) {
    const graph = queryRes.data;
    console.log(`    节点数量: ${graph.nodes ? graph.nodes.length : 'N/A'}`);
    console.log(`    边数量: ${graph.edges ? graph.edges.length : 'N/A'}`);
  }

  console.log('\n=== G1 体验测试完成 ===');
}

main().catch((e) => {
  console.error('测试出错:', e);
  process.exit(1);
});
