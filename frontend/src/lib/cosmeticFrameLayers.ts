export type CosmeticFrameLayer = {
  name: string;
  path: string;
  parentPath?: string;
};

export type CosmeticFrameLayerConfig = {
  imageLayerLayout?: 'layers-v1' | 'chuseok-webp-v1';
  layers?: readonly CosmeticFrameLayer[];
  layerError?: string;
};

// Only inert spans are generated. CSS never supplies HTML, attributes, or scripts.
const LAYER_PATH = /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/;

const buildLayers = (paths: readonly string[]): CosmeticFrameLayer[] => {
  const layers = new Map<string, CosmeticFrameLayer>();
  for (const path of paths) {
    let parentPath: string | undefined;
    for (const name of path.split('/')) {
      const currentPath: string = parentPath ? `${parentPath}/${name}` : name;
      if (!layers.has(currentPath)) layers.set(currentPath, { name, path: currentPath, parentPath });
      parentPath = currentPath;
    }
  }
  return [...layers.values()];
};

// Backward compatibility: the already-saved v7 CSS needs no re-registration.
const chuseokLayers = buildLayers([
  'moon', 'frame', 'front/cloud-1', 'front/cloud-2/cloud-2-turn',
  'front/cloud-3', 'front/rice-base', 'front/rice-canopy/rice-sway/rice-tension'
]);

/**
 * Read literal metadata from unconditional root rules, identically on server/client.
 * Mask comments/strings and skip functions so artwork, content, media queries,
 * keyframes and child selectors cannot accidentally declare a DOM structure.
 * This is a small metadata reader, not a general CSS parser or CSS sanitizer.
 */
const rootDeclarations = (className: string, css: string): Map<string, string> => {
  const values = new Map<string, string>();
  const important = new Set<string>();
  const classes = className.split(/\s+/).filter(Boolean);
  const masked = css.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('/*') ? ' ' : '""');
  const matchesRoot = (selector: string): boolean => selector.split(',').some((part) => {
    const simple = part.trim();
    if (!/^(?:\.[a-zA-Z_][\w-]*)+$/.test(simple)) return false;
    const tokens = simple.slice(1).split('.');
    return classes.every((name) => tokens.includes(name))
      && tokens.every((name) => name === 'cosmetic-frame' || classes.includes(name));
  });
  const collect = (declaration: string) => {
    const match = declaration.trim().match(/^(--cosmetic-frame-(?:layout|layers))\s*:\s*([\s\S]*?)\s*$/);
    if (!match) return;
    const [, property, rawValue] = match;
    const isImportant = /!\s*important\s*$/i.test(rawValue);
    if (important.has(property) && !isImportant) return;
    if (isImportant) important.add(property);
    values.set(property, rawValue.replace(/!\s*important\s*$/i, '').trim());
  };
  let braces = 0;
  let parentheses = 0;
  let brackets = 0;
  let start = 0;
  let root = false;
  for (let i = 0; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '(') parentheses += 1;
    else if (char === ')') parentheses = Math.max(0, parentheses - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    if (parentheses || brackets) continue;
    if (char === '{') {
      if (braces === 0) root = matchesRoot(masked.slice(start, i));
      braces += 1;
      start = i + 1;
    } else if (char === '}') {
      if (braces === 1 && root) collect(masked.slice(start, i));
      braces = Math.max(0, braces - 1);
      start = i + 1;
    } else if (char === ';') {
      if (braces === 1 && root) collect(masked.slice(start, i));
      start = i + 1;
    }
  }
  return values;
};

export const readCosmeticFrameLayers = (className: string, css: string): CosmeticFrameLayerConfig => {
  if (!className.split(/\s+/).some((name) => name.startsWith('cb-')) || !css.includes('--cosmetic-frame-')) return {};
  const declarations = rootDeclarations(className, css);
  const layout = declarations.get('--cosmetic-frame-layout');
  const manifest = declarations.get('--cosmetic-frame-layers');
  if (!layout && manifest === undefined) return {};
  if (layout === 'chuseok-webp-v1' && manifest === undefined) {
    return { imageLayerLayout: layout, layers: chuseokLayers };
  }
  if (layout !== 'layers-v1') {
    return { layerError: '공통 레이어에는 --cosmetic-frame-layout: layers-v1 선언이 필요합니다.' };
  }
  if (!manifest) {
    return { layerError: '--cosmetic-frame-layers에 쉼표로 구분한 레이어 경로를 입력하세요.' };
  }
  const paths = manifest.split(',').map((path) => path.trim());
  if (paths.some((path) => !LAYER_PATH.test(path))) {
    return { layerError: '레이어 경로는 영문 소문자로 시작하며 소문자·숫자·-·_를 사용합니다. 부모/자식 경로를 쉼표로 구분하고 따옴표는 넣지 마세요.' };
  }
  return { imageLayerLayout: layout, layers: buildLayers(paths) };
};
