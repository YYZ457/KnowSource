import fs from 'fs';
import { parsePDF, terminateOcrWorker } from '../core/parser/index.js';

const buffer = fs.readFileSync('C:/Users/YANYZ/Desktop/AFM虚拟实验.pdf');
const fileLike = {
  name: 'AFM虚拟实验.pdf',
  size: buffer.length,
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
};

console.log('Starting OCR parse...');
const result = await parsePDF(fileLike, (p) => {
  console.log('progress:', Math.floor(p * 100) + '%');
}, { maxOcrPages: 5 });

console.log('isScanned:', result.isScanned);
console.log('totalPages:', result.totalPages);
console.log('text length:', result.text.length);
console.log('text preview:', result.text.slice(0, 500));

await terminateOcrWorker();
