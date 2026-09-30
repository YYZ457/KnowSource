import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pdfRequest, createPdfAssetFactories, loadPdfPreview, renderPdfPreviewPage } from '../renderer/src/api/pdf-preview.mjs'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function previewFixture(overrides = {}) {
  const controller = new AbortController()
  const pdf = { numPages: 2 }
  const calls = { requests: [], options: [], destroyed: 0 }
  const task = { promise: Promise.resolve(pdf), destroy() { calls.destroyed++ } }
  const options = {
    docId: 'paper-1',
    electronEnv: { backendPort: 8000, apiToken: 'test-token' },
    signal: controller.signal,
    loadLibrary: async () => ({ getDocument(options) { calls.options.push(options); return task } }),
    fetchImpl: async (url, options) => {
      calls.requests.push({ url, ...options })
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4').buffer }
    },
    ...overrides,
  }
  return { options, controller, calls, task, pdf }
}

test('desktop PDF requests encode IDs and keep the API token out of URLs', () => {
  const request = pdfRequest('paper /?#中文', { backendPort: 8016, apiToken: 'private-token' })
  assert.equal(request.url, 'http://127.0.0.1:8016/documents/paper%20%2F%3F%23%E4%B8%AD%E6%96%87/pdf')
  assert.deepEqual(request.headers, { 'X-Knowledge-IDE-Token': 'private-token' })
  assert.equal(request.url.includes('private-token'), false)
  assert.deepEqual(pdfRequest('paper-1'), { url: '/api/documents/paper-1/pdf', headers: {} })
})

test('bundled CMaps and fonts support hashed files and inline assets without remote fallback', async () => {
  const fetched = []
  const factories = createPdfAssetFactories({
    cmaps: { 'UniGB-UCS2-H.bcmap': '/assets/UniGB-UCS2-H-hash.bcmap' },
    fonts: { 'FoxitSerif.pfb': 'data:application/octet-stream;base64,AAH/' },
    fetchImpl: async url => { fetched.push(url); return { ok: true, arrayBuffer: async () => Uint8Array.of(3, 4).buffer } },
  })
  assert.equal(factories.useWorkerFetch, false)
  const cmap = await new factories.CMapReaderFactory().fetch({ name: 'UniGB-UCS2-H' })
  assert.deepEqual(cmap, { cMapData: Uint8Array.of(3, 4), compressionType: 1 })
  assert.deepEqual(await new factories.StandardFontDataFactory().fetch({ filename: 'FoxitSerif.pfb' }), Uint8Array.of(0, 1, 255))
  await assert.rejects(new factories.CMapReaderFactory().fetch({ name: '../../outside' }), /资源不可用/)
  await assert.rejects(new factories.StandardFontDataFactory().fetch({ filename: 'toString' }), /资源不可用/)
  assert.deepEqual(fetched, ['/assets/UniGB-UCS2-H-hash.bcmap'])
})

// A tiny non-embedded CJK font fixture reproduces the otherwise silent blank-page
// regression. No external PDFs, network, Python or browser installation needed.
function chinesePdf() {
  const text = Buffer.from('光学复习', 'utf16le').swap16().toString('hex')
  const stream = `BT /F1 20 Tf 40 700 Td <${text}> Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 0 >> /DW 1000 /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /Ascent 752 /Descent -271 /CapHeight 737 /ItalicAngle 0 /StemV 58 >> >>] >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(source.length)
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(source)
}

test('real PDF.js reads non-embedded Chinese text with the bundled asset factories', async () => {
  const require = createRequire(import.meta.url)
  const pdfjs = require('pdfjs-dist/build/pdf.js')
  const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))
  const assets = folder => Object.fromEntries(readdirSync(join(pdfRoot, folder)).map(name => [name, join(pdfRoot, folder, name)]))
  const factories = createPdfAssetFactories({
    cmaps: assets('cmaps'), fonts: assets('standard_fonts'),
    fetchImpl: async path => ({ ok: true, arrayBuffer: async () => new Uint8Array(readFileSync(path)).buffer }),
  })
  const task = pdfjs.getDocument({ data: chinesePdf(), ...factories, isEvalSupported: false, useSystemFonts: true })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    assert.equal((await page.getTextContent()).items.map(item => item.str).join(''), '光学复习')
  } finally { await task.destroy() }
})

test('loads PDF bytes with header authentication, disables dynamic eval, and releases the loaded worker on abort', async () => {
  const fixture = previewFixture()
  assert.equal(await loadPdfPreview(fixture.options), fixture.pdf)
  assert.equal(fixture.calls.requests.length, 1)
  assert.equal(fixture.calls.requests[0].signal, fixture.controller.signal)
  assert.equal(fixture.calls.requests[0].headers['X-Knowledge-IDE-Token'], 'test-token')
  assert.equal(fixture.calls.options[0].isEvalSupported, false)
  assert.ok(fixture.calls.options[0].data instanceof Uint8Array)
  fixture.controller.abort()
  fixture.controller.abort()
  assert.equal(fixture.calls.destroyed, 1)
})

test('failed PDF requests never create a parser or show the error response as a PDF', async () => {
  for (const status of [403, 404, 500]) {
    const fixture = previewFixture({ fetchImpl: async () => ({ ok: false, status }) })
    await assert.rejects(loadPdfPreview(fixture.options), new RegExp(String(status)))
    assert.equal(fixture.calls.options.length, 0)
  }
})

test('switching documents before a slow fetch completes cannot open the stale PDF', async () => {
  const body = deferred()
  const fixture = previewFixture({ fetchImpl: async () => ({ ok: true, arrayBuffer: () => body.promise }) })
  const pending = loadPdfPreview(fixture.options)
  fixture.controller.abort()
  body.resolve(new ArrayBuffer(10))
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(fixture.calls.options.length, 0)
})

test('switching documents during parsing destroys the old worker and rejects a late result', async () => {
  const parsed = deferred()
  const started = deferred()
  const fixture = previewFixture()
  fixture.task.promise = parsed.promise
  const original = fixture.options.loadLibrary
  fixture.options.loadLibrary = async () => {
    const library = await original()
    return { getDocument(options) { const task = library.getDocument(options); started.resolve(); return task } }
  }
  const pending = loadPdfPreview(fixture.options)
  await started.promise
  fixture.controller.abort()
  parsed.resolve(fixture.pdf)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(fixture.calls.destroyed, 1)
})

test('malformed PDFs release their failed loading task and can be retried', async () => {
  const fixture = previewFixture()
  fixture.task.promise = Promise.reject(new Error('Invalid PDF'))
  await assert.rejects(loadPdfPreview(fixture.options), /Invalid PDF/)
  assert.equal(fixture.calls.destroyed, 1)
  fixture.task.promise = Promise.resolve(fixture.pdf)
  assert.equal(await loadPdfPreview(fixture.options), fixture.pdf)
  fixture.controller.abort()
  assert.equal(fixture.calls.destroyed, 2)
})

function pageFixture({ pendingPage, pendingRender } = {}) {
  const calls = { pages: [], rendered: 0, cancelled: 0, cleaned: 0 }
  const canvas = { style: {}, getContext: () => ({ canvas }) }
  const page = {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render() {
      calls.rendered++
      return {
        promise: pendingRender?.promise || Promise.resolve(),
        cancel() { calls.cancelled++; pendingRender?.reject(new Error('Rendering cancelled')) },
      }
    },
    cleanup() { calls.cleaned++ },
  }
  const pdf = { async getPage(number) { calls.pages.push(number); return pendingPage ? pendingPage.promise : page } }
  return { canvas, page, pdf, calls }
}

test('two-page navigation renders the requested page and bounds canvas allocation', async () => {
  const fixture = pageFixture()
  for (const pageNumber of [1, 2, 1]) {
    await renderPdfPreviewPage({ ...fixture, pageNumber, width: 300, pixelRatio: 2, signal: new AbortController().signal })
  }
  assert.deepEqual(fixture.calls.pages, [1, 2, 1])
  assert.equal(fixture.canvas.width, 600)
  assert.equal(fixture.canvas.height, 800)
  assert.equal(fixture.calls.cleaned, 3)
  await renderPdfPreviewPage({ ...fixture, pageNumber: 2, width: 10000, pixelRatio: 3, signal: new AbortController().signal })
  assert.ok(Math.max(fixture.canvas.width, fixture.canvas.height) <= 4096)
})

test('leaving a preview cancels in-flight page rendering and frees the page', async () => {
  const pendingRender = deferred()
  const fixture = pageFixture({ pendingRender })
  const controller = new AbortController()
  const pending = renderPdfPreviewPage({ ...fixture, pageNumber: 1, width: 600, signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, /Rendering cancelled/)
  assert.equal(fixture.calls.cancelled, 1)
  assert.equal(fixture.calls.cleaned, 1)
})

test('a page resolving after navigation cannot paint into the new document', async () => {
  const pendingPage = deferred()
  const fixture = pageFixture({ pendingPage })
  const controller = new AbortController()
  const pending = renderPdfPreviewPage({ ...fixture, pageNumber: 1, width: 600, signal: controller.signal })
  controller.abort()
  pendingPage.resolve(fixture.page)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(fixture.calls.rendered, 0)
})
