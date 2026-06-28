# 更新日志

本文件记录知源（KnowSource）项目的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

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
