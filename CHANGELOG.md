# 更新日志

本文件记录知源（KnowSource）项目的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

---

## [2.2.0] — 2026-07-03

### UI 重构 + 工程化 + 大量 Bug 修复

#### 新增

- **3 工作流导航**：从 4 标签页改为"文献 / 图谱 / 灵感"3 工作流 + 设置覆盖层
- **图谱可视化重构**：方形节点 + 颜色分层（文档/标题/概念/实体/灵感）+ 手动增删边 + 右键编辑节点 + 展开/收起动画
- **应用图标**：自动生成多平台图标（PNG/ICO/ICNS）
- **跨平台构建**：electron-builder 配置 Windows/macOS/Linux 三平台目标
- **生产就绪文件**：LICENSE、CONTRIBUTING.md、.env.example
- **README 全面重写**：配置指南、使用指南、故障排查、多平台安装说明
- **CSP 运行时白名单**：LLM 配置变更时动态更新 CSP connect-src 白名单

#### 修复（90+ 个 Bug）

- **LLM 解析器**：JSON 对象 `{terms:[...]}` 解析时 candidates 赋为对象导致 `.map()` 崩溃 → 智能提取 terms/keywords 数组
- **LLM 术语过滤**：短文本 `minFullTextCount=2` 过于严格 → 短文本放宽到 1 次
- **switchProject 竞态**：TOCTOU 竞态条件 → 在任何 await 之前设置并发锁
- **embedding provider 切换**：不清除向量库缓存导致维度不匹配 → 切换时自动 clear
- **embedding 维度检测**：无维度一致性校验 → 添加 expectedDimension 记录和校验
- **PDF 逐页错误恢复**：单页异常中断整个解析 → 每页 try-catch 跳过失败页
- **OCR 预览累积器**：无界增长 → 滑动窗口限制 4000 字符
- **vector-store 原子写入**：非原子写入导致损坏 → temp+rename 模式
- **createEdge 自环检测**：缺少 from===to 检查
- **updateEdge 冲突逻辑**：type 未传时误判自身为冲突 → matchedSet 排除自身
- **管线 fallback 覆盖**：catch 块用 `=` 覆盖 full-extract 已成功结果 → 仅在空时填充
- **单文档失败**：一个文档异常中断整批 → per-document try-catch
- **matcher undefined 匹配**：`undefined === undefined` 导致错误 graph 分数
- **空数组 sections**：文档被静默跳过 → `.length > 0` 检查
- **匹配权重归一化**：权重总和不为 1 时分数可超 1.0
- **前端 Escape 键**：SettingsOverlay 和确认对话框无 Escape 关闭
- **IdeaPanel 引用同步**：保存后 selectedIdea 失效 → 同步更新引用
- **ModelLab provider 切换**：未重置 model/apiKey
- **右键菜单边缘定位**：菜单超出画布边界 → 边界裁剪
- **Electron backendStopped**：重启后不重置导致退出时跳过清理
- **Ollama 安装器**：硬编码 Windows → 按平台分支
- **python3 回退**：Mac/Linux 无 python → 先试 python3 再回退

#### 改进

- .gitignore 补充 debug-output*/、state/、.uploads/ 等
- package.json 补充 keywords/repository/homepage/bugs 字段
- test 脚本添加容错（无 tests 目录时跳过）

---

## [2.1.0] — 2026-06-28

### 提示词系统重构

将提示词模板从"运行时捕获"改为"静态模板 + 直接编辑"架构，解决用户打开提示词实验室后看不到模板内容（必须先运行任务才能捕获）的问题。

#### 新增

- **`core/prompts/templates.js`**：集中定义全部 16 个 LLM 任务的内置提示词模板，使用 `{{变量名}}` 占位符语法，应用启动后立即可用
- **`registry.getDefaultPrompts()`**：直接返回所有内置模板，无需任何任务先执行
- **`registry.getEffectiveTemplate(taskId)`**：返回用户覆盖优先的有效模板
- **PromptLab 测试结果区**：运行测试后展示渲染后的 System/User 提示词（模板占位符已替换为实际值）和 LLM 响应，并显示 provider/model/耗时等元信息
- **`testPromptHandler` 日志记录**：手动测试调用现在也会写入调用日志，用户可在日志区查看

#### 变更

- **`registry.resolvePrompt(taskId, { vars })`**：不再接受 `defaultSystem`/`defaultUser` 参数，改为从注册表取有效模板渲染
- **`runLLMTask(provider, taskId, options)`**：移除 `prompt` 参数，改为内部调用 `resolvePrompt` 渲染模板；日志中存储渲染后的提示词
- **PromptLab UI**：从"默认提示词（只读）+ 自定义覆盖"双栏改为单一"提示词模板"编辑区，用户直接编辑模板原文
- **`testPromptHandler`**：接受 `{ taskId, vars }` 参数，使用 `resolvePrompt` 渲染，返回 `renderedSystem`/`renderedUser`
- **Ollama provider**：从 `/api/generate` 改为 `/api/chat` 端点，支持所有现代聊天模型（qwen2.5、llama3 等）

#### 移除

- `registry` 中的 `defaultCache` Map 及运行时捕获机制
- 5 个核心文件中的 `buildXxxPrompt()` 函数（`llm-extractor.js`、`full-extract.js`、`crosslink.js`、`exam-concept-extractor.js`、`llm-headings.js`）
- `runLLMTask` 的 `prompt` 参数和 `options.system` 外部传入

#### 16 个 LLM 任务清单

| 任务 ID | 名称 | 分类 |
|---------|------|------|
| `doc-type-detect` | 文档类型识别 | 文档分析 |
| `cloud-term-extract` | 云端术语抽取 | 术语抽取 |
| `term-refine` | 术语质量二次校验 | 术语抽取 |
| `chunk-term-extract` | 分块术语抽取(弱模型) | 术语抽取 |
| `chunk-term-extract-strong` | 分块术语抽取(强模型) | 术语抽取 |
| `specificity-scoring` | 术语特异性评分 | 术语抽取 |
| `llm-chunking` | LLM 智能分块 | 文档分析 |
| `term-normalize` | 术语多轮规范化 | 术语抽取 |
| `full-graph-extract` | 全量图谱抽取 | 图谱构建 |
| `relation-infer-r2` | 第二轮关系推断 | 图谱构建 |
| `crosslink-llm` | 跨文档语义连线 | 图谱构建 |
| `exam-detect-llm` | 试卷检测 | 试卷分析 |
| `exam-concept-extract` | 试卷题目概念抽取 | 试卷分析 |
| `cloud-heading-extract` | 云端标题抽取 | 标题抽取 |
| `heading-refine` | 标题质量校验 | 标题抽取 |
| `heading-discover` | 标题发现 | 标题抽取 |

### 测试

- 提示词相关测试共 131 个，全部通过
- 新增 6 个 `testPromptHandler` 测试：渲染后提示词返回、失败场景返回、成功/失败/stub 三种场景日志写入
- 修复 `testPromptHandler` 测试套件的 `before` 钩子时序问题

---

## [2.0.0] — 2026-06

### 初始版本

- 多格式文献解析（PDF/Word/PPTX/Markdown/OCR）
- 知识图谱构建（无监督 + LLM 增强双路径）
- 跨文档多策略匹配
- Idea 灵感管理
- 多项目管理
- 模型配置（Ollama/OpenAI 兼容/HuggingFace/Stub）
- 桌面应用（Electron + Vue 3）
