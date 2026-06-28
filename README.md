# 知源 KnowSource

> 科研人员的多文献阅读、知识网络构建与灵感记录工作台

知源是一款类 VSCode/Obsidian 的知识工作台桌面应用，帮助科研人员高效管理多格式文献、构建跨文档知识图谱、记录研究灵感。

## 核心功能

### 文献管理
- 支持 PDF / Word(.docx) / PPTX / Markdown / OCR 扫描件
- 多项目（多文件夹）管理，可导出/导入项目
- 文档内容搜索（按页定位 + 上下文片段）

### 知识图谱构建
- **无监督路径**：基于 TF-IDF + 语义向量的术语抽取与关联
- **LLM 增强路径**：16 个 LLM 任务覆盖文档分析、术语抽取、图谱构建、标题抽取全链路
- 自适应模型分级（weak/medium/strong），根据模型能力自动调整参数
- 跨文档语义连线，自动发现文档间关联

### LLM 透明化（提示词实验室）
- 所有 16 个 LLM 任务的提示词模板**运行前即可查看**
- 用户可直接编辑模板原文，保存后立即生效
- 运行测试后展示**渲染后的提示词**（模板占位符已替换为实际内容）
- 每次调用（包括手动测试）都会写入调用日志，可回溯完整提示词和模型响应

### 灵感管理（Idea）
- 随时记录研究灵感，关联知识图谱节点
- 基于图谱的智能推荐
- 多标签分类与搜索

### 模型配置
- **Ollama**（本地模型，支持 qwen2.5、llama3 等）
- **OpenAI 兼容**（DeepSeek / SiliconFlow / OpenRouter / Moonshot / 通义千问 / 智谱 GLM）
- **HuggingFace**
- **Stub**（无网络回退）

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 28 |
| 前端 | Vue 3.4 + Vite 5 |
| 后端 | Node.js（内嵌 HTTP 服务） |
| 图谱可视化 | D3.js force |
| PDF 解析 | pdfjs-dist + pdf-parse |
| OCR | tesseract.js |
| 文档解析 | mammoth (Word) / jszip (PPTX) |
| 测试 | Node.js native test runner |

## 快速开始

### 安装

1. 从 [Releases](https://github.com/YYZ457/KnowSource/releases) 下载 `知源 Setup 2.1.0.exe`
2. 运行安装程序，选择安装目录
3. 启动"知源"

### 从源码构建

```bash
# 安装依赖
npm install

# 开发模式（前端 + 后端）
npm run dev

# Electron 开发模式
npm run dev:electron

# 构建前端
npm run build

# 打包桌面安装包
npm run dist

# 运行测试
npm test
```

### 配置 LLM

首次使用时，在"图谱配置"中选择 LLM provider：

- **本地模型**：安装 [Ollama](https://ollama.ai) 后运行 `ollama pull qwen2.5:1.5b`，在配置中选择 Ollama
- **云端模型**：填入 API Key，选择对应厂商（DeepSeek / OpenAI / 通义千问等）

## 项目结构

```
知源-Demo/
├── electron/           # Electron 主进程、预加载脚本
├── renderer/src/       # Vue 3 前端
│   ├── components/     # UI 组件（PromptLab, ModelLab, GraphView 等）
│   ├── api/            # 前端 API 客户端
│   └── styles/         # 全局样式
├── services/           # 后端服务
│   ├── api/handlers/   # API 路由处理器
│   ├── llm-provider.js # LLM 适配器（Ollama/OpenAI/HuggingFace/Stub）
│   └── prompt-store.js # 提示词持久化
├── core/               # 纯逻辑引擎
│   ├── prompts/        # 提示词系统（templates/registry/run-task/logger）
│   ├── graph/          # 图谱构建（llm-extractor, full-extract, crosslink）
│   ├── extractor/      # 文档抽取（标题、术语、试卷概念）
│   └── parser/         # 文档解析（PDF/Word/PPTX/Markdown）
├── tests/              # 单元测试
└── package.json
```

## 16 个 LLM 任务

| 任务 | 说明 |
|------|------|
| `doc-type-detect` | 文档类型识别 |
| `cloud-term-extract` | 云端术语抽取 |
| `term-refine` | 术语质量二次校验 |
| `chunk-term-extract` | 分块术语抽取（弱模型） |
| `chunk-term-extract-strong` | 分块术语抽取（强模型） |
| `specificity-scoring` | 术语特异性评分 |
| `llm-chunking` | LLM 智能分块 |
| `term-normalize` | 术语多轮规范化 |
| `full-graph-extract` | 全量图谱抽取 |
| `relation-infer-r2` | 第二轮关系推断 |
| `crosslink-llm` | 跨文档语义连线 |
| `exam-detect-llm` | 试卷检测 |
| `exam-concept-extract` | 试卷题目概念抽取 |
| `cloud-heading-extract` | 云端标题抽取 |
| `heading-refine` | 标题质量校验 |
| `heading-discover` | 标题发现 |

## 许可证

MIT
