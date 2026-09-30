import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeTest, { after } from 'node:test';
import http from 'node:http';
// Isolated synthetic workspace; no user files, credentials or external models.
const base = new URL('../', import.meta.url).href;
const dataDir = mkdtempSync(join(tmpdir(), 'knowsource-agent-test-'));
process.env.KNOWLEDGE_IDE_DATA_DIR = dataDir;
process.env.KNOWLEDGE_IDE_NO_PERSIST = '1';
process.env.KNOWLEDGE_IDE_API_TOKEN = '';
process.env.KNOWLEDGE_IDE_HOSTED_TRIAL = '0';
const { storage, getCurrentProjectId, createProject, switchProject } = await import(base + 'services/storage.js');
const { setLLMProvider, createLLMProvider } = await import(base + 'services/llm-provider.js');
const agent = await import(base + 'services/agent/runtime.js');
const { readTool } = await import(base + 'services/agent/tools.js');
const { parseAgentReply } = await import(base + 'services/agent/protocol.js');
async function test(name, fn) {
    await nodeTest(name, async () => {
        try {
            await fn();
        }
        finally {
            for (const runId of tracked)
                agent.cancel({ runId });
        }
    });
}
after(() => rmSync(dataDir, { recursive: true, force: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tracked = [];
function seed() {
    storage.documents.clear();
    storage.ideas.clear();
    storage.graph = { nodes: [], edges: [], stats: {} };
    storage.taskProgress = { status: 'idle' };
    storage.building = false;
    for (const [id, raw] of [['doc-selected', '\n--- 第1页 ---\n课程重点：条件概率。\n--- 第2页 ---\n贝叶斯定理：P(A|B)=P(B|A)P(A)/P(B)。\n'.repeat(50)], ['doc-other', '不可访问的另一份课程资料']])
        storage.documents.set(id, { id, docId: id, name: id + '.pdf', rawText: raw, meta: { type: 'pdf', totalPages: 2 } });
}
function mock(replies) {
    const calls = [];
    const provider = { name: 'local-qa-mock', model: 'deterministic-protocol', config: {}, capabilities: { contextWindow: 128000, supportsJsonMode: true }, async complete(prompt, options) {
            calls.push({ prompt: JSON.parse(prompt), options });
            const value = typeof replies === 'function' ? await replies(calls.length, calls.at(-1)) : replies[Math.min(calls.length - 1, replies.length - 1)];
            return typeof value === 'string' ? value : JSON.stringify(value);
        } };
    setLLMProvider(provider);
    return calls;
}
async function settled(runId) {
    for (let i = 0; i < 500; i++) {
        const s = agent.status({ runId });
        if (s.status !== 'running')
            return s;
        await sleep(2);
    }
    throw new Error('run did not settle');
}
function start(extra = {}) {
    const r = agent.start({ message: '根据课程重点帮我练习，并引用原文证据。', projectId: getCurrentProjectId(), documentIds: ['doc-selected'], ...extra });
    assert.ok(r.runId, JSON.stringify(r));
    tracked.push(r.runId);
    return r.runId;
}
function approve(s) {
    return agent.confirm({ runId: s.runId, actionIds: s.actions.filter(a => a.status === 'pending').map(a => a.id) });
}
const action = (key, title, extra = {}) => ({ key, tool: 'idea.create', args: { title, content: '基于课程重点生成的练习内容', ...extra } });
seed();
await test('no model rejects Agent instead of fake success', async () => {
    setLLMProvider(createLLMProvider('stub'));
    const r = agent.start({ message: '出题', projectId: getCurrentProjectId() });
    assert.equal(r.success, false);
    assert.match(r.error, /真实/);
    return r;
});
await test('parser accepts valid fenced/nested JSON but rejects truncation and oversized output', () => {
    assert.deepEqual(parseAgentReply('```json\n{"answer":"{quoted}"}\n```'), { answer: '{quoted}' });
    assert.throws(() => parseAgentReply('{"actions":['));
    assert.throws(() => parseAgentReply(' '.repeat(90001) + '{}'));
    return true;
});
await test('document list/read/search honor selected scope; coverage merges overlaps', async () => {
    const r = { documentIds: ['doc-selected'], evidence: [] };
    const list = await readTool(r, 'documents.list');
    assert.equal(list.total, 1);
    await assert.rejects(() => readTool(r, 'documents.read', { docId: 'doc-other' }), /范围/);
    assert.equal((await readTool(r, 'documents.search', { query: '不可访问' })).matches.length, 0);
    await readTool(r, 'documents.read', { docId: 'doc-selected', offset: 0, limit: 100 });
    const b = await readTool(r, 'documents.read', { docId: 'doc-selected', offset: 50, limit: 100 });
    assert.equal(b.coverage.readCharacters, 150);
    return b.coverage;
});
await test('fabricated citation IDs discarded and invented quote replaced with actual source', async () => {
    mock([{ answer: '学习建议', citations: [{ sourceId: 'S1', excerpt: '模型伪造文字' }, { sourceId: 'S999', excerpt: '不存在' }] }]);
    const s = await settled(start());
    assert.equal(s.status, 'completed');
    assert.equal(s.citations.length, 1);
    assert.ok(storage.documents.get('doc-selected').rawText.includes(s.citations[0].excerpt));
    return { citation: s.citations[0], claim: 'Source text verified, but no structured page number or page navigation' };
});
await test('all batch writes require confirmation; subset/forged/repeated confirmation refused; $ref uses real IDs', async () => {
    seed();
    const calls = mock([{ answer: '请确认保存父子练习', actions: [action('parent', '课程重点练习'), action('child', '条件概率练习', { parentId: { $ref: 'parent' } })] }, { answer: '完成', actions: [] }]);
    const s = await settled(start());
    assert.equal(s.status, 'awaiting_confirmation');
    assert.equal(storage.ideas.size, 0);
    assert.equal(agent.confirm({ runId: s.runId, actionIds: [s.actions[0].id] }).success, false);
    assert.equal(agent.confirm({ runId: s.runId, actionIds: ['forged', s.actions[0].id] }).success, false);
    assert.equal(approve(s).status, 'running');
    assert.equal(approve(s).success, false);
    const end = await settled(s.runId);
    assert.equal(end.status, 'completed');
    assert.equal(storage.ideas.size, 2);
    const parent = end.actions[0].result.createdId, child = storage.ideas.get(end.actions[1].result.createdId);
    assert.equal(child.parentId, parent);
    assert.equal(calls[1].prompt.operationJournal[0].result.createdId, parent);
    return { statuses: end.actions.map(a => a.status), parentId: parent, childParentId: child.parentId };
});
await test('later batches ask again and include previous operation journal', async () => {
    seed();
    mock([{ answer: '第一批', actions: [action('one', '第一批')] }, { answer: '第二批', actions: [action('two', '第二批')] }, { answer: '最终完成' }]);
    let s = await settled(start());
    approve(s);
    s = await settled(s.runId);
    assert.equal(s.status, 'awaiting_confirmation');
    assert.equal(storage.ideas.size, 1);
    assert.equal(s.phase, 2);
    approve(s);
    s = await settled(s.runId);
    assert.equal(s.status, 'completed');
    assert.equal(storage.ideas.size, 2);
    return { phases: s.phase, rounds: s.rounds };
});
await test('cancel pending proposal executes nothing and does not allow confirm', async () => {
    seed();
    mock([{ answer: '等待确认', actions: [action('one', '不能写入')] }]);
    const s = await settled(start());
    const c = agent.cancel({ runId: s.runId });
    assert.equal(c.status, 'cancelled');
    assert.equal(c.actions[0].status, 'skipped');
    assert.equal(approve(s).success, false);
    assert.equal(storage.ideas.size, 0);
    return c.status;
});
await test('cancel during delayed model aborts and releases busy lock without write', async () => {
    seed();
    let receivedSignal;
    mock(async (n, { options }) => {
        receivedSignal = options.signal;
        await new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('test aborted', 'AbortError')), { once: true });
        });
    });
    const id = start();
    while (!receivedSignal)
        await sleep(2);
    assert.equal(agent.agentProjectLock().locked, true);
    agent.cancel({ runId: id });
    const end = await settled(id);
    assert.equal(end.status, 'cancelled');
    assert.equal(receivedSignal.aborted, true);
    assert.equal(agent.agentProjectLock().locked, false);
    assert.equal(storage.ideas.size, 0);
    return { status: end.status, rounds: end.rounds };
});
await test('changed data invalidates saved confirmation fingerprint', async () => {
    seed();
    mock([{ answer: '删除选择文献', actions: [{ key: 'delete_doc', tool: 'document.delete', args: { id: 'doc-selected' } }] }]);
    const s = await settled(start());
    storage.documents.set('new-doc', { docId: 'new-doc', name: '新文档', rawText: '新内容' });
    assert.equal(approve(s).success, false);
    assert.equal(agent.status({ runId: s.runId }).status, 'failed');
    assert.equal(storage.documents.has('doc-selected'), true);
    return agent.status({ runId: s.runId }).error;
});
await test('write disguised as read is rejected without mutation', async () => {
    seed();
    const calls = mock([{ toolCalls: [{ tool: 'idea.create', args: { title: '绕过确认', content: '不应该保存' } }] }, { answer: '改为只读结论' }]);
    const s = await settled(start());
    assert.equal(s.status, 'completed');
    assert.equal(storage.ideas.size, 0);
    assert.equal(s.steps.filter(x => x.status === 'failed').length, 1);
    assert.match(calls[1].prompt.untrustedToolResults.at(-1).error, /确认/);
    return s.steps.find(x => x.status === 'failed');
});
await test('invalid JSON repairs at most once then fails without writes', async () => {
    seed();
    const calls = mock(['{"actions":[']);
    const s = await settled(start());
    assert.equal(s.status, 'failed');
    assert.equal(calls.length, 2);
    assert.equal(storage.ideas.size, 0);
    return { rounds: s.rounds, error: s.error };
});
await test('invalid action is returned to model and never executes; whole batch max 24 enforced', async () => {
    seed();
    const calls = mock([{ answer: '非法工具', actions: [{ key: 'hack', tool: 'shell.execute', args: { command: 'anything' } }] }, { answer: '过大批次', actions: Array.from({ length: 25 }, (_, i) => action('key' + i, '练习' + i)) }, { answer: '不执行' }]);
    const s = await settled(start());
    assert.equal(s.status, 'completed');
    assert.equal(storage.ideas.size, 0);
    assert.equal(calls.length, 3);
    return calls[2].prompt.untrustedToolResults.filter(x => x.tool === 'protocol.validation');
});
await test('18-call budget stops a model that continuously requests reads', async () => {
    seed();
    const calls = mock([{ toolCalls: [{ tool: 'help', args: {} }] }]);
    const s = await settled(start());
    assert.equal(s.status, 'failed');
    assert.equal(calls.length, 18);
    return { rounds: s.rounds, error: s.error };
});
await test('message/history/document selections bounded before model', async () => {
    seed();
    mock([{ answer: '结束' }]);
    assert.equal(agent.start({ message: 'a'.repeat(4001), projectId: getCurrentProjectId() }).success, false);
    for (let i = 0; i < 15; i++)
        storage.documents.set('d' + i, { docId: 'd' + i, rawText: '测试', name: '文档' + i });
    const calls = mock([{ answer: '结束' }]);
    const s = await settled(start({ documentIds: Array.from({ length: 15 }, (_, i) => 'd' + i), history: Array.from({ length: 30 }, (_, i) => ({ role: i === 29 ? 'system' : 'user', content: 'a'.repeat(2000) })) }));
    const p = calls[0].prompt;
    assert.equal(p.selectedDocumentIds.length, 12);
    assert.ok(p.recentHistory.length <= 16);
    assert.ok(p.recentHistory.every(x => x.role === 'user' && x.content.length <= 1800));
    assert.ok(p.recentHistory.reduce((n, x) => n + x.content.length, 0) <= 7000);
    return { selected: p.selectedDocumentIds.length, historyMessages: p.recentHistory.length, historyCharacters: p.recentHistory.reduce((n, x) => n + x.content.length, 0) };
});
await test('confirm disallowed while switched away; cancellation remains available', async () => {
    seed();
    const old = getCurrentProjectId();
    const other = await createProject('Agent QA other project');
    mock([{ answer: '等待保存', actions: [action('one', '只应该存在原项目')] }]);
    const s = await settled(start());
    await switchProject(other.id);
    assert.equal(approve(s).success, false);
    assert.equal(storage.ideas.size, 0);
    assert.equal(agent.cancel({ runId: s.runId }).status, 'cancelled');
    await switchProject(old);
    return true;
});
await test('local HTTP mock validates actual OpenAI adapter JSON, truncated repair, cancellation', async () => {
    seed();
    const requests = [];
    let next = 'truncated';
    const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const b of req)
            raw += b;
        const body = JSON.parse(raw);
        requests.push(body);
        if (next === 'delay') {
            res.on('close', () => {
            });
            return;
        }
        const bad = next === 'truncated';
        next = 'normal';
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: bad ? '{"answer":"partial"}' : '{"answer":"本地模拟协议完成"}' }, finish_reason: bad ? 'length' : 'stop' }] }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
        setLLMProvider(createLLMProvider('openai', { model: 'local-protocol-test', apiKey: 'fake-local-test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }));
        let s = await settled(start());
        assert.equal(s.status, 'completed');
        assert.equal(s.rounds, 2);
        assert.equal(requests[0].response_format.type, 'json_object');
        assert.equal(requests[0].max_tokens, 6000);
        assert.equal(requests[1].max_tokens, 8000);
        next = 'delay';
        const id = start();
        while (requests.length < 3)
            await sleep(2);
        agent.cancel({ runId: id });
        s = await settled(id);
        assert.equal(s.status, 'cancelled');
        return { endpoint: 'loopback only', requests: requests.length, jsonMode: true, truncatedRepairRounds: 2, cancel: s.status };
    }
    finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
});
await test('cancel during first mutation preserves completed operation and skips rest of batch', async () => {
    seed();
    mock([{ answer: '确认两项', actions: [action('one', '保留第一项'), action('two', '不得执行第二项')] }]);
    const s = await settled(start());
    const original = storage.ideas.set;
    storage.ideas.set = function (...args) {
        const r = original(...args);
        agent.cancel({ runId: s.runId });
        return r;
    };
    try {
        approve(s);
        const end = await settled(s.runId);
        assert.equal(end.status, 'cancelled');
        assert.equal(storage.ideas.size, 1);
        assert.equal(end.actions[0].status, 'completed');
        assert.equal(end.actions[1].status, 'skipped');
        return { status: end.status, actions: end.actions.map(a => a.status) };
    }
    finally {
        delete storage.ideas.set;
    }
});
await test('HTTP status preserves failed snapshot as HTTP 200; unknown run is 404; busy writes blocked', async () => {
    seed();
    const { handleHttpRequest } = await import(base + 'services/api/router.js');
    const server = http.createServer(handleHttpRequest);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        mock(['{bad']);
        let s = await settled(start());
        let response = await fetch(origin + '/agent/status?runId=' + s.runId);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.status, 'failed');
        assert.equal(body.success, true);
        assert.ok(body.error);
        response = await fetch(origin + '/agent/status?runId=unknown');
        assert.equal(response.status, 404);
        let options;
        mock(async (n, c) => {
            options = c.options;
            return await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
        });
        const id = start();
        while (!options)
            await sleep(1);
        response = await fetch(origin + '/ideas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'blocked', content: 'blocked' }) });
        assert.equal(response.status, 409);
        assert.equal(storage.ideas.size, 0);
        agent.cancel({ runId: id });
        await settled(id);
        return { failedSnapshotHttpStatus: 200, unknownRunStatus: 404, busyMutationStatus: 409 };
    }
    finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
});
await test('lost confirmation acknowledgment can be reconciled through status without repeating mutation', async () => {
    seed();
    const { handleHttpRequest } = await import(base + 'services/api/router.js');
    const server = http.createServer(handleHttpRequest);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        mock([{ answer: '确认保存', actions: [action('once', '只保存一次')] }, { answer: '已保存' }]);
        const s = await settled(start());
        const body = JSON.stringify({ runId: s.runId, actionIds: s.actions.map(a => a.id) });
        const response = await fetch(origin + '/agent/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        await response.arrayBuffer(); /* simulate client dropping successful acknowledgment */
        await settled(s.runId);
        const reconciled = await (await fetch(origin + '/agent/status?runId=' + s.runId)).json();
        assert.equal(reconciled.status, 'completed');
        assert.equal(storage.ideas.size, 1);
        const repeat = await fetch(origin + '/agent/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(repeat.status, 400);
        assert.equal(storage.ideas.size, 1);
        return { reconciled: reconciled.status, repeatHttp: repeat.status, writes: storage.ideas.size };
    }
    finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
});
