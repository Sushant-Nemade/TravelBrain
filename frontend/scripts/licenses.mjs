import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const records = [];
for (const name of ['lucide', 'zod', '@fontsource/dm-sans']) {
  const root = path.join('frontend/node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const files = (await readdir(root)).filter(file => /^(license|ofl|copying)/i.test(file));
  if (!files.length) throw new Error(`Missing license: ${name}`);
  records.push({ name, version: metadata.version, license: metadata.license, notices: await Promise.all(files.map(async file => ({ file, text: await readFile(path.join(root, file), 'utf8') }))) });
}
records.push({ name: 'Destination photography', license: 'Unsplash License', url: 'https://unsplash.com/license', sources: {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34',
  lisbon: 'https://images.unsplash.com/photo-1506377585622-bedcbb027afc',
  kyoto: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e',
} });
await mkdir('frontend/public', { recursive: true });
await writeFile('frontend/public/licenses.json', JSON.stringify(records, null, 2));