export const AGENT_SKILLS = [
  { id: 'help', title: '知源使用向导', description: '解释文献、图谱、灵感、模型设置与试用限制。', prompt: '说明我应该如何使用知源完成文献研究，并检查目前准备情况。' },
  { id: 'read', title: '文献精读', description: '按实际原文梳理问题、方法、证据、局限和后续阅读。', prompt: '精读选中的文献，给出研究问题、方法、主要发现、局限与原文依据。' },
  { id: 'compare', title: '多篇对比', description: '对比研究对象、方法与结论，并标明缺失证据。', prompt: '比较选中文献的研究问题、方法、结论及分歧，标明各篇原文依据。' },
  { id: 'review', title: '综述草稿', description: '从已读文献生成有来源的综述提纲和草稿。', prompt: '基于选中文献形成综述提纲和草稿，区分文献结论与我的研究建议。' },
  { id: 'graph', title: '图谱助手', description: '查询概念与关系，预览图谱构建或编辑操作。', prompt: '检查当前文献与图谱，建议如何构建或改进知识图谱。' },
  { id: 'ideas', title: '灵感整理', description: '把阅读结论整理成可确认保存的灵感。', prompt: '从当前文献提出可研究的问题，并准备保存为灵感供我确认。' },
  { id: 'study-plan', title: '复习计划工作流', description: '检查文本、梳理专题、分阶段创建父子灵感并关联图谱。', prompt: '先检查选中文献的文本与公式风险并读取原文，按有依据的专题建立复习计划和子灵感，关联图谱中的真实节点；分阶段展示操作供我确认，完成后提示导出。' },
  { id: 'projects', title: '项目管家', description: '查看、创建、重命名和切换研究项目。', prompt: '查看我的研究项目，帮我整理当前项目中的文献与灵感。' }
];

export const SITE_GUIDE = `知源是文献、知识图谱和灵感工作台。文献页支持导入 PDF、TXT、Markdown、DOCX、PPTX、图片；扫描件通过 OCR 提取文字，解析后需核对文字质量。图谱页展示文献概念、层级和关系，支持手动编辑、构建及跨文献关联。灵感页保存笔记、标签和层级，并可关联图谱。模型设置区分通用 LLM 和图谱 KG 模型；Agent 使用通用 LLM。云端模型通常需要用户自己的 API Key 和准确模型名；本地桌面版可连接 Ollama，公网试验服务器不能直接连接用户电脑的 localhost。Agent 不会读取或展示密钥、运行代码、浏览任意网址或操控操作系统。导入需要用户选择文件；导出、页面切换、打开设置由前端完成。所有资料修改必须先展示精确动作，用户确认后才能执行。删除文献会移除相关图谱节点；删除灵感也会删除其子灵感。免费公网试验空间可能随服务重启清空，应及时导出。历史保存在当前浏览器，模型每轮只收到有限近期历史和检索片段，不能承诺无限记忆或通读了未读取的全文。`;

export const TOOL_DESCRIPTIONS = [
  ['documents.list', '列出当前项目文献 {offset?,limit?}'],
  ['documents.inspect', '检查已解析文本 {docId}；返回字符数、章节、OCR/公式风险、本轮已读覆盖率。不能据此声称核对原 PDF/图片或确认公式完整'],
  ['documents.read', '按字符偏移读取原文 {docId,offset?,limit?}，每次最多4000字符；返回引用编号、nextOffset、hasMore、coverage。需要通读时按nextOffset继续，不能以片段代替全文'],
  ['documents.search', '原文关键词检索 {query,docIds?,limit?}'],
  ['graph.query', '分页查询图谱 {query?,offset?,limit?}，空query查看概览；返回真实节点ID及关系'],
  ['ideas.list', '分页列出灵感 {query?,parentId?,offset?,limit?}；parentId:null只查根灵感；含层级与关联节点ID'], ['projects.list', '列出项目 {}'], ['help', '网站说明 {}'],
  ['graph.build', '重建选定文献图谱 {docIds:[真实文献id],mode?:offline|ai}；默认按当前KG配置，ai可能消耗额度'],
  ['node.create', '添加概念 {content,type?}'], ['node.update', '编辑节点 {id,content,type?}'], ['node.delete', '删除节点及关联边 {id}'],
  ['edge.create', '创建关系 {from,to,type?}'], ['edge.update', '修改关系 {from,to,type,newType}'], ['edge.delete', '删除关系 {from,to,type}'],
  ['idea.create', '创建灵感 {title,content,tags?,parentId?}；新灵感自动加入图谱，父子关系自动建立。parentId可为前序创建动作引用'], ['idea.update', '编辑灵感 {id,title?,content?,tags?,parentId?}；parentId:null移至根层级'], ['idea.delete', '删除灵感及子灵感 {id}'],
  ['idea.link', '关联灵感与已有图谱节点 {ideaId,nodeId}；ID可为真实ID或前序创建动作引用'], ['idea.unlink', '解除灵感与图谱节点关联 {ideaId,nodeId}'],
  ['document.delete', '删除文献及相关节点 {id}'], ['project.create', '新建项目 {name}'], ['project.rename', '重命名项目 {id,name}'], ['project.switch', '切换项目 {projectId}，必须为本批唯一动作'],
  ['ui.navigate', '打开页面 {page:literature|graph|ideas}'], ['ui.import', '打开用户文件选择 {}'], ['ui.export', '导出当前项目 {}'], ['ui.settings', '打开模型设置 {}']
];

export const ACTION_REFERENCE_GUIDE = `多步工作先读资料并明确计划，再逐阶段提出精确写操作。每批最多24项动作；不要把整项任务缩减为教用户手动点击。每个action可指定唯一key（字母开头，字母数字下划线横线，最多64字符），ID参数可用{"$ref":"前序action的key"}引用同一任务中前面已创建对象的ID。例如先{"key":"plan","tool":"idea.create","args":{"title":"复习计划","content":"总计划"}}，再{"key":"topic1","tool":"idea.create","args":{"title":"专题一","content":"有依据的复习内容","parentId":{"$ref":"plan"}}}，再用idea.link把topic1关联真实图谱nodeId。不得引用后续动作，不得自己编造ID，内容与标题不能使用引用。引用仅支持node.create、idea.create、project.create的成功创建结果；依赖动作被跳过或失败时不执行后续依赖。构建图谱后先查询真实节点，再生成关联动作。用户确认的是当前展示的服务端动作；下一阶段新动作仍须重新确认。返回操作结果后先核对实际已完成事项，再继续未完成阶段，避免重复创建。已解析全文可读不代表原件公式完整；尤其DOCX数学公式可能未被提取，必须诚实保留核对限制。`;
