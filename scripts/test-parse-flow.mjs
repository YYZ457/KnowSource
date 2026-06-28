import fs from 'fs';

const filePath = 'C:/Users/YANYZ/Desktop/AFM虚拟实验.pdf';
const name = 'AFM虚拟实验.pdf';
const buffer = fs.readFileSync(filePath);
const text = buffer.toString('base64');

console.log('File size:', buffer.length);

const { parseHandler } = await import('../services/api/handlers/parse.js');

try {
  const doc = await parseHandler({ name, content: text, type: 'pdf' });
  console.log('Parse succeeded');
  console.log('docId:', doc.docId);
  console.log('type:', doc.type);
  console.log('totalPages:', doc.meta.totalPages);
  console.log('isScanned:', doc.meta.isScanned);
  console.log('text length:', doc.rawText.length);
  console.log('preview:', doc.rawText.slice(0, 500));
} catch (e) {
  console.error('Parse failed:', e.message);
  console.error(e.stack);
}
