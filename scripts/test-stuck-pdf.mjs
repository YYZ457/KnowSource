import fs from 'fs';
import path from 'path';

const filePath = 'C:/Users/YANYZ/Desktop/knowsource/工程光学作业(2).pdf';
const name = path.basename(filePath);
const buffer = fs.readFileSync(filePath);
const text = buffer.toString('base64');

console.log('File size:', buffer.length);
console.log('Started at:', new Date().toISOString());

const { parseHandler } = await import('../services/api/handlers/parse.js');

// Set a global timeout
const timeout = setTimeout(() => {
  console.error('Global timeout: parse is taking too long');
  process.exit(1);
}, 300000);

try {
  const doc = await parseHandler({ name, content: text, type: 'pdf' });
  clearTimeout(timeout);
  console.log('Parse succeeded at:', new Date().toISOString());
  console.log('totalPages:', doc.meta.totalPages);
  console.log('isScanned:', doc.meta.isScanned);
  console.log('text length:', doc.rawText.length);
  console.log('preview:', doc.rawText.slice(0, 1000));
} catch (e) {
  clearTimeout(timeout);
  console.error('Parse failed:', e.message);
  console.error(e.stack);
  process.exit(1);
}
