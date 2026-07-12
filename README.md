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
- 可视化图谱：方形节点 + 颜色分层 + 手动增删边 + 右键编辑

### LLM 透明化（提示词实验室）
- 所有 16 个 LLM 任务的提示词模板**运行前即可查看**
- 用户可直接编辑模板原文，保存后立即生效
- 运行测试后展示**渲染后的提示词**（模板占位符已替换为实际内容）
- 每次调用（包括手动测试）都会写入调用日志，可回溯完整提示词和模型响应

### 灵感管理
- 随时记录研究灵感，关联知识图谱节点
- 基于图谱的智能推荐
- 多标签分类与搜索

### 模型配置
- **Ollama**（本地模型，支持 qwen2.5、llama3 等，推荐科研使用）
- **OpenAI 兼容**（DeepSeek / SiliconFlow / OpenRouter / Moonshot / 通义千问 / 智谱 GLM）
- **HuggingFace**
- **Stub**（无网络回退，基于规则）

## 截图

> 截图将在正式 Release 中补充

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

## 快速开始

### 下载安装

1. 从 [Releases](https://github.com/YYZ457/KnowSource/releases) 下载最新版安装包
   - Windows: `知源-Setup-x.x.x.exe`
   - macOS: `知源-x.x.x.dmg`
   - Linux: `知源-x.x.x.AppImage`
2. 运行安装程序，选择安装目录
3. 启动"知源"

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/YYZ457/KnowSource.git
cd KnowSource

# 安装依赖
npm install

# 开发模式（前端 + 后端）
npm run dev

# Electron 开发模式（前端 + 后端 + Electron 窗口）
npm run dev:electron

# 构建前端
npm run build

# 打包桌面安装包
npm run dist          # Windows
npm run dist:mac      # macOS
npm run dist:linux    # Linux
npm run dist:all      # 全平台
```

## 配置指南

### LLM 配置

首次使用时，点击右上角齿轮图标 → "模型配置"：

#### 本地模型（推荐，免费离线）

1. 安装 [Ollama](https://ollama.com)
2. 下载模型：`ollama pull qwen2.5:1.5b`（轻量，推荐入门）或 `ollama pull deepseek-r1:7b`（更强）
3. 在知源设置中选择 Provider = Ollama，填入 Base URL（默认 `http://127.0.0.1:11434`）
4. 输入模型名称（如 `qwen2.5:1.5b`）

#### 云端模型

| 厂商 | API Key 获取 | Base URL |
|------|-------------|----------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | `https://api.deepseek.com/v1` |
| OpenAI | [platform.openai.com](https://platform.openai.com) | `https://api.openai.com/v1` |
| 通义千问 | [dashscope.aliyun.com](https://dashscope.aliyun.com) | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 智谱 GLM | [open.bigmodel.cn](https://open.bigmodel.cn) | `https://open.bigmodel.cn/api/paas/v4` |
| SiliconFlow | [siliconflow.cn](https://siliconflow.cn) | `https://api.siliconflow.cn/v1` |

#### Stub 模式

无需网络和 API Key，基于规则抽取术语，适合快速体验功能流程。

### OCR 配置（可选）

如需对扫描版 PDF 进行 OCR 文字识别：
1. 下载 `chi_sim.traineddata`（中文）和 `eng.traineddata`（英文）
2. 放置在应用根目录或数据目录下

## 使用指南

### 文献视图
- 拖拽文件到左侧面板或点击"导入"按钮上传文档
- 点击文档卡片可预览内容，支持按页浏览
- 顶部搜索栏可全文搜索，结果按页定位

### 图谱视图
- 点击"构建图谱"按钮，选择是否使用 LLM 增强
- 构建完成后自动切换到图谱视图，节点按类型颜色分层
- 右键节点可编辑、删除、关联灵感
- 鼠标悬停高亮关联节点和边
- 滚轮缩放，拖拽平移画布

### 灵感管理
- 点击"灵感"标签记录研究想法
- 可关联到图谱节点，建立灵感与知识的连接
- 支持多标签分类

### 提示词实验室
- 在设置中切换到"提示词模板"标签
- 左侧列表选择 LLM 任务，右侧编辑提示词
- 修改后点击保存，下次调用立即生效
- 点击"恢复内置"可还原默认模板

## 项目结构

```
KnowSource/
├── electron/           # Electron 主进程、预加载脚本
├── renderer/src/       # Vue 3 前端
│   ├── components/     # UI 组件（GraphView, ModelLab, PromptLab 等）
│   ├── api/            # 前端 API 客户端
│   └── stores/         # Pinia 状态管理
├── services/           # 后端服务
│   ├── api/handlers/   # API 路由处理器
│   ├── llm-provider.js # LLM 适配器
│   └── storage.js      # 数据持久化
├── core/               # 纯逻辑引擎
│   ├── prompts/        # 提示词系统
│   ├── graph/          # 图谱构建
│   ├── extractor/      # 文档抽取
│   ├── matcher/        # 混合匹配引擎
│   └── parser/         # 文档解析
├── build/              # 应用图标
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

## 故障排查

<details>
<summary>启动时提示"端口 8000 被占用"</summary>

其他程序占用了后端端口。修改 `PORT` 环境变量或在命令行设置：`set PORT=8001 && npm run dev`
</details>

<details>
<summary>OCR 识别结果为空或报错</summary>

确保 `chi_sim.traineddata`（中文）和 `eng.traineddata`（英文）文件存在于应用目录。可从 [tessdata](https://github.com/tesseract-ocr/tessdata) 下载。
</details>

<details>
<summary>Ollama 连接失败</summary>

1. 确认 Ollama 已安装并运行：`ollama serve`
2. 确认端口可访问：浏览器打开 `http://127.0.0.1:11434`
3. 确认模型已下载：`ollama list`
</details>

<details>
<summary>LLM 调用超时</summary>

- 弱模型（1.5B 参数）在复杂文本上可能超时，尝试降低 `maxTerms` 或使用更强的模型
- 云端模型检查 API Key 是否有效，网络是否可达
</details>

## 贡献

欢迎提交 Issue 和 Pull Request！请阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
