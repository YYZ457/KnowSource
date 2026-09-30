import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve('runtime-assets/ocr');
await mkdir(directory, { recursive: true });
for (const language of ['eng', 'chi_sim']) {
  const file = resolve(directory, `${language}.traineddata`);
  if (await stat(file).then(s => s.size > 100000).catch(() => false)) continue;
  const response = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${language}.traineddata`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`OCR language download failed: ${language} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 100000 || bytes.length > 10 * 1024 * 1024) throw new Error(`Unexpected OCR language file size: ${language}`);
  await writeFile(file, bytes);
  console.log(`Prepared ${language} OCR language (${bytes.length} bytes)`);
}
