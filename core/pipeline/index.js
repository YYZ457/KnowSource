// ============================================================
// @module core/pipeline
// 职责：完整文档处理流程编排（导入→解析→抽取→建图）
// 依赖：core/parser, core/extractor, core/matcher, core/graph
//       浏览器全局（typeof guard 访问）：KGEngine (kg-engine.js)
// 依赖方向：只能被上层（core/services / UI）调用，不可反向依赖
// 公开 API: runPipeline
// ============================================================

import { randomUUID } from 'node:crypto';
import { splitTextbook, extractKeywords } from '../extractor/index.js';
import { extractHeadings, flattenHeadings } from '../extractor/headings.js';
import { extractHeadingsWithLLM } from '../extractor/llm-headings.js';
import { generateKnowledgeGraph } from '../graph/builder.js';
import { buildKnowledgeGraph } from '../graph/unsupervised.js';
import { extractKeyTerms, scoreTermSpecificityWithLLM, validateExtractedNodesAndEdges } from '../graph/llm-extractor.js';
import { buildCrossLinks, buildCrossLinksLLM } from '../graph/crosslink.js';
import { KnowledgeGraph } from '../graph/graph.js';
import { extractFullGraphFromDocument, canUseFullExtract, convertToGraph } from '../graph/full-extract.js';

// ============ 并发控制辅助 ============
/**
 * 限制并发数的 Promise.all 变体
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item:T, index:number)=>Promise<any>} fn
 * @returns {Promise<any[]>}
 */
async function runWithConcurrency(items, concurrency, fn) {
  if (concurrency <= 0) concurrency = 1;
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await fn(items[current], current);
      } catch (e) {
        results[current] = { error: e };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ============================================================
// 多文档统一处理管线
// 流程：import → parse → extract → buildGraph → crossLink → queryable
// ============================================================

/**
 * 从层级标题树中根据文本偏移找到最匹配的标题
 * @param {Array<{start:number,end:number,title:string,children?:Array}>} headings
 * @param {number} offset
 * @returns {{title:string,level:number}|null}
 */
function findHeadingForOffset(headings, offset) {
  if (!headings || headings.length === 0) return null;
  for (const h of headings) {
    if (offset >= (h.start || 0) && offset < (h.end || Infinity)) {
      if (h.children && h.children.length > 0) {
        const child = findHeadingForOffset(h.children, offset);
        if (child) return child;
      }
      return { title: h.title || '', level: h.level || 1 };
    }
  }
  return null;
}

/**
 * 将扁平的标题列表按 level 重建为树形结构（父子嵌套）
 * 提取为模块级函数，避免在循环内部重复创建函数对象
 * @param {Array<{level?:number}>} flat - 扁平标题列表
 * @returns {Array} 根节点数组，每个节点含 children 数组
 */
function buildHeadingTree(flat) {
  const roots = [];
  const stack = [];
  for (const h of flat) {
    const item = { ...h, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1].level || 99) >= (item.level || 99)) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    stack.push(item);
  }
  return roots;
}

/**
 * 多文档统一处理管线
 * 流程：import → parse → extract → buildGraph → crossLink → queryable
 * @param {File[]|{name:string, content:string, type?:string}[]} files — 文件列表
 * @param {{onProgress?:function, useAI?:boolean, extractOptions?:object}} options — 选项
 * @returns {Promise<{documents:import('../types.js').Document[], entities:import('../types.js').Entity[], graph:{nodes:import('../types.js').GraphNode[], edges:import('../types.js').GraphEdge[]}}>}
 */
async function runPipeline(files, options = {}) {
  const { onProgress, provider } = options;
  const documents = [];
  const entities = [];
  // 收集跨文档关联失败信息，供上层（graphBuildHandler）向用户报告
  const crossLinkErrors = [];

  // 阶段 1: import + parse（逐文件解析）
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ stage: 'parse', percent: (i / files.length) * 30, log: `解析 ${file.name}...` });

    const docMeta = {
      docId: file.docId || generateDocId(),
      type: detectType(file),
      name: file.name,
      path: file.path || file.name,
      size: file.size || (file.content ? file.content.length : 0),
      mtime: file.lastModified || Date.now(),
      parsedAt: Date.now()
    };

    // 调用 parser（如果是 File/Blob 对象走 PDF/Word 解析，否则按纯文本处理）
    let parsed;
    const isFileObject = (typeof File !== 'undefined' && file instanceof File) ||
                         (file && typeof file.arrayBuffer === 'function');
    if (isFileObject) {
      parsed = await parseFileByType(file, docMeta.type);
    } else {
      // 纯文本/Markdown/代码：直接用 content
      parsed = { text: file.content || '', images: [], totalPages: 1 };
    }

    // 切分章节（splitTextbook 返回 chapters，每个 chapter 含 sections 数组）
    const chapters = splitTextbook(parsed.text, { fontSizeStats: file.fontSizeStats });
    // 扁平化为 Section[] 以符合 Document 类型契约
    const sections = chapters.flatMap(ch => ch.sections || []);
    if (parsed.totalPages) docMeta.totalPages = parsed.totalPages;

    documents.push({ meta: docMeta, sections, rawText: parsed.text, images: parsed.images, fontSizeStats: file.fontSizeStats || [], bookmarks: file.bookmarks || [] });
  }

  // 阶段 2: extract（抽取实体/关键词）
  onProgress?.({ stage: 'extract', percent: 40, log: '抽取实体与关键词...' });
  for (const doc of documents) {
    for (const section of doc.sections) {
      const keywords = extractKeywords(section.content, 10);
      section.keywords = keywords;
      for (const kw of keywords) {
        entities.push({
          term: kw.word,
          score: kw.count,
          source: 'tfidf',
          docId: doc.meta.docId,
          sectionId: section.id
        });
      }
    }
  }

  // 阶段 3: buildGraph（构建图谱）
  onProgress?.({ stage: 'buildGraph', percent: 45, log: '构建知识图谱...' });
  let graphNodes = [];
  let graphEdges = [];
  if (documents.length > 0) {
    // 判断是否可以使用云端 LLM 全文一次性抽取
    const extractOpts = options.extractOptions || { maxTerms: 80 };
    const fullExtractOpts = {
      maxTerms: extractOpts.maxTerms || 40,
      maxHeadings: extractOpts.maxHeadings || 30,
      specificityThreshold: extractOpts.specificityThreshold ?? 4,
      // 默认给 5 分钟超时、200k 字符上下文；用户可覆盖
      timeoutMs: extractOpts.fullExtractTimeoutMs ?? 300000,
      maxContextChars: extractOpts.fullExtractMaxContextChars ?? 200000
    };
    // 只有用户启用了全文直出，且 provider 是云端强模型、文本长度在限制内时才使用
    const fullExtractEnabled = extractOpts.fullExtractEnabled !== false;

    // 按文档自适应选择路径：不再要求所有文档都满足全文抽取条件
    const docRoutes = documents.map(doc => ({
      doc,
      useFullExtract: fullExtractEnabled && canUseFullExtract(provider, (doc.rawText || '').length, fullExtractOpts)
    }));

    // 逐文档提取标题（各文档独立，避免 id/层级冲突）
    const allHeadings = [];
    const headingsByDoc = new Map();
    const seenNodeIds = new Set();

    // ============================================================
    // 路径 A：云端 LLM 全文一次性抽取（标题+实体+关系+特异性）
    // 一次调用替代 4+ 次分步调用，LLM 看到全文上下文，结果更准确
    // 多个文档之间并发执行，限制并发数避免打爆 provider
    // ============================================================
    const fullExtractDocs = docRoutes.filter(r => r.useFullExtract);
    if (fullExtractDocs.length > 0) {
      onProgress?.({ stage: 'fullExtract', percent: 48, log: `云端全文抽取 ${fullExtractDocs.length} 个文档...` });
      const concurrency = Math.min(3, fullExtractDocs.length);
      const results = await runWithConcurrency(fullExtractDocs, concurrency, async ({ doc }, idx) => {
        const docText = doc.rawText || '';
        onProgress?.({ stage: 'fullExtract', percent: 48 + Math.floor((idx / fullExtractDocs.length) * 12), log: `云端全文抽取 ${doc.meta.name} (${idx + 1}/${fullExtractDocs.length})...` });

        try {
          const extracted = await extractFullGraphFromDocument(docText, provider, fullExtractOpts);

          const { nodes, edges } = convertToGraph(extracted, doc.meta.docId, doc.meta.name);

          // ★ 校验 LLM 抽取出的节点/边，过滤残缺/悬空数据
          const validation = validateExtractedNodesAndEdges(nodes, edges, doc.meta.docId);
          if (validation.validNodes.length === 0) {
            throw new Error(`全文抽取结果校验后无有效节点：${validation.errors.join('; ')}`);
          }

          // 构建 headingsByDoc（用于后续 document→heading 连接）
          const docHeadings = extracted.headings.map((h, i) => ({
            id: `${doc.meta.docId}_${i}`,
            title: h.title,
            level: h.level,
            page: 1,
            start: h.start,
            end: h.start + h.title.length,
            source: { docId: doc.meta.docId, page: 1, start: h.start, end: h.start + h.title.length }
          }));

          return { doc, nodes: validation.validNodes, edges: validation.validEdges, headings: docHeadings, error: null };
        } catch (e) {
          if (e.code === 'TASK_DISABLED') {
            console.warn(`[pipeline] 文档 ${doc.meta.name} 全文抽取任务已被禁用，回退分步管线:`, e.message);
          } else {
            console.warn(`[pipeline] 文档 ${doc.meta.name} 全文抽取失败，将回退分步管线:`, e.message);
          }
          return { doc, error: e };
        }
      });

      for (const result of results) {
        if (result.error) {
          // 失败的文档回退到分步管线
          // 确保 result.doc 存在（runWithConcurrency 异常时可能只有 error 字段）
          if (!result.doc) {
            console.error('[pipeline] fullExtract 返回无 doc 的错误:', result.error);
            continue; // 无法回退，跳过（不应发生）
          }
          const route = docRoutes.find(r => r.doc === result.doc);
          if (route) {
            route.useFullExtract = false;
            console.warn(`[pipeline] 文档 ${result.doc?.meta?.name || '未知'} 回退到分步管线`);
          }
          continue;
        }
        const { doc, nodes, edges, headings } = result;
        for (const h of headings) {
          allHeadings.push(h);
        }
        headingsByDoc.set(doc.meta.docId, headings);

        // 合并子图谱
        for (const node of nodes) {
          if (seenNodeIds.has(node.id)) continue;
          seenNodeIds.add(node.id);
          const mergedSource = node.source || { docId: doc.meta.docId };
          if (mergedSource.docId === undefined) mergedSource.docId = doc.meta.docId;
          graphNodes.push({
            id: node.id,
            type: node.type || 'entity',
            content: node.content || node.label || node.keyword || String(node.id),
            weight: typeof node.weight === 'number' ? node.weight : 1,
            source: mergedSource,
            meta: {
              ...(node.meta || {}),
              keyword: node.keyword,
              level: node.level,
              start: node.start,
              page: node.page
            }
          });
        }
        for (const edge of edges) {
          graphEdges.push({
            from: edge.from,
            to: edge.to,
            type: edge.type || 'related',
            weight: typeof edge.weight === 'number' ? edge.weight : 1,
            source: edge.source || 'full-extract',
            evidence: edge.evidence || edge.source || ''
          });
        }
      }
    }

    // ============================================================
    // 路径 B：分步管线（本地模型、文本过长、全文抽取失败时使用）
    // 标题检测 → 术语抽取 → 无监督建图 → 特异性评分
    // ============================================================
    const stepwiseDocs = docRoutes.filter(r => !r.useFullExtract);
    if (stepwiseDocs.length > 0) {
      onProgress?.({ stage: 'buildGraph', percent: 60, log: `分步管线处理 ${stepwiseDocs.length} 个文档...` });

      for (const { doc } of stepwiseDocs) {
        const docText = doc.rawText || '';
        let docHeadings;
        try {
          docHeadings = (provider && provider.name !== 'stub')
            ? await extractHeadingsWithLLM(docText, provider, { fontSizeStats: doc.fontSizeStats })
            : extractHeadings(docText, { fontSizeStats: doc.fontSizeStats });
        } catch (e) {
          console.warn(`[runPipeline] 文档 ${doc.meta.docId} 标题提取失败，回退规则:`, e.message);
          docHeadings = extractHeadings(docText, { fontSizeStats: doc.fontSizeStats });
        }

        // 如果 PDF 有 bookmarks 且规则提取的标题太少（<3），使用 bookmarks 作为标题来源
        // bookmarks 是 PDF 内嵌的目录结构，对学术论文非常准确
        console.log(`[runPipeline] doc=${doc.meta.docId} bookmarks=${doc.bookmarks?.length || 0} docHeadings=${docHeadings.length}`);
        if (doc.bookmarks && doc.bookmarks.length > 0 && docHeadings.length < 3) {
          console.log(`[runPipeline] 文档 ${doc.meta.docId} 规则提取 ${docHeadings.length} 个标题，使用 PDF bookmarks (${doc.bookmarks.length} 个)`);
          docHeadings = doc.bookmarks.map((bm, idx) => ({
            id: `h_${idx}`,
            title: bm.title || '',
            level: bm.level || 1,
            page: bm.page || (idx + 1),
            start: 0,
            end: 0
          }));
        }

        const docIdPrefix = doc.meta.docId;
        const flat = flattenHeadings(docHeadings);
        // 统一heading节点id格式：${docId}_${index}，与full-extract路径一致
        flat.forEach((h, idx) => {
          allHeadings.push({
            ...h,
            id: `${docIdPrefix}_${idx}`,
            source: { docId: doc.meta.docId, page: h.page || 0, start: h.start || 0, end: h.end || 0 },
          });
        });
        headingsByDoc.set(doc.meta.docId, allHeadings.filter(h => h.source.docId === doc.meta.docId));
      }

      try {
        onProgress?.({ stage: 'extractTerms', percent: 60, log: '抽取关键术语...' });

        // 逐个文档构建子图谱，确保每个文档拥有自己的实体节点
        const perDocGraphs = [];
        for (let di = 0; di < stepwiseDocs.length; di++) {
          const { doc } = stepwiseDocs[di];
          try {
          onProgress?.({ stage: 'extractTerms', percent: 60 + Math.floor((di / stepwiseDocs.length) * 12), log: `抽取 ${doc.meta.name} 关键术语...` });
          const docSeedTerms = await extractKeyTerms(doc.rawText || '', {
            ...extractOpts,
            provider,
            fontSizeStats: doc.fontSizeStats || [],
            onProgress: (p) => {
              onProgress?.({
                stage: 'extractTerms',
                percent: 60 + Math.floor(((di + (p.percent || 0) / 100) / stepwiseDocs.length) * 12),
                log: `${doc.meta.name}: ${p.log || ''}`,
                chunkIndex: p.chunkIndex || 0,
                chunkCount: p.chunkCount || 0
              });
            }
          });

          onProgress?.({ stage: 'buildGraph', percent: 72 + Math.floor((di / stepwiseDocs.length) * 8), log: `构建 ${doc.meta.name} 知识图谱...` });
          const docHeadingsTree = [];
          // 恢复原始 heading 树结构（带 docId 前缀）
          const rawHeadings = [];
          for (const h of allHeadings) {
            if (h.source.docId === doc.meta.docId) {
              rawHeadings.push({
                id: h.id,
                title: h.title,
                level: h.level,
                page: h.page,
                start: h.start,
                end: h.end,
                source: h.source
              });
            }
          }
          // 简单按 level 重建父子关系（buildHeadingTree 已提取为模块级函数）
          docHeadingsTree.push(...buildHeadingTree(rawHeadings));

          const kg = await buildKnowledgeGraph(doc.rawText || '', [], { useAI: false, seedTerms: docSeedTerms, headings: docHeadingsTree, minSeedTerms: options.minSeedTerms, docId: doc.meta.docId });

          // 对无监督/段落扩展出的实体补充 LLM 特异性评分（带标题上下文）
          if (provider && provider.name !== 'stub') {
            const unscoredEntities = kg.nodes.filter(n => n.type === 'entity' && !(n.meta && n.meta.specificity !== undefined));
            if (unscoredEntities.length > 0) {
              try {
                const docText = doc.rawText || '';
                const termsWithContext = unscoredEntities.map(n => {
                  const keyword = n.keyword || n.label || '';
                  let offset = docText.indexOf(keyword);
                  if (offset < 0 && n.source && typeof n.source.start === 'number') offset = n.source.start;
                  const heading = offset >= 0 ? findHeadingForOffset(docHeadingsTree, offset) : null;
                  return { term: keyword, heading: heading ? heading.title : '' };
                }).filter(t => t.term);
                if (termsWithContext.length > 0) {
                  const specificityMap = await scoreTermSpecificityWithLLM(termsWithContext, provider, {
                    specificityThreshold: extractOpts.specificityThreshold,
                    specificityBatchSize: extractOpts.specificityBatchSize,
                    specificityTimeoutMs: extractOpts.specificityTimeoutMs
                  });
                  for (const node of unscoredEntities) {
                    const keyword = node.keyword || node.label || '';
                    const info = specificityMap.get(keyword);
                    if (!info) continue;
                    node.meta = node.meta || {};
                    node.meta.specificity = info.specificity;
                    node.meta.isGeneric = info.isGeneric;
                  }
                }
              } catch (e) {
                console.warn('[pipeline] 无监督实体特异性评分失败:', e.message);
              }
            }
          }

          // 实体节点按文档命名空间化，避免跨文档合并
          const entityIdMap = new Map(); // old entity id -> new per-doc entity id
          for (const node of kg.nodes) {
            if (node.type === 'entity') {
              const newId = `${doc.meta.docId}_${node.id}`;
              entityIdMap.set(node.id, newId);
              node.id = newId;
            }
          }
          // 标题节点 id 已经是 `h_${docIdPrefix}_${h.id}`
          // 边里引用实体的都要替换
          for (const edge of kg.edges) {
            if (entityIdMap.has(edge.from)) edge.from = entityIdMap.get(edge.from);
            if (entityIdMap.has(edge.to)) edge.to = entityIdMap.get(edge.to);
          }

          // 修正 source 归属
          for (const node of kg.nodes) {
            if (!node.source || typeof node.source !== 'object') node.source = {};
            node.source.docId = doc.meta.docId;
          }

          perDocGraphs.push({ doc, nodes: kg.nodes, edges: kg.edges });
          } catch (docErr) {
            // 单文档失败不中断整批，跳过该文档继续处理其他文档
            console.error(`[pipeline] 文档 ${doc.meta?.name || di} 处理失败，跳过:`, docErr.message);
            onProgress?.({ stage: 'extractTerms', percent: 60 + Math.floor(((di + 1) / stepwiseDocs.length) * 12), log: `${doc.meta?.name || '文档'} 处理失败，已跳过` });
          }
        }

        onProgress?.({ stage: 'buildGraph', percent: 82, log: '合并各文档子图谱...' });

        // 合并所有子图谱
        for (const { doc, nodes, edges } of perDocGraphs) {
          for (const node of nodes) {
            if (seenNodeIds.has(node.id)) continue;
            seenNodeIds.add(node.id);
            // 合并 source：优先用节点已有的 source，补充 page/start
            const mergedSource = node.source || { docId: doc.meta.docId };
            if (mergedSource.docId === undefined) mergedSource.docId = doc.meta.docId;
            if (mergedSource.page === undefined && node.page !== undefined) mergedSource.page = node.page;
            if (mergedSource.start === undefined && node.start !== undefined) mergedSource.start = node.start;
            graphNodes.push({
              id: node.id,
              type: node.type || 'entity',
              content: node.label || node.keyword || String(node.id),
              label: node.label || node.keyword || '',  // 保留 label 供前端显示
              keyword: node.keyword || '',  // 保留 keyword 供前端显示
              weight: typeof node.weight === 'number' ? node.weight : 1,
              source: mergedSource,
              meta: {
                ...(node.meta || {}),
                keyword: node.keyword,
                paragraphs: node.paragraphs,
                pages: node.pages,
                level: node.level,
                start: node.start,
                end: node.end,
                page: node.page,
                textrank: node.textrank,
                pagerank: node.pagerank,
                community: node.community,
                color: node.color,
                size: node.size,
                x: node.x,
                y: node.y
              }
            });
          }
          for (const edge of edges) {
            graphEdges.push({
              from: edge.from,
              to: edge.to,
              type: edge.type || 'related',
              weight: typeof edge.weight === 'number' ? edge.weight : 1,
              source: edge.source || 'kg',
              evidence: edge.evidence || edge.source || ''
            });
          }
        }

        // 生成 document 顶层节点（仅路径 B 的文档；路径 A 已由 convertToGraph 生成）
        for (const { doc } of stepwiseDocs) {
          const docIndex = documents.indexOf(doc);
          const docNodeId = doc.meta.docId.startsWith('doc-') ? doc.meta.docId : `doc-${doc.meta.docId}`;
          graphNodes.push({
            id: docNodeId,
            type: 'document',
            label: doc.meta.name || `文档${docIndex + 1}`,
            content: doc.meta.name || `文档${docIndex + 1}`,
            weight: 1,
            source: { docId: doc.meta.docId, page: 0 },
            meta: { docId: doc.meta.docId, docIndex, level: 0 }
          });
        }

        // 连接 document → 该文档的顶层 heading
        for (const [docId, docHeadings] of headingsByDoc) {
          if (docHeadings.length === 0) continue;
          const minLevel = Math.min(...docHeadings.map(h => h.level || 99));
          const docNodeId = docId.startsWith('doc-') ? docId : `doc-${docId}`;
          for (const h of docHeadings) {
            if ((h.level || 99) === minLevel) {
              graphEdges.push({
                from: docNodeId,
                to: `h_${h.id}`,
                type: 'contains',
                weight: 1,
                source: 'doc-tree',
                evidence: 'document-heading'
              });
            }
          }
        }

        // 兜底：确保每个 heading 节点都能挂到所属 document 下
        const headingIds = new Set(graphNodes.filter(n => n.type === 'heading').map(n => n.id));
        const headingTargets = new Set(graphEdges.filter(e => headingIds.has(e.to)).map(e => e.to));
        for (const hNode of graphNodes.filter(n => n.type === 'heading')) {
          if (headingTargets.has(hNode.id)) continue;
          const docId = hNode.source?.docId;
          if (docId) {
            const docNodeId = docId.startsWith('doc-') ? docId : `doc-${docId}`;
            graphEdges.push({
              from: docNodeId,
              to: hNode.id,
              type: 'contains',
              weight: 1,
              source: 'doc-tree',
              evidence: 'document-heading-fallback'
            });
          }
        }

        onProgress?.({ stage: 'buildGraph', percent: 85, log: `知识图谱生成完成：${graphNodes.length} 节点，${graphEdges.length} 边` });

        if (graphNodes.length === 0) {
          throw new Error('无监督算法未抽取到有效实体，回退到简化图谱');
        }
      } catch (kgErr) {
        console.error('[runPipeline] 无监督图谱构建失败，回退到旧版:', kgErr);
        onProgress?.({ stage: 'buildGraph', percent: 85, log: `图谱构建失败: ${kgErr.message}，使用简化图谱` });
        // 仅在 graphNodes 为空时才用 fallback 填充，避免覆盖 full-extract 已成功的结果
        if (graphNodes.length === 0) {
          // 合并所有文档的 sections，而非仅 documents[0]
          const allSections = documents.flatMap(d => (d.sections || []));
          const legacyChapters = allSections.length > 0
            ? [{ id: 'ch1', title: '文档章节', sections: allSections }]
            : [];
          const legacyGraph = generateKnowledgeGraph(legacyChapters, []);
          graphNodes = legacyGraph.nodes.map(n => ({ ...n, type: n.type || 'concept', content: n.label || n.id }));
          graphEdges = legacyGraph.edges.map(e => ({ ...e, type: e.type || 'belong', weight: e.weight || 1 }));
        }
      }
    } // end of if (stepwiseDocs.length > 0)
  }


  // 阶段 4: crossLink（跨文档连接）
  onProgress?.({ stage: 'crossLink', percent: 88, log: '跨文档连接...' });
  {
    let inferredEdges = [];
    const useLLM = provider && provider.name !== 'stub';

    function snapshotCrossLinkKeys(kg) {
      const keys = new Set();
      for (const edge of kg.edges.values()) {
        if (edge.type === 'cross-link') keys.add([edge.from, edge.to].sort().join('|||'));
      }
      return keys;
    }

    function collectNewCrossLinks(kg, existingKeys) {
      const newEdges = [];
      for (const edge of kg.edges.values()) {
        if (edge.type !== 'cross-link') continue;
        const key = [edge.from, edge.to].sort().join('|||');
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        newEdges.push({
          from: edge.from,
          to: edge.to,
          type: 'cross-link',
          weight: edge.weight,
          source: 'pipeline',
          evidence: edge.evidence || { method: 'crosslink' }
        });
      }
      return newEdges;
    }

    if (useLLM) {
      // 有 LLM 时用语义判断版：分别连接 heading 和 entity
      // 每类独立 try/catch，各自失败各自回退规则版
      const kg = new KnowledgeGraph();
      for (const n of graphNodes) kg.addNode(n);
      for (const e of graphEdges) kg.addEdge(e);

      // --- heading 跨文档连接 ---
      let headingEdges = [];
      try {
        let existingKeys = snapshotCrossLinkKeys(kg);
        await buildCrossLinksLLM(kg, { provider, threshold: 0.3, nodeTypes: ['heading'] });
        headingEdges = collectNewCrossLinks(kg, existingKeys);
        inferredEdges.push(...headingEdges);
      } catch (e) {
        if (e.code === 'TASK_DISABLED') {
          console.warn('[pipeline] 跨文档 heading LLM 连线任务已被禁用，使用规则连线:', e.message);
        } else {
          console.warn('[pipeline] 跨文档 heading LLM 连接失败，回退规则:', e.message);
        }
        crossLinkErrors.push({ stage: 'crossLink-llm-heading', message: e.message });
        // 单独回退 heading 的规则连线
        let existingKeys = snapshotCrossLinkKeys(kg);
        buildCrossLinks(kg, { threshold: 0.3, nodeTypes: ['heading'] });
        headingEdges = collectNewCrossLinks(kg, existingKeys);
        inferredEdges.push(...headingEdges);
      }

      // --- entity 跨文档连接 ---
      try {
        let existingKeys = snapshotCrossLinkKeys(kg);
        await buildCrossLinksLLM(kg, { provider, threshold: 0.3, nodeTypes: ['entity'] });
        inferredEdges.push(...collectNewCrossLinks(kg, existingKeys));
      } catch (e) {
        if (e.code === 'TASK_DISABLED') {
          console.warn('[pipeline] 跨文档 entity LLM 连线任务已被禁用，使用规则连线:', e.message);
        } else {
          console.warn('[pipeline] 跨文档 entity LLM 连接失败，回退规则:', e.message);
        }
        crossLinkErrors.push({ stage: 'crossLink-llm-entity', message: e.message });
        // 单独回退 entity 的规则连线
        let existingKeys = snapshotCrossLinkKeys(kg);
        buildCrossLinks(kg, { threshold: 0.3, nodeTypes: ['entity'] });
        inferredEdges.push(...collectNewCrossLinks(kg, existingKeys));
      }

      if (inferredEdges.length > 0) {
        onProgress?.({ stage: 'crossLink', percent: 90, log: `跨文档 LLM 连接完成：${inferredEdges.length} 条` });
      }
    }
    if (inferredEdges.length === 0) {
      // 无 LLM 或 LLM 失败时回退规则版：分别连接 heading 和 entity
      const kg = new KnowledgeGraph();
      for (const n of graphNodes) kg.addNode(n);
      for (const e of graphEdges) kg.addEdge(e);

      let existingKeys = snapshotCrossLinkKeys(kg);
      buildCrossLinks(kg, { threshold: 0.3, nodeTypes: ['heading'] });
      inferredEdges.push(...collectNewCrossLinks(kg, existingKeys));

      existingKeys = snapshotCrossLinkKeys(kg);
      buildCrossLinks(kg, { threshold: 0.3, nodeTypes: ['entity'] });
      inferredEdges.push(...collectNewCrossLinks(kg, existingKeys));

      if (inferredEdges.length > 0) {
        onProgress?.({ stage: 'crossLink', percent: 90, log: `跨文档规则连接完成：${inferredEdges.length} 条` });
      }
    }
    // ★ 校验跨文档边，过滤悬空/非法类型边
    const crossLinkValidation = validateExtractedNodesAndEdges(graphNodes, inferredEdges, null);
    graphEdges.push(...crossLinkValidation.validEdges);
  }

  // 阶段 5: queryable（可查询结构）
  onProgress?.({ stage: 'queryable', percent: 100, log: '完成' });

  return {
    documents,
    entities,
    graph: {
      nodes: graphNodes,
      edges: graphEdges
    },
    crossLinkErrors
  };
}

// ============ runPipeline 辅助函数 ============

function generateDocId() {
  return 'doc-' + randomUUID().slice(0, 8);
}

function assignSourceToNode(keyword, documents) {
  if (!keyword || documents.length === 0) return null;
  let bestDocId = null;
  let bestCount = 0;
  let bestPages = [];
  for (const doc of documents) {
    const text = doc.rawText || '';
    const positions = findKeywordPositions(text, keyword);
    if (positions.length > bestCount) {
      bestCount = positions.length;
      bestDocId = doc.meta.docId;
      bestPages = positions.map(pos => pos.page).filter(p => p > 0);
    }
  }
  if (!bestDocId) return null;
  const pageCounts = new Map();
  for (const p of bestPages) pageCounts.set(p, (pageCounts.get(p) || 0) + 1);
  let page = 0;
  let pageMax = 0;
  for (const [p, c] of pageCounts) {
    if (c > pageMax) {
      pageMax = c;
      page = p;
    }
  }
  const pages = [...new Set(bestPages)].sort((a, b) => a - b);
  return { docId: bestDocId, page, pages };
}

function findKeywordPositions(text, keyword) {
  const positions = [];
  let idx = text.indexOf(keyword);
  while (idx !== -1) {
    positions.push({ index: idx, page: findPageAtIndex(text, idx) });
    idx = text.indexOf(keyword, idx + keyword.length);
  }
  return positions;
}

function findPageAtIndex(text, index) {
  // 从 index 往前找最近的 "--- 第N页 ---" 标记
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/--- 第(\d+)页 ---/g)];
  if (matches.length === 0) return 0;
  const last = matches[matches.length - 1];
  return parseInt(last[1], 10);
}

function detectType(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.bmp') || name.endsWith('.webp')) return 'image';
  if (name.endsWith('.js') || name.endsWith('.py') || name.endsWith('.ts') || name.endsWith('.tsx')) return 'code';
  return 'text';
}

async function parseFileByType(file, type) {
  // PDF/Word 需要浏览器环境（pdfjsLib/mammoth），实际解析由 core/parser 在浏览器端执行
  if (type === 'pdf') {
    try {
      const { parsePDF } = await import('../parser/index.js');
      return await parsePDF(file);
    } catch (err) {
      throw new Error('PDF解析失败（可能缺少浏览器环境依赖）: ' + (err && err.message ? err.message : String(err)));
    }
  }
  // markdown/text/code 直接读文本
  const text = file.text ? await file.text() : (file.content || '');
  return { text, images: [], totalPages: 1 };
}

export { runPipeline };
