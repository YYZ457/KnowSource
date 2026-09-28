export const AGENT_SKILLS = [
  { id: 'help', title: '知源使用向导', description: '解释文献、图谱、灵感、模型设置与试用限制。', prompt: '说明我应该如何使用知源完成文献研究，并检查目前准备情况。' },
  { id: 'read', title: '文献精读', description: '按实际原文梳理问题、方法、证据、局限和后续阅读。', prompt: '精读选中的文献，给出研究问题、方法、主要发现、局限与原文依据。' },
  { id: 'compare', title: '多篇对比', description: '对比研究对象、方法与结论，并标明缺失证据。', prompt: '比较选中文献的研究问题、方法、结论及分歧，标明各篇原文依据。' },
  { id: 'review', title: '综述草稿', description: '从已读文献生成有来源的综述提纲和草稿。', prompt: '基于选中文献形成综述提纲和草稿，区分文献结论与我的研究建议。' },
  { id: 'graph', title: '图谱助手', description: '查询概念与关系，预览图谱构建或编辑操作。', prompt: '检查当前文献与图谱，建议如何构建或改进知识图谱。' },
  { id: 'ideas', title: '灵感整理', description: '把阅读结论整理成可确认保存的灵感。', prompt: '从当前文献提出可研究的问题，并准备保存为灵感供我确认。' },
  { id: 'projects', title: '项目管家', description: '查看、创建、重命名和切换研究项目。', prompt: '查看我的研究项目，帮我整理当前项目中的文献与灵感。' }
];

export const SITE_GUIDE = `知源是文献、知识图谱和灵感工作台。文献页支持导入 PDF、TXT、Markdown、DOCX、PPTX、图片；扫描件通过 OCR 提取文字，解析后需核对文字质量。图谱页展示文献概念、层级和关系，支持手动编辑、构建及跨文献关联。灵感页保存笔记、标签和层级，并可关联图谱。模型设置区分通用 LLM 和图谱 KG 模型；Agent 使用通用 LLM。云端模型通常需要用户自己的 API Key 和准确模型名；本地桌面版可连接 Ollama，公网试验服务器不能直接连接用户电脑的 localhost。Agent 不会读取或展示密钥、运行代码、浏览任意网址或操控操作系统。导入需要用户选择文件；导出、页面切换、打开设置由前端完成。所有资料修改必须先展示精确动作，用户确认后才能执行。删除文献会移除相关图谱节点；删除灵感也会删除其子灵感。免费公网试验空间可能随服务重启清空，应及时导出。历史保存在当前浏览器，模型每轮只收到有限近期历史和检索片段，不能承诺无限记忆或通读了未读取的全文。`;

export const TOOL_DESCRIPTIONS = [
  ['documents.list', '列出当前项目文献 {offset?,limit?}'],
  ['documents.read', '按字符偏移读取原文 {docId,offset?,limit?}；返回引用编号'],
  ['documents.search', '原文关键词检索 {query,docIds?,limit?}'],
  ['graph.query', '查询图谱 {query?,limit?}，空query查看概览'],
  ['ideas.list', '列出灵感 {query?,limit?}'], ['projects.list', '列出项目 {}'], ['help', '网站说明 {}'],
  ['graph.build', '重建选定文献图谱 {docIds:[真实文献id],mode?:offline|ai}；默认按当前KG配置，ai可能消耗额度'],
  ['node.create', '添加概念 {content,type?}'], ['node.update', '编辑节点 {id,content,type?}'], ['node.delete', '删除节点及关联边 {id}'],
  ['edge.create', '创建关系 {from,to,type?}'], ['edge.update', '修改关系 {from,to,type,newType}'], ['edge.delete', '删除关系 {from,to,type}'],
  ['idea.create', '创建灵感 {title,content,tags?,parentId?}'], ['idea.update', '编辑灵感 {id,title?,content?,tags?}'], ['idea.delete', '删除灵感及子灵感 {id}'],
  ['document.delete', '删除文献及相关节点 {id}'], ['project.create', '新建项目 {name}'], ['project.rename', '重命名项目 {id,name}'], ['project.switch', '切换项目 {projectId}，必须为本批唯一动作'],
  ['ui.navigate', '打开页面 {page:literature|graph|ideas}'], ['ui.import', '打开用户文件选择 {}'], ['ui.export', '导出当前项目 {}'], ['ui.settings', '打开模型设置 {}']
];
