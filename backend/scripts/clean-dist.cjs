const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const distPath = path.resolve(backendRoot, 'dist');

if (path.dirname(distPath) !== backendRoot || path.basename(distPath) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build path: ${distPath}`);
}

fs.rmSync(distPath, { recursive: true, force: true });
