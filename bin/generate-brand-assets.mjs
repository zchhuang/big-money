import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(root, 'packages/desktop-client/public');
const svg = await readFile(path.join(web, 'brand-icon.svg'));
async function png(file, width, height = width) {
  await sharp(svg).resize(width, height).png().toFile(file);
}
for (const [name, size] of Object.entries({
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'mstile-150x150.png': 150,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
  'maskable-192x192.png': 192,
  'maskable-512x512.png': 512,
})) {
  await png(path.join(web, name), size);
}
// ICO permits an embedded PNG; 0 means 256 pixels in the directory entry.
const favicon = await sharp(svg).resize(256, 256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(favicon.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(
  path.join(web, 'favicon.ico'),
  Buffer.concat([header, favicon]),
);
await png(path.join(root, 'packages/desktop-electron/icons/icon.png'), 1024);

async function nativeAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await nativeAssets(file);
      continue;
    }
    if (!/^(ic_launcher.*|AppIcon.*|splash.*)\.png$/.test(entry.name)) continue;
    const { width, height } = await sharp(file).metadata();
    if (!width || !height) throw new Error(`Missing asset dimensions: ${file}`);
    if (entry.name.startsWith('splash')) {
      const mark = await sharp(svg)
        .resize(Math.round(Math.min(width, height) * 0.24))
        .png()
        .toBuffer();
      await sharp({
        create: { width, height, channels: 4, background: '#143c32' },
      })
        .composite([{ input: mark, gravity: 'center' }])
        .png()
        .toBuffer()
        .then(data => writeFile(file, data));
    } else {
      await png(file, width, height);
    }
  }
}
await nativeAssets(
  path.join(root, 'packages/mobile-client/android/app/src/main/res'),
);
await nativeAssets(
  path.join(root, 'packages/mobile-client/ios/App/App/Assets.xcassets'),
);
if (process.platform === 'darwin') {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'big-money-icons-'));
  const iconset = path.join(temp, 'KnowThyWealth.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    await png(path.join(iconset, `icon_${size}x${size}.png`), size);
    await png(path.join(iconset, `icon_${size}x${size}@2x.png`), size * 2);
  }
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    path.join(root, 'packages/desktop-electron/icons/icon.icns'),
  ]);
}
console.log('Generated Know Thy Wealth web, desktop, and mobile brand assets.');
