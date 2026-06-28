// 诊断书签编码问题
import fs from 'fs';

async function main() {
  const pdfPath = 'C:\\Users\\YANYZ\\Desktop\\2026springPSS_final.pdf';
  const buf = fs.readFileSync(pdfPath);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const lib = pdfjs.default || pdfjs;

  const data = new Uint8Array(buf);
  const pdf = await lib.getDocument({ data }).promise;

  const outline = await pdf.getOutline();
  console.log('书签数量:', outline.length);

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    const title = item.title || '';
    console.log(`\n书签 ${i + 1}:`);
    console.log(`  title: "${title}"`);
    console.log(`  length: ${title.length}`);
    console.log(`  charCodes: ${Array.from(title).map(c => c.charCodeAt(0).toString(16)).join(' ')}`);
    console.log(`  bytes (latin1): ${Buffer.from(title, 'latin1').toString('hex')}`);

    // 尝试不同编码
    const latin1Buf = Buffer.from(title, 'latin1');
    const utf8Decoded = latin1Buf.toString('utf8');
    console.log(`  latin1→utf8: "${utf8Decoded}"`);

    // 检查是否是 UTF-16
    if (title.length >= 2 && title.charCodeAt(0) === 0xFEFF) {
      console.log(`  检测到 UTF-16 BOM`);
    }
  }
}

main().catch(e => console.error(e));
