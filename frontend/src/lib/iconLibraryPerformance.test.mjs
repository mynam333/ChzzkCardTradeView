import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const runtimePath = new URL('./iconLibrary.tsx', import.meta.url);
const adminPath = new URL('./iconLibraryAdmin.ts', import.meta.url);
const layoutPath = new URL('../app/MainLayout.tsx', import.meta.url);
const mobileDockPath = new URL('../app/MobileLoopDock.tsx', import.meta.url);

test('the shared icon renderer keeps full registries out of the initial route chunk', async () => {
  const source = await readFile(runtimePath, 'utf8');

  assert.doesNotMatch(source, /import\s+\*\s+as\s+mdiIcons\s+from\s+['"]@mdi\/js['"]/);
  assert.doesNotMatch(source, /import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*['"]lucide-react['"]/s);
  assert.doesNotMatch(source, /import\(['"]@mdi\/js['"]\)/);
  assert.doesNotMatch(source, /dynamicIconImports/);
  assert.match(source, /fetch\(`\/generated-icons\/\$\{cacheKey\}\.json\?v=\$\{generatedIconAssetVersion\}`/);
  assert.match(source, /bucketPromises\.delete\(cacheKey\)/);
  assert.match(source, /width="24"/);
  assert.match(source, /height="24"/);
  assert.match(source, /className=\{\['lucide'/);
  assert.match(source, /return <Award /);
});

test('admin validation retains the complete MDI and Lucide registries', async () => {
  const source = await readFile(adminPath, 'utf8');

  assert.doesNotMatch(source, /from ['"]@mdi\/js['"]/);
  assert.doesNotMatch(source, /\bicons\b[^;]*from ['"]lucide-react['"]/);
  assert.match(source, /generatedLucideIconNames/);
  assert.match(source, /generatedMdiExportNames/);
  assert.match(source, /export const appIconExists/);
  assert.match(source, /export const suggestedIconOptions/);
});

test('every currently supported Lucide name has a generated runtime node', async () => {
  const { icons } = require('lucide-react');
  const toKebabCase = (value) => value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .replace(/[_:\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const hashBucket = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 32;
  };
  const buckets = await Promise.all(Array.from({ length: 32 }, (_, index) =>
    readFile(new URL(`../../public/generated-icons/lucide-${index}.json`, import.meta.url), 'utf8').then(JSON.parse)
  ));

  for (const [name, Icon] of Object.entries(icons)) {
    const slug = toKebabCase(name);
    const generated = buckets[hashBucket(slug)][slug];
    assert.ok(Array.isArray(generated), `missing generated Lucide icon: ${name} (${slug})`);
    assert.deepEqual(generated, Icon.render({}, null).props.iconNode, `changed generated Lucide shape: ${name}`);
  }
});

test('every currently supported MDI name has its exact generated path', async () => {
  const mdiIcons = require('@mdi/js');
  const hashBucket = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 32;
  };
  const buckets = await Promise.all(Array.from({ length: 32 }, (_, index) =>
    readFile(new URL(`../../public/generated-icons/mdi-${index}.json`, import.meta.url), 'utf8').then(JSON.parse)
  ));

  for (const [name, path] of Object.entries(mdiIcons)) {
    if (!/^mdi[A-Z]/.test(name) || typeof path !== 'string') continue;
    assert.equal(buckets[hashBucket(name)][name], path, `changed generated MDI path: ${name}`);
  }
});

test('navigation prefetches only after explicit desktop or mobile intent', async () => {
  const [layout, mobileDock] = await Promise.all([
    readFile(layoutPath, 'utf8'),
    readFile(mobileDockPath, 'utf8')
  ]);

  assert.match(layout, /router\.prefetch\(tabRoute\(tab\)\)/);
  assert.match(layout, /onPointerEnter=\{\(\) => prefetchTab\(item\.id\)\}/);
  assert.match(layout, /onFocus=\{\(\) => prefetchTab\(item\.id\)\}/);
  assert.match(layout, /onIntent=\{\(id\) => prefetchTab\(id\)\}/);
  assert.match(mobileDock, /onIntent\?\.\(nextItem\.id, nextItem\)/);
});
