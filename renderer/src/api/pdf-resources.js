import { createPdfAssetFactories } from './pdf-preview.mjs'

// Ship fonts/CMaps with the app so CJK PDFs also render offline. Resolve through
// Vite's asset graph rather than assuming an unpackaged node_modules URL exists.
const byFilename = assets => Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [path.split('/').pop(), url])
)

export const pdfResourceOptions = createPdfAssetFactories({
  cmaps: byFilename(import.meta.glob('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
    eager: true, query: '?url', import: 'default',
  })),
  fonts: byFilename(import.meta.glob('../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
    eager: true, query: '?url', import: 'default',
  })),
})
