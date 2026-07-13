import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demoDir = join(root, '知源-Demo体验')
const read = (name) => readFileSync(join(demoDir, name), 'utf8')

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}

function pngSize(name) {
  const data = readFileSync(join(demoDir, 'assets', name))
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG')
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

test('promotional HTML inline scripts compile', () => {
  for (const file of ['landing.html', 'index.html']) {
    const scripts = inlineScripts(read(file))
    assert.ok(scripts.length, `${file} should contain inline behavior`)
    for (const source of scripts) assert.doesNotThrow(() => new Function(source), file)
  }
})

test('demo data mirrors the current product sample', () => {
  const data = JSON.parse(read('graph_data.json'))
  assert.equal(Object.keys(data.docs).length, 3)
  assert.equal(data.ideas.length, 1)
  assert.equal(data.nodes.length, 82)
  assert.equal(data.edges.length, 179)

  const nodeIds = new Set(data.nodes.map((node) => node.id))
  for (const id of Object.keys(data.docs)) assert.ok(nodeIds.has(id), `missing document node ${id}`)
  for (const edge of data.edges) {
    assert.ok(nodeIds.has(edge.from), `missing edge source ${edge.from}`)
    assert.ok(nodeIds.has(edge.to), `missing edge target ${edge.to}`)
    assert.equal(edge.source, edge.from)
    assert.equal(edge.target, edge.to)
  }

  const js = read('graph_data.js')
  const assignment = js.match(/^window\.GRAPH_DATA\s*=\s*([\s\S]*);\s*$/)
  assert.ok(assignment, 'graph_data.js should expose window.GRAPH_DATA')
  assert.deepEqual(JSON.parse(assignment[1]), data)
})

test('interactive demo uses current IDs and honest behavior', () => {
  const html = read('index.html')
  for (const id of ['doc-b2613a49', 'doc-fe466a6d', 'doc-9d3eec8b']) assert.match(html, new RegExp(id))
  for (const oldId of ['doc-594d8074', 'doc-93c39967', 'doc-2169c597']) assert.doesNotMatch(html, new RegExp(oldId))
  assert.match(html, /function rootId\(docId\)\{return docId\}/)
  assert.match(html, /本地预计算样例/)
  assert.match(html, /不模拟精确跳页/)
  assert.match(html, /Ctrl\+K/)
  assert.match(html, /const TEXT_RESULTS=/)
  assert.match(html, /原文片段/)
  assert.match(html, /projectSelect'\)\.onchange/)
  assert.match(html, /modelConfig:/)
  assert.match(html, /grid-template-rows:minmax\(150px,32%\)/)
})

test('landing page is local, screenshot-led, and dimensionally stable', () => {
  const html = read('landing.html')
  const screenshots = [
    '01-document-reading.png',
    '02-graph-expanded.png',
    '03-global-search.png',
    '04-idea-workspace.png',
    '05-model-settings.png',
    '06-prompt-lab.png',
  ]
  for (const name of screenshots) {
    assert.deepEqual(pngSize(name), { width: 1280, height: 720 })
    assert.match(html, new RegExp(name.replace('.', '\\.')))
  }
  assert.doesNotMatch(html, /fonts\.google|unpkg\.com|cdn\.jsdelivr|d3js\.org/i)
  assert.match(html, /loading="lazy"/)
  assert.match(html, /aria-label="重置交互体验"/)
  assert.match(html, /aria-label="全屏打开交互体验"/)
})
