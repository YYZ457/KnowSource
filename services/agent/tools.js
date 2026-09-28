import { createHash } from 'node:crypto';
import { storage, getCurrentProjectId, listProjects } from '../storage.js';
import { getKGProvider } from '../llm-provider.js';
import { createIdea, updateIdea, deleteIdea } from '../api/handlers/idea.js';
import { createNode, updateNode, deleteNode, createEdge, updateEdge, deleteEdge } from '../api/handlers/graph-node.js';
import { graphBuildHandler } from '../api/handlers/graph-build.js';
import { deleteDocument } from '../api/handlers/parse.js';
import { createProjectHandler, renameProjectHandler, switchProjectHandler } from '../api/handlers/projects.js';
import { SITE_GUIDE } from './catalog.js';

export const READ_TOOLS = new Set(['documents.list', 'documents.read', 'documents.search', 'graph.query', 'ideas.list', 'projects.list', 'help']);
const WRITERS = { 'graph.build': graphBuildHandler, 'node.create': createNode, 'node.update': updateNode, 'node.delete': deleteNode, 'edge.create': createEdge, 'edge.update': updateEdge, 'edge.delete': deleteEdge, 'idea.create': createIdea, 'idea.update': updateIdea, 'idea.delete': deleteIdea, 'document.delete': deleteDocument, 'project.create': createProjectHandler, 'project.rename': renameProjectHandler, 'project.switch': switchProjectHandler };
const TITLES = { 'graph.build': '构建所选文献图谱（可能消耗模型额度）', 'node.create': '添加图谱节点', 'node.update': '修改图谱节点', 'node.delete': '删除节点及其关系', 'edge.create': '添加图谱关系', 'edge.update': '修改图谱关系', 'edge.delete': '删除图谱关系', 'idea.create': '保存新灵感', 'idea.update': '修改灵感', 'idea.delete': '删除灵感及其子灵感', 'document.delete': '删除文献及相关图谱', 'project.create': '创建研究项目', 'project.rename': '重命名项目', 'project.switch': '切换研究项目', 'ui.navigate': '打开工作台页面', 'ui.import': '选择并导入文件', 'ui.export': '导出当前项目', 'ui.settings': '打开模型设置' };
export const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const number = (v, fallback, max) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : fallback;
const ids = v => Array.isArray(v) ? [...new Set(v.map(x => text(x, 150)).filter(Boolean))].slice(0, 12) : [];
const docName = d => text(d.name || d.meta?.name || d.docId, 240);
const docText = d => typeof d.rawText === 'string' ? d.rawText : (d.sections || []).map(s => text(s.content || s.text, 30000)).join('\n');

function excerpt(run, d, offset, limit) {
  const raw = docText(d);
  const content = raw.slice(offset, offset + limit);
  if (content && run.evidence.length < 60) {
    const id = `S${run.evidence.length + 1}`;
    const item = { id, docId: d.docId, title: docName(d), excerpt: content, offset };
    run.evidence.push(item);
    return { ...item, totalCharacters: raw.length, nextOffset: offset + content.length, hasMore: offset + content.length < raw.length };
  }
  return { docId: d.docId, title: docName(d), excerpt: '', totalCharacters: raw.length, nextOffset: offset, hasMore: false };
}

export async function readTool(run, name, args = {}) {
  switch (name) {
    case 'help': return { guide: SITE_GUIDE };
    case 'documents.list': {
      const all = [...storage.documents.values()].filter(d => !run.documentIds.length || run.documentIds.includes(d.docId));
      const offset = number(args.offset, 0, all.length), limit = number(args.limit, 20, 30) || 20;
      return { total: all.length, documents: all.slice(offset, offset + limit).map(d => ({ docId: d.docId, title: docName(d), characters: docText(d).length })) };
    }
    case 'documents.read': {
      const d = storage.documents.get(text(args.docId, 150));
      if (!d) throw new Error('文献不存在，请先列出文献取得真实 ID。');
      if (run.documentIds.length && !run.documentIds.includes(d.docId)) throw new Error('该文献不在用户选择的阅读范围内。');
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
      const nodes = allNodes.filter(n => !query || `${n.content || ''} ${n.label || ''}`.toLocaleLowerCase().includes(query)).slice(0, limit);
      const selected = new Set(nodes.map(n => n.id));
      return { totalNodes: allNodes.length, totalEdges: allEdges.length, nodes: nodes.map(n => ({ id: n.id, content: text(n.content || n.label, 250), type: n.type, docId: n.source?.docId })), edges: allEdges.filter(e => selected.has(e.from) || selected.has(e.to)).slice(0, 30).map(e => ({ from: e.from, to: e.to, type: e.type })) };
    }
    case 'ideas.list': {
      const query = text(args.query, 100).toLocaleLowerCase();
      return { ideas: [...storage.ideas.values()].filter(i => !query || `${i.title} ${i.content}`.toLocaleLowerCase().includes(query)).slice(0, number(args.limit, 10, 20) || 10).map(i => ({ id: i.id, title: text(i.title, 200), content: text(i.content, 700), parentId: i.parentId, tags: i.tags })) };
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

export function prepareAction(tool, raw = {}) {
  if (!Object.hasOwn(TITLES, tool)) throw new Error(`不支持操作：${text(tool)}`);
  const args = {};
  const stringFields = { 'node.create': ['content', 'type'], 'node.update': ['id', 'content', 'type'], 'node.delete': ['id'], 'edge.create': ['from', 'to', 'type'], 'edge.update': ['from', 'to', 'type', 'newType'], 'edge.delete': ['from', 'to', 'type'], 'idea.create': ['title', 'content', 'parentId'], 'idea.update': ['id', 'title', 'content'], 'idea.delete': ['id'], 'document.delete': ['id'], 'project.create': ['name'], 'project.rename': ['id', 'name'], 'project.switch': ['projectId'] };
  for (const key of stringFields[tool] || []) if (raw[key] !== undefined) args[key] = text(raw[key], key === 'content' ? 8000 : key === 'title' ? 200 : 150);
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
    if ((stringFields[tool] || []).includes(key) && args[key] !== undefined && !args[key].trim()) throw new Error(`操作参数 ${key} 不能为空。`);
  }
  const required = { 'node.create': ['content'], 'node.update': ['id', 'content'], 'node.delete': ['id'], 'edge.create': ['from', 'to'], 'edge.update': ['from', 'to', 'type', 'newType'], 'edge.delete': ['from', 'to', 'type'], 'idea.create': ['title', 'content'], 'idea.update': ['id'], 'idea.delete': ['id'], 'document.delete': ['id'], 'project.create': ['name'], 'project.rename': ['id', 'name'], 'project.switch': ['projectId'] };
  for (const key of required[tool] || []) if (!args[key]) throw new Error(`缺少操作参数 ${key}。`);
  if (tool === 'document.delete' && !storage.documents.has(args.id)) throw new Error('待删除文献不存在。');
  if (['idea.update', 'idea.delete'].includes(tool) && !storage.ideas.has(args.id)) throw new Error('待修改灵感不存在。');
  if (['node.update', 'node.delete'].includes(tool) && !(storage.graph?.nodes || []).some(n => n.id === args.id)) throw new Error('待修改节点不存在。');
  return { tool, title: tool === 'graph.build' ? `构建图谱 · ${args.model}${args.mode === 'ai' ? '（可能消耗额度）' : ''}` : TITLES[tool], args };
}

export async function executeAction(action) {
  if (action.tool.startsWith('ui.')) return { ui: true };
  const handler = WRITERS[action.tool];
  if (!handler) throw new Error('不支持此操作。');
  if (action.tool === 'graph.build' && action.args.mode === 'ai') {
    const kg = getKGProvider();
    if (`${kg?.config?.vendor || kg?.name} / ${kg?.model}` !== action.args.model) throw new Error('图谱模型在确认前发生变化，请重新预览构建任务。');
  }
  const result = await handler(action.tool === 'graph.build' ? { docIds: action.args.docIds, options: { mode: action.args.mode } } : action.args);
  if (result?.success === false || result?.error) throw new Error(text(result.error || '操作失败', 500));
  return { success: true, createdId: result?.data?.id || result?.node?.id || result?.project?.id, currentProjectId: result?.currentProjectId, nodeCount: result?.nodes?.length, edgeCount: result?.edges?.length, warnings: Array.isArray(result?.warnings) ? result.warnings.map(w => text(w, 500)).slice(0, 8) : [] };
}
