import { register } from 'node:module';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// 注册模块加载钩子，将 pinia / @/ 别名等映射到本地 mock，
// 这样无需安装前端依赖即可在 Node 环境中测试 store 逻辑。
register(new URL('./module-loader.mjs', import.meta.url).href);

const [
  { useDocumentStore },
  { useGraphStore },
  { useIdeaStore },
  { useProjectStore },
  { client },
  { resetPiniaStores }
] = await Promise.all([
  import('../src/stores/document.js'),
  import('../src/stores/graph.js'),
  import('../src/stores/idea.js'),
  import('../src/stores/project.js'),
  import('../tests/mocks/client.mjs'),
  import('../tests/mocks/pinia.mjs')
]);

function setupGlobalWindow() {
  globalThis.window = { dispatchEvent: () => {} };
}

function resetAll() {
  resetPiniaStores();
  setupGlobalWindow();
  client.listDocuments = async () => [];
  client.getGraphStats = async () => ({ nodes: [], edges: [] });
  client.listIdeas = async () => [];
  client.listProjects = async () => ({ projects: [], currentProjectId: null });
  client.switchProject = async () => ({ success: true });
}

describe('项目切换时的 store 竞态保护', () => {
  beforeEach(resetAll);

  test('document store 丢弃旧项目的延迟响应', async () => {
    const project = useProjectStore();
    project.currentProjectId = 'proj-A';

    const doc = useDocumentStore();
    let resolveA;
    client.listDocuments = async () => new Promise(resolve => { resolveA = resolve; });

    const loadA = doc.loadDocuments();

    // 在 A 请求返回前切换到新项目并发起 B 请求
    project.currentProjectId = 'proj-B';
    client.listDocuments = async () => [makeDoc('doc-B', 'B 文档')];
    const loadB = doc.loadDocuments();

    resolveA([makeDoc('doc-A', 'A 文档')]);
    await Promise.all([loadA, loadB]);

    assert.equal(doc.documents.length, 1, '应只保留新项目的数据');
    assert.equal(doc.documents[0].meta.docId, 'doc-B', '旧项目响应不应覆盖当前数据');
  });

  test('graph store 丢弃旧项目的延迟响应', async () => {
    const project = useProjectStore();
    project.currentProjectId = 'proj-A';

    const graph = useGraphStore();
    let resolveA;
    client.getGraphStats = async () => new Promise(resolve => { resolveA = resolve; });

    const loadA = graph.loadGraph();

    project.currentProjectId = 'proj-B';
    client.getGraphStats = async () => ({ nodes: [{ id: 'node-B' }], edges: [] });
    const loadB = graph.loadGraph();

    resolveA({ nodes: [{ id: 'node-A' }], edges: [] });
    await Promise.all([loadA, loadB]);

    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'node-B');
  });

  test('idea store 丢弃旧项目的延迟响应', async () => {
    const project = useProjectStore();
    project.currentProjectId = 'proj-A';

    const idea = useIdeaStore();
    let resolveA;
    client.listIdeas = async () => new Promise(resolve => { resolveA = resolve; });

    const loadA = idea.loadIdeas();

    project.currentProjectId = 'proj-B';
    client.listIdeas = async () => [{ id: 'idea-B', title: 'B Idea' }];
    const loadB = idea.loadIdeas();

    resolveA([{ id: 'idea-A', title: 'A Idea' }]);
    await Promise.all([loadA, loadB]);

    assert.equal(idea.ideas.length, 1);
    assert.equal(idea.ideas[0].id, 'idea-B');
  });

  test('loadDocuments throwOnError 时异常向上传播', async () => {
    const project = useProjectStore();
    project.currentProjectId = 'proj-A';

    const doc = useDocumentStore();
    client.listDocuments = async () => { throw new Error('网络错误'); };

    await assert.rejects(() => doc.loadDocuments({ throwOnError: true }), /网络错误/);
    assert.equal(doc.loading, false, '异常后 loading 应被重置');
  });

  test('switchProject 中任一 store 加载失败会回滚到原项目数据', async () => {
    const project = useProjectStore();
    project.projects = [
      { id: 'proj-A', name: '项目 A' },
      { id: 'proj-B', name: '项目 B' }
    ];
    project.currentProjectId = 'proj-A';

    const doc = useDocumentStore();
    client.listDocuments = async () => [makeDoc('doc-A', 'A 文档')];
    await doc.loadDocuments();

    // 模拟切到 B 后，loadDocuments 失败，后端回滚到 A
    client.switchProject = async () => ({ success: true });
    client.listProjects = async () => ({
      projects: project.projects,
      currentProjectId: 'proj-A'
    });
    client.listDocuments = async () => {
      if (project.currentProjectId === 'proj-B') {
        throw new Error('项目 B 文档加载失败');
      }
      return [makeDoc('doc-A', 'A 文档')];
    };

    await assert.rejects(() => project.switchProject('proj-B'), /项目 B 文档加载失败/);

    assert.equal(project.currentProjectId, 'proj-A', '失败后应恢复到原项目');
    assert.equal(doc.documents.length, 1, '应重新加载原项目数据');
    assert.equal(doc.documents[0].meta.docId, 'doc-A');
  });
});

function makeDoc(docId, rawText) {
  return {
    meta: { docId },
    sections: [],
    rawText,
    rawBase64: '',
    filePath: '',
    fileSize: 0,
    rawHtml: ''
  };
}
