// 生成知源应用图标 PNG
const https = require('https');
const fs = require('fs');
const path = require('path');

const prompt = "A modern app icon for a knowledge graph builder called KnowSource. The icon features an open book at the bottom symbolizing knowledge source, with 5 glowing circular nodes floating above connected by thin lines forming a network graph. Dark navy gradient background deep blue to dark purple, golden amber nodes, cyan connecting lines. Flat design with subtle 3D depth, premium feel similar to VS Code icon. Centered composition, clean, professional, high contrast, minimalist.";
const encoded = encodeURIComponent(prompt);
const url = `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encoded}&image_size=square_hd`;
const outPath = path.join(__dirname, '..', 'build', 'icon.png');

function download(url, outPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟随重定向
        return download(res.headers.location, outPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(outPath, buf);
        console.log(`SUCCESS: ${outPath} (${buf.length} bytes)`);
        // 检查是否是 PNG
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        console.log(`Is PNG: ${isPng}`);
        if (!isPng) {
          console.log('First 200 chars:', buf.toString('utf8').slice(0, 200));
        }
        resolve();
      });
    }).on('error', reject);
  });
}

download(url, outPath).catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
