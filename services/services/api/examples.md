# Knowledge IDE API 示例

## POST /parse
解析文档，返回 docId 与章节。

### 请求
```json
{ "name": "notes.md", "content": "# 光学\n## 折射定律\n折射定律描述光线偏折。", "type": "markdown" }
```

### 响应
```json
{
  "docId": "doc-7f3a",
  "type": "markdown",
  "name": "notes.md",
  "sections": [{"id": "ch1-1", "title": "折射定律", "content": "...", "keywords": []}],
  "meta": {"docId": "doc-7f3a", "type": "markdown", "name": "notes.md", "size": 30, "parsedAt": 1700000000000},
  "rawText": "# 光学\n## 折射定律\n..."
}
```

## POST /extract
对指定文档抽取实体/关键词。

### 请求
```json
{ "docId": "doc-7f3a", "topN": 10 }
```
或直接传文本：
```json
{ "text": "折射定律是光学基本定律", "topN": 10 }
```

### 响应
```json
{
  "docId": "doc-7f3a",
  "entities": [{"term": "折射定律", "score": 3, "source": "tfidf", "docId": "doc-7f3a"}]
}
```

## POST /graph/build
触发知识图谱构建（全量）。

### 请求
```json
{ "documents": [{"name": "a.md", "content": "折射定律光学"}, {"name": "b.md", "content": "量子力学波函数"}], "options": {"mergeThreshold": 0.85} }
```

### 响应
```json
{
  "nodes": [{"id": "concept-1", "type": "concept", "content": "折射定律", "weight": 1}],
  "edges": [{"from": "concept-1", "to": "doc-1", "type": "belong", "weight": 1}],
  "stats": {"nodeCount": 5, "edgeCount": 4, "mergedCount": 0, "crossLinks": 1}
}
```

## GET /graph/query
图查询（邻居/路径/搜索）。

### 邻居查询
`GET /graph/query?action=neighbors&nodeId=concept-1&depth=2`
```json
{ "neighbors": [{"node": {"id": "concept-2", "type": "concept", "content": "全反射"}, "depth": 1, "path": ["concept-1", "concept-2"]}] }
```

### 路径查询
`GET /graph/query?action=path&from=concept-1&to=concept-3`
```json
{ "path": {"path": ["concept-1", "concept-2", "concept-3"], "edges": [{"from": "concept-1", "to": "concept-2", "type": "derive"}]} }
```

### 内容搜索
`GET /graph/query?action=search&query=折射&limit=5`
```json
{ "results": [{"id": "concept-1", "type": "concept", "content": "折射定律", "weight": 3, "_score": 1}] }
```

## POST /match
三层匹配查询。

### 请求
```json
{ "query": "折射定律的应用", "strategy": "hybrid", "topN": 5 }
```

### 响应
```json
{
  "query": "折射定律的应用",
  "strategy": "hybrid",
  "results": [{"docId": "doc-7f3a", "sectionId": "ch1-1", "score": 0.72, "breakdown": {"tfidf": 0.8, "semantic": 0.7, "graph": 0.6}}]
}
```
