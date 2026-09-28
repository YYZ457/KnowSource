import { createHash } from 'node:crypto';
import { storage, getCurrentProjectId, listProjects } from '../storage.js';
import { getKGProvider } from '../llm-provider.js';
import { createIdea, updateIdea, deleteIdea, linkIdeaToNode, unlinkIdeaFromNode } from '../api/handlers/idea.js';
import { createNode, updateNode, deleteNode, createEdge, updateEdge, deleteEdge } from '../api/handlers/graph-node.js';
import { graphBuildHandler } from '../api/handlers/graph-build.js';
import { deleteDocument } from '../api/handlers/parse.js';
import { createProjectHandler, renameProjectHandler, switchProjectHandler } from '../api/handlers/projects.js';
import { SITE_GUIDE } from './catalog.js';

export const READ_TOOLS = new Set(['documents.list', 'documents.inspect', 'documents.read', 'documents.search', 'graph.query', 'ideas.list', 'projects.list', 'help']);
const WRITERS = { 'graph.build': graphBuildHandler, 'node.create': createNode, 'node.update': updateNode, 'node.delete': deleteNode, 'edge.create': createEdge, 'edge.update': updateEdge, 'edge.delete': deleteEdge, 'idea.create': createIdea, 'idea.update': updateIdea, 'idea.delete': deleteIdea, 'idea.link': linkIdeaToNode, 'idea.unlink': unlinkIdeaFromNode, 'document.delete': deleteDocument, 'project.create': createProjectHandler, 'project.rename': renameProjectHandler, 'project.switch': switchProjectHandler };
const TITLES = { 'graph.build': '构建所选文献图谱（可能消耗模型额度）', 'node.create': '添加图谱节点', 'node.update': '修改图谱节点', 'node.delete': '删除节点及其关系', 'edge.create': '添加图谱关系', 'edge.update': '修改图谱关系', 'edge.delete': '删除图谱关系', 'idea.create': '保存新灵感', 'idea.update': '修改灵感', 'idea.delete': '删除灵感及其子灵感', 'idea.link': '将灵感关联至图谱节点', 'idea.unlink': '解除灵感与图谱节点关联', 'document.delete': '删除文献及相关图谱', 'project.create': '创建研究项目', 'project.rename': '重命名项目', 'project.switch': '切换研究项目', 'ui.navigate': '打开工作台页面', 'ui.import': '选择并导入文件', 'ui.export': '导出当前项目', 'ui.settings': '打开模型设置' };
export const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const number = (v, fallback, max) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : fallback;
const ids = v => Array.isArray(v) ? [...new Set(v.map(x => text(x, 150)).filter(Boolean))].slice(0, 12) : [];
const docName = d => text(d.name || d.meta?.name || d.docId, 240);
const docText = d => typeof d.rawText === 'string' ? d.rawText : (d.sections || []).map(s => text(s.content || s.text, 30000)).join('\n');

function readingCoverage(run, d) {
  const ranges = [...(run.readRanges?.[d.docId] || [])].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const totalCharacters = docText(d).length;
  const readCharacters = merged.reduce((sum, [from, to]) => sum + to - from, 0);
  return { totalCharacters, readCharacters, percentage: totalCharacters ? Math.round(readCharacters / totalCharacters * 100) : 0, ranges: merged, complete: totalCharacters > 0 && readCharacters === totalCharacters };
}

function accessibleDocument(run, id) {
  const d = storage.documents.get(text(id, 150));
  if (!d) throw new Error('文献不存在，请先列出文献取得真实 ID。');
  if (run.documentIds.length && !run.documentIds.includes(d.docId)) throw new Error('该文献不在用户选择的阅读范围内。');
  return d;
}

function excerpt(run, d, offset, limit) {
  const raw = docText(d);
  const content = raw.slice(offset, offset + limit);
  if (content) {
    run.readRanges ||= Object.create(null);
    const ranges = run.readRanges[d.docId] ||= [];
    ranges.push([offset, offset + content.length]);
    run.readRanges[d.docId] = readingCoverage(run, d).ranges;
  }
  if (content && run.evidence.length < 60) {
    const id = `S${run.evidence.length + 1}`;
    const item = { id, docId: d.docId, title: docName(d), excerpt: content, offset };
    run.evidence.push(item);
    return { ...item, totalCharacters: raw.length, nextOffset: offset + content.length, hasMore: offset + content.length < raw.length, coverage: readingCoverage(run, d) };
  }
  return { docId: d.docId, title: docName(d), excerpt: content, totalCharacters: raw.length, nextOffset: offset + content.length, hasMore: offset + content.length < raw.length, coverage: readingCoverage(run, d), note: content ? '引用编号额度已满；此片段仍可阅读，不得伪造引用编号。' : '已到文本末尾。' };
}

export async function readTool(run, name, args = {}) {
  switch (name) {
    case 'help': return { guide: SITE_GUIDE };
    case 'documents.list': {
      const all = [...storage.documents.values()].filter(d => !run.documentIds.length || run.documentIds.includes(d.docId));
      const offset = number(args.offset, 0, all.length), limit = number(args.limit, 20, 30) || 20;
      return { total: all.length, documents: all.slice(offset, offset + limit).map(d => ({ docId: d.docId, title: docName(d), characters: docText(d).length })) };
    }
    case 'documents.inspect': {
      const d = accessibleDocument(run, args.docId), raw = docText(d);
      const type = d.type || d.meta?.type || '';
      const replacementCharacters = (raw.match(/\uFFFD/g) || []).length;
      const warnings = ['此检查仅针对已解析文本与元数据，未查看原 PDF、图片或 DOCX 排版；不能据此确认公式、题干与原件一致。'];
      if (!raw.trim()) warnings.push('没有可读文本，请重新导入可读版本或使用 OCR。');
      if (replacementCharacters) warnings.push(`文本含 ${replacementCharacters} 个乱码替代字符，需核对原件。`);
      if (/docx/i.test(type) || /\.docx$/i.test(docName(d))) warnings.push('DOCX 的 Office Math 公式、嵌入对象或图片公式可能未被文本提取保留；公式题必须对照原件核验，必要时重新导入清晰 PDF/图片。');
      if (d.meta?.isScanned || /image|png|jpg|jpeg/i.test(type)) warnings.push('扫描件/图片文字可能经过 OCR，公式、上下标和符号需人工核验。');
      return { docId: d.docId, title: docName(d), type, characters: raw.length, sectionCount: d.sections?.length || 0, pages: d.meta?.totalPages || null, scanned: d.meta?.isScanned ?? null, replacementCharacters, mathSymbolCount: (raw.match(/[=∑∫√≤≥∞∂∆αβθπ]/g) || []).length, coverage: readingCoverage(run, d), warnings, formulaCompleteness: 'unknown', nextAction: '按 documents.read 的 nextOffset 连续读取并检查题干；不要仅凭数学符号数量认定公式完整。' };
    }
    case 'documents.read': {
      const d = accessibleDocument(run, args.docId);
      return excerpt(run, d, number(args.offset, 0, docText(d).length), number(args.limit, 2200, 4000) || 2200);
    }
    case 'documents.search': {
      const query = text(args.query, 120).trim();
      if (!query) throw new Error('搜索关键词不能为空。');
      const filter = ids(args.docIds), matches = [], limit = number(args.limit, 5, 8) || 5;
      for (const d of storage.documents.values()) {
        if (run.documentIds.length && !run.documentIds.includes(d.docId)) continue;
        if (filter.length && !filter.includes(d.docId)) continue;
        const raw = docText(d).toLocaleLowerCase(), needle = query.toLocaleLowerCase();
        let position = raw.indexOf(needle);
        while (position >= 0 && matches.length < limit) {
          matches.push(excerpt(run, d, Math.max(0, position - 120), 650));
          position = raw.indexOf(needle, position + Math.max(needle.length, 400));
        }
        if (matches.length >= limit) break;
      }
      return { query, matches, note: '仅关键词匹配，不代表穷尽全文语义。' };
    }
    case 'graph.query': {
      const query = text(args.query, 100).toLocaleLowerCase(), limit = number(args.limit, 20, 30) || 20;
      const allNodes = storage.graph?.nodes || [], allEdges = storage.graph?.edges || [];
      const matching = allNodes.filter(n => !query || `${n.content || ''} ${n.label || ''}`.toLocaleLowerCase().includes(query));
      const offset = number(args.offset, 0, matching.length);
      const nodes = matching.slice(offset, offset + limit);
      const selected = new Set(nodes.map(n => n.id));
      return { totalNodes: allNodes.length, totalEdges: allEdges.length, matchedNodes: matching.length, nextOffset: offset + nodes.length, hasMore: offset + nodes.length < matching.length, nodes: nodes.map(n => ({ id: n.id, content: text(n.content || n.label, 250), type: n.type, docId: n.source?.docId })), edges: allEdges.filter(e => selected.has(e.from) || selected.has(e.to)).slice(0, 60).map(e => ({ from: e.from, to: e.to, type: e.type })) };
    }
    case 'ideas.list': {
      const query = text(args.query, 100).toLocaleLowerCase();
      const all = [...storage.ideas.values()].filter(i => (!query || `${i.title} ${i.content}`.toLocaleLowerCase().includes(query)) && (args.parentId === undefined || (i.parentId || null) === (args.parentId || null)));
      const offset = number(args.offset, 0, all.length), limit = number(args.limit, 10, 30) || 10;
      const page = all.slice(offset, offset + limit);
      return { total: all.length, nextOffset: offset + page.length, hasMore: offset + page.length < all.length, ideas: page.map(i => ({ id: i.id, title: text(i.title, 200), content: text(i.content, 1200), parentId: i.parentId, tags: i.tags, relatedNodeIds: i.relatedNodeIds })) };
    }
    case 'projects.list': {
      const data = await listProjects();
      return { currentProjectId: data.currentProjectId, projects: data.projects.slice(0, 40).map(p => ({ id: p.id, name: text(p.name, 80), description: text(p.description, 200) })) };
    }
    default: throw new Error('不支持此读取工具。');
  }
}

export function fingerprint() {
  return createHash('sha256').update(JSON.stringify({ project: getCurrentProjectId(), graph: storage.graphVersion, documents: [...storage.documents.values()].map(d => [d.docId, d.name, docText(d).length]), ideas: [...storage.ideas.values()].map(i => [i.id, i.updatedAt]) })).digest('hex');
}

const isReference = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string';
function referenceTypes(tool, field) {
  if (field === 'parentId' || field === 'ideaId' || (field === 'id' && tool.startsWith('idea.'))) return ['idea.create'];
  if (['from', 'to', 'nodeId'].includes(field) || (field === 'id' && tool.startsWith('node.'))) return ['node.create', 'idea.create'];
  if (field === 'projectId' || (field === 'id' && tool.startsWith('project.'))) return ['project.create'];
  return [];
}

export function prepareAction(tool, raw = {}, context = {}) {
  if (!Object.hasOwn(TITLES, tool)) throw new Error(`不支持操作：${text(tool)}`);
  const previousActions = Array.isArray(context.previousActions) ? context.previousActions : [];
  const key = context.key;
  if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || previousActions.some(a => a.key === key))) throw new Error('动作 key 必须是唯一的字母开头标识（最多 64 字符）。');
  const args = {};
  const stringFields = { 'node.create': ['content', 'type'], 'node.update': ['id', 'content', 'type'], 'node.delete': ['id'], 'edge.create': ['from', 'to', 'type'], 'edge.update': ['from', 'to', 'type', 'newType'], 'edge.delete': ['from', 'to', 'type'], 'idea.create': ['title', 'content', 'parentId'], 'idea.update': ['id', 'title', 'content', 'parentId'], 'idea.delete': ['id'], 'idea.link': ['ideaId', 'nodeId'], 'idea.unlink': ['ideaId', 'nodeId'], 'document.delete': ['id'], 'project.create': ['name'], 'project.rename': ['id', 'name'], 'project.switch': ['projectId'] };
  for (const field of stringFields[tool] || []) {
    const value = raw[field];
    if (value === undefined) continue;
    if (field === 'parentId' && value === null) { args[field] = null; continue; }
    if (isReference(value)) {
      const source = previousActions.find(a => a.key === value.$ref);
      if (!source || !referenceTypes(tool, field).includes(source.tool) || ['failed', 'skipped'].includes(source.status)) throw new Error(`参数 ${field} 引用了不存在、类型不匹配或未排在前面的创建动作：${text(value.$ref, 64)}`);
      args[field] = { $ref: source.key };
    } else {
      if (typeof value !== 'string') throw new Error(`参数 ${field} 必须是文字或合法的前序动作引用。`);
      args[field] = text(value, field === 'content' ? 8000 : field === 'title' ? 200 : 150);
    }
  }
  if (tool.startsWith('idea.') && Array.isArray(raw.tags)) args.tags = raw.tags.slice(0, 12).map(t => text(t, 40));
  if (tool === 'graph.build') {
    const kg = getKGProvider();
    args.mode = raw.mode === 'offline' ? 'offline' : raw.mode === 'ai' ? 'ai' : kg?.name && kg.name !== 'stub' ? 'ai' : 'offline';
    if (args.mode === 'ai' && (!kg || kg.name === 'stub' || !kg.model)) throw new Error('请先在设置中配置图谱 KG 模型，或明确选择 offline 离线构建。');
    args.model = args.mode === 'offline' ? '离线规则（不调用模型）' : `${kg.config?.vendor || kg.name} / ${kg.model}`;
    args.docIds = ids(raw.docIds);
    if (!args.docIds.length || args.docIds.some(id => !storage.documents.has(id))) throw new Error('构建图谱必须指定当前项目真实文献 ID。');
    // Bound one operation; let the existing pipeline choose model-specific extraction settings.
    if (args.docIds.reduce((sum, id) => sum + docText(storage.documents.get(id)).length, 0) > 250000) throw new Error('本次文献超过 25 万字符，请分批构建图谱。');
  }
  if (tool === 'ui.navigate') {
    if (!['literature', 'graph', 'ideas'].includes(raw.page)) throw new Error('未知页面。');
    args.page = raw.page;
  }
  for (const key of ['id', 'projectId', 'from', 'to', 'name', 'content']) {
    if ((stringFields[tool] || []).includes(key) && typeof args[key] === 'string' && !args[key].trim()) throw new Error(`操作参数 ${key} 不能为空。`);
  }
  const required = { 'node.create': ['content'], 'node.update': ['id', 'content'], 'node.delete': ['id'], 'edge.create': ['from', 'to'], 'edge.update': ['from', 'to', 'type', 'newType'], 'edge.delete': ['from', 'to', 'type'], 'idea.create': ['title', 'content'], 'idea.update': ['id'], 'idea.delete': ['id'], 'idea.link': ['ideaId', 'nodeId'], 'idea.unlink': ['ideaId', 'nodeId'], 'document.delete': ['id'], 'project.create': ['name'], 'project.rename': ['id', 'name'], 'project.switch': ['projectId'] };
  for (const field of required[tool] || []) if (!args[field] || (typeof args[field] === 'string' && !args[field].trim())) throw new Error(`缺少操作参数 ${field}。`);
  if (tool === 'document.delete' && !storage.documents.has(args.id)) throw new Error('待删除文献不存在。');
  if (['idea.update', 'idea.delete'].includes(tool) && !isReference(args.id) && !storage.ideas.has(args.id)) throw new Error('待修改灵感不存在。');
  if (args.parentId && !isReference(args.parentId) && !storage.ideas.has(args.parentId)) throw new Error('父灵感不存在。');
  if (['idea.link', 'idea.unlink'].includes(tool) && !isReference(args.ideaId) && !storage.ideas.has(args.ideaId)) throw new Error('待关联灵感不存在。');
  if (['node.update', 'node.delete'].includes(tool) && !isReference(args.id) && !(storage.graph?.nodes || []).some(n => n.id === args.id)) throw new Error('待修改节点不存在。');
  for (const field of ['from', 'to', 'nodeId']) if (args[field] && !isReference(args[field]) && !(storage.graph?.nodes || []).some(n => n.id === args[field])) throw new Error(`图谱节点 ${field} 不存在，请查询真实 ID。`);
  return { ...(key !== undefined ? { key } : {}), tool, title: tool === 'graph.build' ? `构建图谱 · ${args.model}${args.mode === 'ai' ? '（可能消耗额度）' : ''}` : TITLES[tool], args };
}

export async function executeAction(action, context = {}) {
  const prior = Array.isArray(context.actions) ? context.actions : [];
  const currentIndex = prior.findIndex(a => a.id === action.id);
  const resolvedArgs = {};
  for (const [field, value] of Object.entries(action.args || {})) {
    if (!isReference(value)) { resolvedArgs[field] = value; continue; }
    const sourceIndex = prior.findIndex(a => a.key === value.$ref);
    const source = prior[sourceIndex];
    if (currentIndex < 0 || sourceIndex < 0 || sourceIndex >= currentIndex || source.status !== 'completed' || source.result?.success !== true || !source.result.createdId || !referenceTypes(action.tool, field).includes(source.tool)) throw new Error(`前序动作 ${text(value.$ref, 64)} 尚未成功创建对象；不会执行依赖它的操作。`);
    resolvedArgs[field] = source.result.createdId;
  }
  // Revalidate actual IDs immediately before mutation without modifying the approved payload.
  const checked = prepareAction(action.tool, resolvedArgs);
  if (action.tool.startsWith('ui.')) return { ui: true };
  const handler = WRITERS[action.tool];
  if (!handler) throw new Error('不支持此操作。');
  if (action.tool === 'graph.build' && action.args.mode === 'ai') {
    const kg = getKGProvider();
    if (`${kg?.config?.vendor || kg?.name} / ${kg?.model}` !== action.args.model) throw new Error('图谱模型在确认前发生变化，请重新预览构建任务。');
  }
  const result = await handler(action.tool === 'graph.build' ? { docIds: checked.args.docIds, options: { mode: checked.args.mode } } : checked.args);
  if (result?.success === false || result?.error) throw new Error(text(result.error || '操作失败', 500));
  const createdId = result?.data?.id || result?.node?.id || result?.project?.id;
  if (action.tool === 'idea.create' && (!createdId || !storage.ideas.has(createdId))) throw new Error('创建灵感后的数据核对失败。请检查工作台，避免重复创建。');
  if (action.tool === 'node.create' && (!createdId || !(storage.graph?.nodes || []).some(n => n.id === createdId))) throw new Error('创建节点后的数据核对失败。请检查工作台，避免重复创建。');
  if (action.tool === 'project.create' && (!createdId || !(await listProjects()).projects.some(p => p.id === createdId))) throw new Error('创建项目后的数据核对失败。请检查工作台，避免重复创建。');
  if (action.tool === 'idea.link' && !storage.ideas.get(checked.args.ideaId)?.relatedNodeIds?.includes(checked.args.nodeId)) throw new Error('灵感关联后的数据核对失败。');
  if (action.tool === 'idea.unlink' && storage.ideas.get(checked.args.ideaId)?.relatedNodeIds?.includes(checked.args.nodeId)) throw new Error('解除灵感关联后的数据核对失败。');
  return { success: true, createdId, currentProjectId: result?.currentProjectId, nodeCount: result?.nodes?.length, edgeCount: result?.edges?.length, warnings: Array.isArray(result?.warnings) ? result.warnings.map(w => text(w, 500)).slice(0, 8) : [] };
}
