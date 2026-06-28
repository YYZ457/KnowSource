// 将 build/icon.png（实际为 JPEG）转换为真正的 PNG 和多尺寸 ICO
import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const srcPath = path.join(buildDir, 'icon.png'); // 实际是 JPEG

async function main() {
  try {
    console.log('1. Reading source image:', srcPath);
    const image = await Jimp.read(srcPath);
    console.log('   Source size:', image.width, 'x', image.height);

    console.log('2. Resizing to 1024x1024');
    image.resize({ w: 1024, h: 1024 });
    console.log('   After resize:', image.width, 'x', image.height);

    console.log('3. Saving true PNG');
    await image.write(path.join(buildDir, 'icon.png'));
    console.log('   Saved');

    console.log('4. Generating multi-size ICO');
    const sizes = [16, 32, 48, 64, 128, 256];
    const pngBuffers = [];
    for (const size of sizes) {
      const img = await Jimp.read(srcPath);
      img.resize({ w: size, h: size });
      const buf = await img.getBuffer('image/png');
      pngBuffers.push(buf);
      console.log(`   ${size}x${size}: ${buf.length} bytes`);
    }

    console.log('5. Converting to ICO');
    const icoBuf = await pngToIco(pngBuffers);
    const icoPath = path.join(buildDir, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuf);
    console.log('   ICO saved:', icoPath, `(${icoBuf.length} bytes)`);

    console.log('Done!');
  } catch (err) {
    console.error('FAILED at step:', err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
