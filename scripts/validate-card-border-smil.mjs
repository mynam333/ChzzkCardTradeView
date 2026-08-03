import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const requireFromFrontend = createRequire(path.resolve(repositoryRoot, 'frontend', 'package.json'));
const postcss = requireFromFrontend('postcss');
const sharp = requireFromFrontend('sharp');
const defaultThemes = [
  'autumn.css',
  'sakura.css',
  'snow.css',
  'cyberpunk.css',
  'prism.css',
  'volcano.css',
  'medieval.css',
  'oriental.css',
  'royal.css',
  'stained-glass-nocturne.css',
  'ginkgo-lacquer-wind.css',
  'abyssal-reliquary.css',
  'goryeo-celadon.css'
];

const requested = process.argv.slice(2);
const filenames = requested.length ? requested : defaultThemes;
const dataSvgPattern = /url\(\s*(["'])data:image\/svg\+xml,([\s\S]*?)\1\s*\)/gi;
const selfClosingSmilPattern = /<(animate(?:Color|Motion|Transform)?|set)\b([^>]*)\/>/gi;
const pairedSmilPattern = /<(animate(?:Color|Motion|Transform)?|set)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

const keyframeSelectorIncludes = (rule, expected) =>
  rule?.selector
    ?.split(',')
    .map((selector) => selector.trim().toLowerCase())
    .some((selector) => expected.includes(selector));

const keyframeDeclarations = (rule) =>
  new Map((rule?.nodes ?? [])
    .filter((node) => node.type === 'decl')
    .map((declaration) => [declaration.prop.toLowerCase(), declaration.value.trim()]));

const normalizedCssAngles = (value) => value.replace(
  /(-?\d*\.?\d+)deg\b/gi,
  (_match, rawAngle) => {
    const angle = Number(rawAngle);
    if (!Number.isFinite(angle)) return rawAngle;
    const normalized = ((angle % 360) + 360) % 360;
    return `${Number(normalized.toFixed(6))}deg`;
  }
);

const parseBackgroundPosition = (value) => {
  const match = value.match(/^(.*?)(-?\d*\.?\d+)(px)?$/i);
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isFinite(amount) || (!match[3] && amount !== 0)) return null;
  return { prefix: match[1].trim().replace(/\s+/g, ' '), amount };
};

const isExactBackgroundTileShift = (first, last) => {
  const start = parseBackgroundPosition(first);
  const end = parseBackgroundPosition(last);
  return !!start
    && !!end
    && start.prefix === end.prefix
    && Math.abs(Math.abs(end.amount - start.amount) - 160) < 0.0001;
};

const isEquivalentCssLoopEndpoint = (property, first, last) => {
  if (first === last || normalizedCssAngles(first) === normalizedCssAngles(last)) return true;
  if (property !== 'background-position' && property !== 'background-position-y') return false;
  return isExactBackgroundTileShift(first, last);
};

const validateCssLoops = (root, filename) => {
  let count = 0;
  const tileKeyframes = new Set();
  root.walkAtRules((atRule) => {
    if (!/(?:^|-)keyframes$/i.test(atRule.name)) return;
    count += 1;
    const rules = (atRule.nodes ?? []).filter((node) => node.type === 'rule');
    const start = rules.find((rule) => keyframeSelectorIncludes(rule, ['0%', 'from']));
    const end = rules.find((rule) => keyframeSelectorIncludes(rule, ['100%', 'to']));
    if (!start || !end) {
      throw new Error(`${filename} @keyframes ${atRule.params}: explicit 0%/100% endpoints required`);
    }

    const startDeclarations = keyframeDeclarations(start);
    const endDeclarations = keyframeDeclarations(end);
    const properties = new Set([...startDeclarations.keys(), ...endDeclarations.keys()]);
    for (const property of properties) {
      const first = startDeclarations.get(property);
      const last = endDeclarations.get(property);
      if (!first || !last || !isEquivalentCssLoopEndpoint(property, first, last)) {
        throw new Error(
          `${filename} @keyframes ${atRule.params}: non-seamless ${property} ${first ?? '<missing>'} -> ${last ?? '<missing>'}`
        );
      }
      if (
        (property === 'background-position' || property === 'background-position-y')
        && isExactBackgroundTileShift(first, last)
      ) {
        tileKeyframes.add(atRule.params.trim());
      }
    }
  });
  return { count, tileKeyframes };
};

const isInsideKeyframes = (node) => {
  let current = node.parent;
  while (current) {
    if (current.type === 'atrule' && /(?:^|-)keyframes$/i.test(current.name)) return true;
    current = current.parent;
  }
  return false;
};

const splitSelectors = (selector = '') => selector.split(',').map((part) => part.trim()).filter(Boolean);

const validateTileLoopBindings = (root, filename, tileKeyframes) => {
  for (const keyframeName of tileKeyframes) {
    const escapedName = keyframeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namePattern = new RegExp(`(?:^|[\\s,])${escapedName}(?=$|[\\s,])`);
    const animatedSelectors = new Set();

    root.walkRules((rule) => {
      if (isInsideKeyframes(rule)) return;
      const usesKeyframe = (rule.nodes ?? []).some((node) =>
        node.type === 'decl'
        && (node.prop.toLowerCase() === 'animation' || node.prop.toLowerCase() === 'animation-name')
        && namePattern.test(node.value)
      );
      if (usesKeyframe) splitSelectors(rule.selector).forEach((selector) => animatedSelectors.add(selector));
    });

    if (!animatedSelectors.size) {
      throw new Error(`${filename} @keyframes ${keyframeName}: 160px tile loop is never applied`);
    }

    for (const selector of animatedSelectors) {
      let backgroundSizes = [];
      let backgroundRepeats = [];
      root.walkRules((rule) => {
        if (isInsideKeyframes(rule) || !splitSelectors(rule.selector).includes(selector)) return;
        for (const node of rule.nodes ?? []) {
          if (node.type !== 'decl') continue;
          const property = node.prop.toLowerCase();
          if (property === 'background-size') {
            backgroundSizes = node.value.split(',').map((value) => value.trim()).filter(Boolean);
          } else if (property === 'background-repeat') {
            backgroundRepeats = node.value.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
          }
        }
      });
      const everyLayerIsARepeatingTile = backgroundSizes.length > 0 && backgroundSizes.every((size, index) => {
        const repeat = backgroundRepeats[index % Math.max(1, backgroundRepeats.length)] ?? '';
        return /^100%\s+160px$/i.test(size) && /^(?:repeat|repeat-y)$/.test(repeat);
      });
      if (!everyLayerIsARepeatingTile) {
        throw new Error(
          `${filename} @keyframes ${keyframeName}: ${selector} must bind every moving layer to a repeating 100% 160px tile`
        );
      }
    }
  }
};

const attr = (source, name) => {
  const match = source.match(new RegExp(`\\b${name}=['"]([^'"]+)['"]`, 'i'));
  return match?.[1] ?? '';
};

const isEquivalentRotationLoop = (type, first, last) => {
  if (type !== 'rotate') return false;
  const parse = (value) => value.trim().split(/[ ,]+/).map(Number);
  const a = parse(first);
  const b = parse(last);
  if (a.length !== b.length || a.some((value) => !Number.isFinite(value)) || b.some((value) => !Number.isFinite(value))) return false;
  if (a.slice(1).some((value, index) => value !== b[index + 1])) return false;
  return Math.abs((b[0] - a[0]) % 360) < 0.0001;
};

const validateSmil = (svg, filename, svgIndex) => {
  const selfClosingAnimations = [...svg.matchAll(selfClosingSmilPattern)].map((match) => ({
    tag: match[1],
    attributes: match[2] || ''
  }));
  const svgWithoutSelfClosingSmil = svg.replace(selfClosingSmilPattern, '');
  const pairedAnimations = [...svgWithoutSelfClosingSmil.matchAll(pairedSmilPattern)].map((match) => ({
    tag: match[1],
    attributes: match[2] || ''
  }));
  const animations = [...selfClosingAnimations, ...pairedAnimations];
  if (animations.length < 3 || animations.length > 8) {
    throw new Error(`${filename} SVG ${svgIndex + 1}: SMIL count ${animations.length}, expected 3..8`);
  }

  for (const { tag, attributes } of animations) {
    const lowerTag = tag.toLowerCase();
    const duration = attr(attributes, 'dur');
    const seconds = Number(duration.replace(/s$/i, ''));
    if (lowerTag !== 'set' && (!duration.endsWith('s') || !Number.isFinite(seconds) || seconds < 2.8)) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: invalid duration ${duration || '<missing>'}`);
    }
    if (lowerTag !== 'set' && attr(attributes, 'repeatCount') !== 'indefinite') {
      throw new Error(`${filename} SVG ${svgIndex + 1}: repeatCount must be indefinite`);
    }

    const attributeName = attr(attributes, 'attributeName').toLowerCase();
    const animatesTransform = lowerTag === 'animatetransform'
      || lowerTag === 'animatemotion'
      || (lowerTag === 'animate' && attributeName === 'transform');
    if (lowerTag === 'animate' && attributeName === 'transform') {
      throw new Error(`${filename} SVG ${svgIndex + 1}: transform motion must use animateTransform`);
    }
    if (animatesTransform && attr(attributes, 'additive').toLowerCase() !== 'sum') {
      throw new Error(`${filename} SVG ${svgIndex + 1}: transform motion must use additive="sum"`);
    }

    const values = attr(attributes, 'values');
    if (lowerTag !== 'set' && !values) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: ${tag} must use explicit closed values`);
    }
    if (values) {
      const sequence = values.split(';').map((value) => value.trim()).filter(Boolean);
      if (sequence.length < 2) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: ${tag} needs at least two values`);
      }
      const first = sequence[0];
      const last = sequence.at(-1);
      const type = attr(attributes, 'type').toLowerCase();
      if (first !== last && !isEquivalentRotationLoop(type, first, last)) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: non-seamless ${tag} values ${first} -> ${last}`);
      }

      const rawKeyTimes = attr(attributes, 'keyTimes');
      const keyTimes = rawKeyTimes.split(';').map((value) => Number(value.trim()));
      if (
        !rawKeyTimes
        || keyTimes.length !== sequence.length
        || keyTimes.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
        || Math.abs(keyTimes[0]) > 0.000001
        || Math.abs(keyTimes.at(-1) - 1) > 0.000001
        || keyTimes.some((value, index) => index > 0 && value <= keyTimes[index - 1])
      ) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: invalid keyTimes for ${tag}`);
      }

      const calcMode = attr(attributes, 'calcMode').toLowerCase();
      const rawKeySplines = attr(attributes, 'keySplines');
      if (calcMode === 'spline') {
        const splines = rawKeySplines.split(';').map((segment) =>
          segment.trim().split(/[ ,]+/).filter(Boolean).map(Number)
        );
        if (
          !rawKeySplines
          || splines.length !== sequence.length - 1
          || splines.some((segment) =>
            segment.length !== 4
            || segment.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
          )
        ) {
          throw new Error(`${filename} SVG ${svgIndex + 1}: invalid keySplines for ${tag}`);
        }
      } else if (rawKeySplines) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: keySplines requires calcMode="spline"`);
      }
    }

    const keyPoints = attr(attributes, 'keyPoints');
    if (keyPoints) {
      const points = keyPoints.split(';').map((value) => value.trim()).filter(Boolean);
      if (points[0] !== points.at(-1)) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: non-seamless keyPoints`);
      }
    }
  }
  return animations.length;
};

const validateSvgSafety = (svg, filename, svgIndex) => {
  if (!/viewBox=['"]0 0 100 160['"]/i.test(svg) || !/preserveAspectRatio=['"]none['"]/i.test(svg)) {
    throw new Error(`${filename} SVG ${svgIndex + 1}: invalid sizing contract`);
  }
  if (/<(?:script|style|foreignObject)\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    throw new Error(`${filename} SVG ${svgIndex + 1}: script, style, foreignObject, or event attribute found`);
  }
  for (const match of svg.matchAll(/\b(?:href|xlink:href)=['"]([^'"]+)['"]/gi)) {
    if (!match[1].startsWith('#')) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: external href ${match[1]}`);
    }
  }
};

let svgTotal = 0;
let smilTotal = 0;
let cssLoopTotal = 0;
for (const filename of filenames) {
  const filePath = path.resolve(repositoryRoot, 'card-borders', filename);
  const css = fs.readFileSync(filePath, 'utf8');
  const root = postcss.parse(css, { from: filePath });
  const cssLoopValidation = validateCssLoops(root, filename);
  cssLoopTotal += cssLoopValidation.count;
  validateTileLoopBindings(root, filename, cssLoopValidation.tileKeyframes);
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) {
    throw new Error(`${filename}: missing reduced-motion CSS`);
  }
  if (!/background-size:\s*100%\s+160px/i.test(css)) {
    throw new Error(`${filename}: missing exact 160px particle tile`);
  }

  const payloads = [...css.matchAll(dataSvgPattern)].map((match) => match[2]);
  if (payloads.length < 2) throw new Error(`${filename}: expected at least two SVG layers`);
  let fileSmil = 0;
  for (const [svgIndex, payload] of payloads.entries()) {
    const svg = decodeURIComponent(payload);
    validateSvgSafety(svg, filename, svgIndex);
    fileSmil += validateSmil(svg, filename, svgIndex);
    await sharp(Buffer.from(svg)).resize(500, 800).png().toBuffer();
    svgTotal += 1;
  }
  smilTotal += fileSmil;
  console.log(`${filename}: ${payloads.length} SVG, ${fileSmil} SMIL`);
}

console.log(JSON.stringify({ themes: filenames.length, svgs: svgTotal, smil: smilTotal, cssLoops: cssLoopTotal }));
