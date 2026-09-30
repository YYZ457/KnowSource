// PDF bytes use the same header authentication as the JSON API. Never put the
// local API token in an iframe URL, browser history or referrer.
export function pdfRequest(docId, electronEnv) {
  const base = electronEnv?.backendPort
    ? `http://127.0.0.1:${electronEnv.backendPort}`
    : '/api'
  return {
    url: `${base}/documents/${encodeURIComponent(docId)}/pdf`,
    headers: electronEnv?.apiToken
      ? { 'X-Knowledge-IDE-Token': electronEnv.apiToken }
      : {},
  }
}

// Vite may inline small assets as data URLs. Decode those locally instead of
// relaxing connect-src to allow data: fetches; all other URLs are bundled files.
export function createPdfAssetFactories({ cmaps, fonts, fetchImpl = fetch }) {
  async function readAsset(assets, name) {
    const url = Object.hasOwn(assets, name) ? assets[name] : null
    if (!url) throw new Error(`PDF 字体资源不可用: ${name}`)
    if (url.startsWith('data:')) {
      const encoded = url.match(/^data:[^,]*;base64,(.*)$/s)?.[1]
      if (!encoded) throw new Error('PDF 字体资源编码无效')
      return Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    }
    const response = await fetchImpl(url)
    if (!response.ok) throw new Error(`PDF 字体资源请求失败 (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
  return {
    useWorkerFetch: false,
    CMapReaderFactory: class {
      async fetch({ name }) {
        return { cMapData: await readAsset(cmaps, `${name}.bcmap`), compressionType: 1 }
      }
    },
    StandardFontDataFactory: class {
      fetch({ filename }) { return readAsset(fonts, filename) }
    },
  }
}

// The caller's signal owns the complete document lifetime, including the PDF.js
// worker. Aborting a replaced preview also destroys an already loaded document.
export async function loadPdfPreview({ docId, electronEnv, signal, loadLibrary, fetchImpl = fetch }) {
  signal.throwIfAborted()
  const { url, headers } = pdfRequest(docId, electronEnv)
  const [library, data] = await Promise.all([
    loadLibrary(),
    fetchImpl(url, { headers, signal }).then(async response => {
      if (!response.ok) throw new Error(`PDF 请求失败 (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    }),
  ])
  signal.throwIfAborted()
  // Avoid PDF.js dynamic code generation, including on untrusted uploaded PDFs.
  const task = library.getDocument({ data, isEvalSupported: false, useSystemFonts: true })
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    Promise.resolve(task.destroy()).catch(() => {})
  }
  signal.addEventListener('abort', destroy, { once: true })
  try {
    const pdf = await task.promise
    signal.throwIfAborted()
    return pdf
  } catch (error) {
    signal.removeEventListener('abort', destroy)
    destroy()
    throw error
  }
}

export async function renderPdfPreviewPage({ pdf, pageNumber, canvas, width, pixelRatio = 1, signal }) {
  signal.throwIfAborted()
  const page = await pdf.getPage(pageNumber)
  signal.throwIfAborted()
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(1, width) / base.width
  // Bound canvas memory even for unusually large pages and high-DPI displays.
  const density = Math.min(Math.max(1, pixelRatio), 2, 4096 / Math.max(base.width * scale, base.height * scale))
  const viewport = page.getViewport({ scale: scale * density })
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
  const cancel = () => task.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', cancel)
    page.cleanup()
  }
}
