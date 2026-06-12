import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out');
const files = ['_redirects'];

if (existsSync(outDir)) {
  for (const file of files) {
    const source = join(root, 'public', file);
    const target = join(outDir, file);
    if (!existsSync(source)) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}
