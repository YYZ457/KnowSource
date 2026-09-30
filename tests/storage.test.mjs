import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const storageUrl = new URL('../services/storage.js', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url));

function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'knowsource-storage-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Every run imports a fresh storage module in a separate process, like an app restart.
// Tests never read or write the application's normal data directory.
function runStorage(dir, source, { expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const mod = await import(${JSON.stringify(storageUrl)});
    const { storage, getCurrentProjectId, exportProjectData, importProjectData,
      createProject, deleteProject, switchProject, updateProject, listProjects, setGraph,
      writeRawBuffer, getStorageWriteError, DATA_DIR } = mod;
    const emit = value => console.log('TEST_RESULT:' + JSON.stringify(value));
    ${source}
  `], {
    cwd: root,
    env: { ...process.env, KNOWLEDGE_IDE_DATA_DIR: dir, KNOWLEDGE_IDE_NO_PERSIST: '0' },
    encoding: 'utf8',
    timeout: 20000
  });
  if (expectFailure) {
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    return result;
  }
  assert.equal(result.status, 0, result.error?.stack || result.stdout + result.stderr);
  const output = result.stdout.split('\n').find(line => line.startsWith('TEST_RESULT:'));
  assert.ok(output, result.stdout + result.stderr);
  return JSON.parse(output.slice('TEST_RESULT:'.length));
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function seedProject(dir, { projectsSuffix = '', documentsSuffix = '', documents = [] } = {}) {
  const id = 'proj-fixture';
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, `projects.json${projectsSuffix}`), JSON.stringify({
    lastUsedProjectId: id,
    projects: [{ id, name: 'Recovered project', createdAt: 1, updatedAt: 1 }]
  }));
  writeFileSync(join(dir, id, `documents.json${documentsSuffix}`), JSON.stringify(documents));
  writeFileSync(join(dir, id, 'ideas.json'), '[]');
  writeFileSync(join(dir, id, 'graph.json'), JSON.stringify({ nodes: [], edges: [], stats: {} }));
  return id;
}

test('initial save keeps canonical JSON files, and restart retains the same project', t => {
  const dir = dataDir(t);
  const id = runStorage(dir, 'emit(getCurrentProjectId());');
  assert.equal(readJSON(join(dir, 'projects.json')).lastUsedProjectId, id);
  assert.deepEqual(readJSON(join(dir, id, 'documents.json')), []);
  assert.deepEqual(readJSON(join(dir, id, 'ideas.json')), []);
  assert.deepEqual(readJSON(join(dir, id, 'graph.json')).nodes, []);
  assert.equal(runStorage(dir, 'emit(getCurrentProjectId());'), id);
});

test('debounced saves persist documents, ideas and graph without an export or project switch', t => {
  const dir = dataDir(t);
  const id = runStorage(dir, `
    storage.documents.set('doc-autosaved', { id: 'doc-autosaved', name: 'Autosaved' });
    storage.ideas.set('idea-autosaved', { id: 'idea-autosaved', title: 'Autosaved idea' });
    storage.graph.nodes = [{ id: 'node-autosaved' }];
    storage.graph.stats = { nodeCount: 1 };
    emit(getCurrentProjectId());
  `);
  const restarted = runStorage(dir, `
    emit({ id: getCurrentProjectId(), docs: [...storage.documents.keys()], ideas: [...storage.ideas.keys()], graph: storage.graph });
  `);
  assert.equal(restarted.id, id);
  assert.deepEqual(restarted.docs, ['doc-autosaved']);
  assert.deepEqual(restarted.ideas, ['idea-autosaved']);
  assert.deepEqual(restarted.graph.nodes, [{ id: 'node-autosaved' }]);
  assert.equal(restarted.graph.stats.nodeCount, 1);
});

test('documents, ideas, graph, binary originals and project metadata survive import, switching and restart', t => {
  const dir = dataDir(t);
  const result = runStorage(dir, `
    const sourceId = getCurrentProjectId();
    await updateProject(sourceId, { name: 'Research', description: 'Round trip' });
    const binary = Buffer.from([0, 1, 2, 128, 255]);
    const file = writeRawBuffer('doc-fixture', binary);
    storage.documents.set('doc-fixture', { id: 'doc-fixture', docId: 'doc-fixture', name: 'Paper.pdf', pages: [{ text: 'Attention' }], ...file });
    storage.ideas.set('idea-fixture', { id: 'idea-fixture', title: 'Compare costs', tags: ['test'] });
    setGraph({ nodes: [{ id: 'node-fixture', label: 'Attention' }], edges: [], stats: { nodeCount: 1 } });
    const exported = await exportProjectData(sourceId);
    assert.equal(exported.documents[0].rawBase64, binary.toString('base64'));
    const imported = await importProjectData(exported, 'Round trip copy');
    assert.equal(imported.success, true);
    assert.equal((await listProjects()).projects.find(p => p.id === imported.project.id).documentCount, 1);
    const inactiveExport = await exportProjectData(imported.project.id);
    assert.equal(inactiveExport.documents[0].rawBase64, exported.documents[0].rawBase64);
    assert.deepEqual(inactiveExport.ideas, exported.ideas);
    assert.deepEqual(inactiveExport.graph, exported.graph);
    assert.equal((await switchProject(imported.project.id)).success, true);
    assert.equal(storage.documents.size, 1);
    assert.equal(storage.ideas.size, 1);
    emit({ sourceId, importedId: imported.project.id, exported });
  `);
  const restarted = runStorage(dir, `
    emit({ id: getCurrentProjectId(), data: await exportProjectData(getCurrentProjectId()), projects: await listProjects() });
  `);
  assert.equal(restarted.id, result.importedId);
  assert.equal(restarted.data.project.name, 'Round trip copy');
  assert.equal(restarted.data.project.description, 'Round trip');
  assert.equal(restarted.data.documents[0].rawBase64, result.exported.documents[0].rawBase64);
  assert.deepEqual(restarted.data.documents[0].pages, result.exported.documents[0].pages);
  assert.deepEqual(restarted.data.ideas, result.exported.ideas);
  assert.deepEqual(restarted.data.graph, result.exported.graph);
  assert.equal(restarted.projects.projects.length, 2);
  for (const id of [result.sourceId, result.importedId]) {
    assert.equal(readJSON(join(dir, id, 'documents.json')).length, 1);
    assert.equal(readJSON(join(dir, id, 'documents.json'))[0].rawBase64, undefined);
    assert.deepEqual([...readFileSync(join(dir, id, 'uploads', 'doc-fixture.bin'))], [0, 1, 2, 128, 255]);
  }
});

test('backups retain the three prior versions without moving the canonical file', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    for (const name of ['Version 1', 'Version 2', 'Version 3', 'Version 4']) {
      await updateProject(getCurrentProjectId(), { name });
      assert.equal(JSON.parse(await fs.readFile(join(DATA_DIR, 'projects.json'), 'utf8')).projects[0].name, name);
    }
    emit(true);
  `);
  assert.equal(readJSON(join(dir, 'projects.json')).projects[0].name, 'Version 4');
  for (let i = 1; i <= 3; i++) {
    assert.equal(readJSON(join(dir, `projects.json.backup.${i}`)).projects[0].name, `Version ${4 - i}`);
  }
  assert.equal(readdirSync(dir).some(name => name.includes('.tmp.') || name.endsWith('.backup.4')), false);
});

test('missing canonical files recover from legacy backups and are restored on disk', t => {
  const dir = dataDir(t);
  const docs = [{ id: 'doc-recovered', name: 'Recovered paper' }];
  const id = seedProject(dir, { projectsSuffix: '.backup.1', documentsSuffix: '.backup.1', documents: docs });
  const recovered = runStorage(dir, 'emit({ id: getCurrentProjectId(), docs: [...storage.documents.values()] });');
  assert.equal(recovered.id, id);
  assert.deepEqual(recovered.docs, docs);
  assert.deepEqual(readJSON(join(dir, id, 'documents.json')), docs);
  assert.equal(readJSON(join(dir, 'projects.json')).lastUsedProjectId, id);
});

test('corrupt main and newest backup fall back to an older valid backup', t => {
  const dir = dataDir(t);
  const docs = [{ id: 'doc-recovered', name: 'Older valid paper' }];
  const id = seedProject(dir, { documentsSuffix: '.backup.2', documents: docs });
  const path = join(dir, id, 'documents.json');
  writeFileSync(path, '{broken main');
  writeFileSync(path + '.backup.1', '{broken backup');
  const recovered = runStorage(dir, 'emit([...storage.documents.values()]);');
  assert.deepEqual(recovered, docs);
  assert.deepEqual(readJSON(path), docs);
  assert.ok(readdirSync(join(dir, id)).some(name => name.startsWith('documents.json.corrupt.')));
});

test('a valid legacy .bak is not overwritten by corrupt primary contents', t => {
  const dir = dataDir(t);
  const docs = [{ id: 'doc-legacy', name: 'Legacy backup' }];
  const id = seedProject(dir, { documentsSuffix: '.bak', documents: docs });
  const path = join(dir, id, 'documents.json');
  writeFileSync(path, '{corrupt');
  assert.deepEqual(runStorage(dir, 'emit([...storage.documents.values()]);'), docs);
  assert.deepEqual(readJSON(path + '.bak'), docs);
});

test('unrecoverable corruption fails safely rather than starting with empty data', t => {
  const dir = dataDir(t);
  const id = seedProject(dir);
  const path = join(dir, id, 'documents.json');
  writeFileSync(path, '{unrecoverable');
  runStorage(dir, 'emit([...storage.documents.values()]);', { expectFailure: true });
  assert.equal(readFileSync(path, 'utf8'), '{unrecoverable');
});

test('a failed switch to a corrupt project keeps the previous startup project', t => {
  const dir = dataDir(t);
  const previousId = runStorage(dir, `
    const previousId = getCurrentProjectId();
    storage.documents.set('doc-healthy', { id: 'doc-healthy', name: 'Healthy paper' });
    const target = await createProject('Corrupt project');
    await fs.writeFile(join(DATA_DIR, target.id, 'documents.json'), '{corrupt');
    const result = await switchProject(target.id);
    assert.ok(result.error);
    assert.equal(getCurrentProjectId(), previousId);
    assert.equal(storage.documents.get('doc-healthy').name, 'Healthy paper');
    emit(previousId);
  `);
  assert.equal(readJSON(join(dir, 'projects.json')).lastUsedProjectId, previousId);
  assert.equal(runStorage(dir, 'emit(getCurrentProjectId());'), previousId);
});

test('failed saves abort project switching without discarding dirty documents', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    const previousId = getCurrentProjectId();
    const targetProject = await createProject('Other project');
    storage.documents.set('doc-dirty', { id: 'doc-dirty', name: 'Unsaved paper' });
    const target = join(DATA_DIR, previousId, 'documents.json');
    const originalRename = fs.rename;
    fs.rename = async (from, to) => {
      if (to === target) throw Object.assign(new Error('Injected save failure'), { code: 'EIO' });
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    const result = await switchProject(targetProject.id);
    assert.ok(result.error);
    assert.equal(getCurrentProjectId(), previousId);
    assert.equal(storage.documents.get('doc-dirty').name, 'Unsaved paper');
    fs.rename = originalRename;
    syncBuiltinESMExports();
    await exportProjectData(previousId);
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8'))[0].id, 'doc-dirty');
    emit(true);
  `);
});

test('deleting the active project aborts if its replacement cannot be loaded', t => {
  const dir = dataDir(t);
  const previousId = runStorage(dir, `
    const previousId = getCurrentProjectId();
    storage.documents.set('doc-healthy', { id: 'doc-healthy', name: 'Healthy paper' });
    const target = await createProject('Corrupt replacement');
    const targetFile = join(DATA_DIR, target.id, 'documents.json');
    await fs.writeFile(targetFile, '{corrupt');
    const result = await deleteProject(previousId);
    assert.ok(result.error);
    assert.equal(getCurrentProjectId(), previousId);
    assert.equal(storage.documents.get('doc-healthy').name, 'Healthy paper');
    assert.equal((await listProjects()).projects.length, 2);
    assert.equal(await fs.readFile(targetFile, 'utf8'), '{corrupt');
    emit(previousId);
  `);
  assert.equal(readJSON(join(dir, 'projects.json')).lastUsedProjectId, previousId);
  assert.equal(runStorage(dir, 'emit(getCurrentProjectId());'), previousId);
});

test('normal inactive and active project deletion retain the correct remaining project after restart', t => {
  const dir = dataDir(t);
  const result = runStorage(dir, `
    const originalId = getCurrentProjectId();
    storage.documents.set('doc-original', { id: 'doc-original', name: 'Original paper' });
    const remaining = await createProject('Remaining project');
    const inactive = await createProject('Inactive project');
    assert.equal((await deleteProject(inactive.id)).success, true);
    assert.equal(getCurrentProjectId(), originalId);
    assert.equal(storage.documents.size, 1);
    assert.equal((await deleteProject(originalId)).success, true);
    assert.equal(getCurrentProjectId(), remaining.id);
    assert.equal(storage.documents.size, 0);
    emit({ originalId, inactiveId: inactive.id, remainingId: remaining.id });
  `);
  assert.equal(readdirSync(dir).includes(result.originalId), false);
  assert.equal(readdirSync(dir).includes(result.inactiveId), false);
  const restarted = runStorage(dir, 'emit(await listProjects());');
  assert.equal(restarted.currentProjectId, result.remainingId);
  assert.deepEqual(restarted.projects.map(p => p.id), [result.remainingId]);
});

test('failed atomic replacement preserves the previous file, reports error, cleans temp files, and releases the lock', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    await updateProject(getCurrentProjectId(), { name: 'Before failure' });
    const target = join(DATA_DIR, 'projects.json');
    const previous = await fs.readFile(target, 'utf8');
    const originalRename = fs.rename;
    fs.rename = async (from, to) => {
      if (to === target) throw Object.assign(new Error('Injected disk failure'), { code: 'EIO' });
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    await assert.rejects(updateProject(getCurrentProjectId(), { name: 'Failed save' }), /Injected disk failure/);
    assert.equal(await fs.readFile(target, 'utf8'), previous);
    assert.equal(getStorageWriteError().code, 'EIO');
    assert.equal((await fs.readdir(DATA_DIR)).some(name => name.includes('.tmp.')), false);
    fs.rename = originalRename;
    syncBuiltinESMExports();
    await updateProject(getCurrentProjectId(), { name: 'After retry' });
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).projects[0].name, 'After retry');
    emit(true);
  `);
});

test('backup-rotation errors do not remove the canonical file or prevent a successful save', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    const target = join(DATA_DIR, 'projects.json');
    const originalRename = fs.rename;
    fs.rename = async (from, to) => {
      if (to.includes('.backup.')) throw Object.assign(new Error('Injected backup failure'), { code: 'EACCES' });
      return originalRename(from, to);
    };
    syncBuiltinESMExports();
    await updateProject(getCurrentProjectId(), { name: 'Saved despite backup failure' });
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).projects[0].name, 'Saved despite backup failure');
    emit(true);
  `);
});

test('temporary-file write errors preserve main and backups and reach the error status', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    await updateProject(getCurrentProjectId(), { name: 'Before full disk' });
    const target = join(DATA_DIR, 'projects.json');
    const previous = await fs.readFile(target, 'utf8');
    const previousBackup = await fs.readFile(target + '.backup.1', 'utf8');
    const originalOpen = fs.open;
    fs.open = async (path, ...args) => {
      if (path.startsWith(target + '.tmp.')) throw Object.assign(new Error('Injected full disk'), { code: 'ENOSPC' });
      return originalOpen(path, ...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(updateProject(getCurrentProjectId(), { name: 'Failed write' }), /Injected full disk/);
    assert.equal(await fs.readFile(target, 'utf8'), previous);
    assert.equal(await fs.readFile(target + '.backup.1', 'utf8'), previousBackup);
    assert.equal(getStorageWriteError().code, 'ENOSPC');
    assert.equal((await fs.readdir(DATA_DIR)).some(name => name.includes('.tmp.')), false);
    emit(true);
  `);
});

test('the canonical file remains valid at every backup and replacement step', t => {
  const dir = dataDir(t);
  runStorage(dir, `
    const target = join(DATA_DIR, 'projects.json');
    const originalRename = fs.rename;
    let checked = 0;
    fs.rename = async (from, to) => {
      if (to.startsWith(target)) {
        const oldData = JSON.parse(await fs.readFile(target, 'utf8'));
        assert.equal(oldData.projects.length, 1);
        checked++;
      }
      const result = await originalRename(from, to);
      if (to.startsWith(target)) assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).projects.length, 1);
      return result;
    };
    syncBuiltinESMExports();
    for (let i = 0; i < 5; i++) await updateProject(getCurrentProjectId(), { name: 'Atomic ' + i });
    assert.ok(checked >= 10);
    assert.equal((await fs.readdir(DATA_DIR)).some(name => name.includes('.tmp.')), false);
    emit(true);
  `);
});
