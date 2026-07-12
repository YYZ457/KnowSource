# 贡献指南

感谢您对知源 (KnowSource) 项目的关注！欢迎提交 Issue 和 Pull Request。

## 开发环境搭建

```bash
git clone https://github.com/YYZ457/KnowSource.git
cd KnowSource
npm install
npm run dev
```

开发模式下会同时启动 Vite 开发服务器（端口 5173）和本地后端（端口 8000），Electron 窗口自动加载开发服务器页面。

## 技术栈

- **前端**: Vue 3 + Vite + D3.js
- **后端**: Node.js (ES Modules)
- **桌面**: Electron 28
- **PDF 解析**: PDF.js + Tesseract.js (OCR)
- **LLM**: Ollama / OpenAI 兼容 API

## 代码规范

- 使用 ES Modules（`import/export`），不使用 CommonJS
- 使用 2 空格缩进
- 函数和变量命名使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- Vue 组件使用 `<script setup>` 语法
- 异步函数必须有错误处理（try-catch 或 .catch）
- 文件操作使用 path.join()，不硬编码路径分隔符

## 提交规范

使用中文提交信息，格式：`[模块] 简短描述`

示例：
- `[图谱] 修复节点拖拽边界检测`
- `[LLM] 添加 Ollama 连接超时处理`
- `[前端] 设置弹窗 Escape 键关闭`

## PR 流程

1. Fork 仓库并创建功能分支
2. 确保代码可正常运行（`npm run dev`）
3. 提交 PR 并描述变更内容

## 项目结构

```
electron/          Electron 主进程
services/          后端服务（API、存储、LLM 适配）
core/              核心逻辑（PDF解析、图谱、匹配、提示词）
renderer/          Vue 前端应用
deploy/            部署同步目录
```

## 测试

```bash
npm test
```

测试文件放在 `tests/` 目录下，使用 Node.js 内置 test runner。
