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
  'goryeo-celadon.css',
  'retro-8bit-arcade.css'
];

const expectedMotionIdentities = new Map([
  ['autumn.css', ['herbarium-press', 'vein-ignition', 'leaf-curl-settle']],
  ['sakura.css', ['nacre-polarization', 'sequential-bloom', 'silk-tassel-wave']],
  ['snow.css', ['dendrite-growth', 'bragg-diffraction', 'frost-sublimation']],
  ['cyberpunk.css', ['packet-handoff', 'gate-latch', 'closed-rail-courier']],
  ['prism.css', ['iris-calibration', 'spectral-split', 'photon-reflection']],
  ['volcano.css', ['crack-propagation', 'pressure-vent', 'ballistic-ember']],
  ['medieval.css', ['forge-temper', 'chain-tension', 'ballistic-spark']],
  ['oriental.css', ['hinge-articulation', 'patina-infiltration', 'ring-pendulum']],
  ['royal.css', ['prong-articulation', 'gem-internal-reflection', 'embroidery-stitch']],
  ['stained-glass-nocturne.css', ['moon-incidence', 'lead-shadow', 'caustic-projection']],
  ['ginkgo-lacquer-wind.css', ['goldfoil-inversion', 'calligraphy-wind', 'layered-aerodynamics']],
  ['abyssal-reliquary.css', ['pearl-interference', 'viscous-current', 'species-swim']],
  ['goryeo-celadon.css', ['glaze-caustic', 'crane-procession', 'crackle-branchlight']],
  ['retro-8bit-arcade.css', ['crt-retrace-lock', 'sprite-step-quest', 'phosphor-palette-cycle']]
]);

const expectedTokens = [...expectedMotionIdentities.values()].flat();
if (new Set(expectedTokens).size !== expectedTokens.length) {
  throw new Error('Motion identity registry contains duplicate tokens');
}

const svgDetailRequirements = [
  { role: 'base', minShapes: 24, minPathCharacters: 1000, minGradients: 3, minMotionKinds: 3 },
  { role: 'micro-detail', minShapes: 7, minPathCharacters: 200, minGradients: 1, minMotionKinds: 2 },
  { role: 'particle/projection', minShapes: 4, minPathCharacters: 100, minGradients: 0, minMotionKinds: 3 }
];
const smilIdOwners = new Map();

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
  const tileKeyframes = [];
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
        tileKeyframes.push({
          name: atRule.params.trim(),
          scope: conditionalScopeForNode(atRule)
        });
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

const conditionalScopeForNode = (node) => {
  const scope = [];
  let current = node.parent;
  while (current) {
    if (current.type === 'atrule' && /^(?:media|supports)$/i.test(current.name)) {
      scope.unshift({
        name: current.name.trim().toLowerCase(),
        params: current.params
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*([():,])\s*/g, '$1')
          .toLowerCase()
      });
    }
    current = current.parent;
  }
  return scope;
};

const conditionalScopeKey = (scope) => JSON.stringify(scope);

const conditionalScopeLabel = (scope) => scope.length
  ? scope.map(({ name, params }) => `@${name} ${params}`).join(' > ')
  : '<root>';

const isScopeAvailableTo = (definitionScope, useScope) => definitionScope.length <= useScope.length
  && definitionScope.every((segment, index) =>
    segment.name === useScope[index].name && segment.params === useScope[index].params
  );

const isStaticOutputScope = (scope) => scope.some(({ name, params }) => {
  if (name !== 'media') return false;
  const queries = splitTopLevelCssLayers(params);
  return queries.length > 0 && queries.every((query) => {
    const normalized = query.trim().toLowerCase();
    if (/^not(?:\s|\()/.test(normalized)) return false;
    const reducedMotionOnly = /\(prefers-reduced-motion:reduce\)/.test(normalized);
    const printOnly = /^(?:only\s+)?print(?:\s+and\b|$)/.test(normalized);
    return reducedMotionOnly || printOnly;
  });
});

const stripImportant = (value) => value.replace(/\s*!important\s*$/i, '').trim();
const exactTileSizePattern = /^100%\s+160px$/i;
const validVerticalRepeatPattern = /^(?:repeat|repeat-y)$/i;

const topLevelSlashIndex = (value) => {
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === '/' && depth === 0) {
      return index;
    }
  }
  return -1;
};

const topLevelCssText = (value) => {
  let depth = 0;
  let quote = '';
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
      result += ' ';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += ' ';
    } else if (character === '(') {
      depth += 1;
      result += ' ';
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
      result += ' ';
    } else {
      result += depth === 0 ? character : ' ';
    }
  }
  return result;
};

const normalizedBackgroundRepeat = (value) => {
  const tokens = (topLevelCssText(stripImportant(value)).toLowerCase().match(
    /(?:^|\s)(repeat-x|repeat-y|no-repeat|repeat|space|round)(?=\s|$)/g
  ) ?? []).map((token) => token.trim());
  if (!tokens.length) return 'repeat';
  if (tokens.length === 1) return tokens[0];
  if (tokens[0] === 'repeat' && tokens[1] === 'repeat') return 'repeat';
  if (tokens[0] === 'no-repeat' && tokens[1] === 'repeat') return 'repeat-y';
  if (tokens[0] === 'repeat' && tokens[1] === 'no-repeat') return 'repeat-x';
  return tokens.join(' ');
};

const parseBackgroundShorthand = (value) => splitTopLevelCssLayers(stripImportant(value)).map((layer) => {
  const slashIndex = topLevelSlashIndex(layer);
  const sizeTail = slashIndex >= 0 ? topLevelCssText(layer.slice(slashIndex + 1)).trim() : '';
  const exactTileMatch = sizeTail.match(/^100%\s+160px(?=\s|$)/i);
  return {
    size: exactTileMatch ? '100% 160px' : '<other>',
    repeat: normalizedBackgroundRepeat(layer)
  };
});

const parseBackgroundSizes = (value) => splitTopLevelCssLayers(stripImportant(value))
  .map((size) => size.replace(/\s+/g, ' ').trim());

const parseBackgroundRepeats = (value) => splitTopLevelCssLayers(stripImportant(value))
  .map(normalizedBackgroundRepeat);

const setScopedCascadeValue = (binding, property, value, declaration, order) => {
  const current = binding[property];
  const important = !!declaration.important;
  if (current?.important && !important) return;
  binding[property] = { value, important, order };
};

const collectScopedTileBindings = (root) => {
  const bindings = new Map();
  let order = 0;
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    const scope = conditionalScopeForNode(rule);
    const scopeKey = conditionalScopeKey(scope);
    for (const selector of splitSelectors(rule.selector)) {
      const key = `${scopeKey}\u0000${selector}`;
      const binding = bindings.get(key) ?? {
        selector,
        scope,
        backgroundSizes: null,
        backgroundRepeats: null,
        animationNames: null
      };
      for (const declaration of rule.nodes ?? []) {
        if (declaration.type !== 'decl') continue;
        order += 1;
        const property = declaration.prop.trim().toLowerCase();
        const value = declaration.value.trim();
        if (property === 'background') {
          const layers = parseBackgroundShorthand(value);
          setScopedCascadeValue(binding, 'backgroundSizes', layers.map((layer) => layer.size), declaration, order);
          setScopedCascadeValue(binding, 'backgroundRepeats', layers.map((layer) => layer.repeat), declaration, order);
        } else if (property === 'background-size') {
          setScopedCascadeValue(binding, 'backgroundSizes', parseBackgroundSizes(value), declaration, order);
        } else if (property === 'background-repeat') {
          setScopedCascadeValue(binding, 'backgroundRepeats', parseBackgroundRepeats(value), declaration, order);
        } else if (property === 'animation' || property === 'animation-name') {
          setScopedCascadeValue(binding, 'animationNames', stripImportant(value), declaration, order);
        }
      }
      bindings.set(key, binding);
    }
  });
  return [...bindings.values()];
};

const cascadeValueWins = (candidate, current) => !!candidate && (
  !current
  || (candidate.important && !current.important)
  || (candidate.important === current.important && candidate.order >= current.order)
);

const resolveEffectiveTileBindings = (bindings) => bindings.map((target) => {
  const effective = {
    selector: target.selector,
    scope: target.scope,
    backgroundSizes: null,
    backgroundRepeats: null,
    animationNames: null
  };
  for (const source of bindings) {
    if (source.selector !== target.selector || !isScopeAvailableTo(source.scope, target.scope)) continue;
    for (const property of ['backgroundSizes', 'backgroundRepeats', 'animationNames']) {
      if (cascadeValueWins(source[property], effective[property])) effective[property] = source[property];
    }
  }
  return effective;
});

const animationUsesKeyframe = (animation, keyframeName) => {
  if (!animation) return false;
  const escapedName = keyframeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s,])${escapedName}(?=$|[\\s,])`).test(animation);
};

const animationIsDisabled = (animation) => {
  if (!animation) return false;
  const layers = splitTopLevelCssLayers(stripImportant(animation).toLowerCase());
  return layers.length > 0 && layers.every((layer) => layer === 'none');
};

const bindingHasValidTileRepeat = (binding) => {
  const sizes = binding.backgroundSizes?.value ?? [];
  const repeats = binding.backgroundRepeats?.value ?? [];
  return sizes.every((size, index) => {
    if (!exactTileSizePattern.test(size)) return true;
    const repeat = repeats[index % Math.max(1, repeats.length)] ?? '';
    return validVerticalRepeatPattern.test(repeat);
  });
};

const validateTileLoopBindings = (root, filename, tileKeyframes) => {
  const bindings = resolveEffectiveTileBindings(collectScopedTileBindings(root));
  for (const binding of bindings) {
    const sizes = binding.backgroundSizes?.value ?? [];
    if (!sizes.some((size) => exactTileSizePattern.test(size))) continue;
    const animation = binding.animationNames?.value ?? '';
    if (!bindingHasValidTileRepeat(binding)) {
      throw new Error(
        `${filename}: ${binding.selector} in ${conditionalScopeLabel(binding.scope)} uses 100% 160px without `
        + 'an effective same-scope repeat/repeat-y layer'
      );
    }
    if (isStaticOutputScope(binding.scope) && animationIsDisabled(animation)) continue;

    const availableTileKeyframes = tileKeyframes.filter(({ scope }) => isScopeAvailableTo(scope, binding.scope));
    const hasExactTileMotion = availableTileKeyframes.some(({ name }) =>
      animationUsesKeyframe(animation, name)
    );
    if (!hasExactTileMotion) {
      throw new Error(
        `${filename}: ${binding.selector} in ${conditionalScopeLabel(binding.scope)} uses 100% 160px without `
        + 'an available exact 160px tile loop'
      );
    }
  }

  for (const keyframe of tileKeyframes) {
    const hasBinding = bindings.some((binding) => {
      const sizes = binding.backgroundSizes?.value ?? [];
      if (!sizes.some((size) => exactTileSizePattern.test(size))) return false;
      const animation = binding.animationNames?.value ?? '';
      if (isStaticOutputScope(binding.scope) && animationIsDisabled(animation)) return false;
      return isScopeAvailableTo(keyframe.scope, binding.scope)
        && animationUsesKeyframe(animation, keyframe.name)
        && bindingHasValidTileRepeat(binding);
    });
    if (!hasBinding) {
      throw new Error(
        `${filename} @keyframes ${keyframe.name} in ${conditionalScopeLabel(keyframe.scope)}: `
        + '160px tile loop is never applied by a valid scoped repeating tile'
      );
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
  if (animations.length < 6 || animations.length > 8) {
    throw new Error(`${filename} SVG ${svgIndex + 1}: SMIL count ${animations.length}, expected 6..8`);
  }

  const motionKinds = new Set();
  const durations = new Set();
  const beginOffsets = new Set();
  const themeIdPrefix = path.basename(filename, '.css').split('-')[0];

  for (const { tag, attributes } of animations) {
    const lowerTag = tag.toLowerCase();
    const id = attr(attributes, 'id');
    if (!id) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: every SMIL element requires an id`);
    }
    if (!id.startsWith(`${themeIdPrefix}-`)) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: SMIL id ${id} must start with ${themeIdPrefix}-`);
    }
    const priorOwner = smilIdOwners.get(id);
    if (priorOwner) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: duplicate SMIL id ${id}, first used by ${priorOwner}`);
    }
    smilIdOwners.set(id, `${filename} SVG ${svgIndex + 1}`);

    const duration = attr(attributes, 'dur');
    const seconds = Number(duration.replace(/s$/i, ''));
    if (lowerTag !== 'set' && (!duration.endsWith('s') || !Number.isFinite(seconds) || seconds < 2.8)) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: invalid duration ${duration || '<missing>'}`);
    }
    if (lowerTag !== 'set' && attr(attributes, 'repeatCount') !== 'indefinite') {
      throw new Error(`${filename} SVG ${svgIndex + 1}: repeatCount must be indefinite`);
    }
    if (lowerTag !== 'set') {
      durations.add(seconds);
      const begin = attr(attributes, 'begin');
      const beginSeconds = Number(begin.replace(/s$/i, ''));
      if (!/^-\d*\.?\d+s$/i.test(begin) || !Number.isFinite(beginSeconds) || beginSeconds >= 0) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: ${id} requires a finite negative begin offset`);
      }
      beginOffsets.add(beginSeconds);
    }

    const attributeName = attr(attributes, 'attributeName').toLowerCase();
    motionKinds.add(`${lowerTag}:${attributeName || 'motion'}`);
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
    const motionPath = attr(attributes, 'path');
    const usesClosedMotionPath = lowerTag === 'animatemotion' && /z\s*$/i.test(motionPath);
    if (lowerTag !== 'set' && !values && !usesClosedMotionPath) {
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

      if (attributeName === 'd') {
        const commandSignature = (value) => [...value.matchAll(/([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)/g)].map((match) => ({
          command: match[1].toLowerCase(),
          numberCount: (match[2].match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).length
        }));
        const signatures = sequence.map(commandSignature);
        const reference = JSON.stringify(signatures[0]);
        if (signatures.some((signature) => JSON.stringify(signature) !== reference)) {
          throw new Error(`${filename} SVG ${svgIndex + 1}: incompatible path morph arity in ${id}`);
        }
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

    if (usesClosedMotionPath && !values) {
      const rawKeyTimes = attr(attributes, 'keyTimes');
      const keyTimes = rawKeyTimes.split(';').map((value) => Number(value.trim()));
      if (
        !rawKeyTimes
        || keyTimes.length < 2
        || keyTimes.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
        || Math.abs(keyTimes[0]) > 0.000001
        || Math.abs(keyTimes.at(-1) - 1) > 0.000001
        || keyTimes.some((value, index) => index > 0 && value <= keyTimes[index - 1])
      ) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: invalid keyTimes for closed animateMotion path`);
      }

      const calcMode = attr(attributes, 'calcMode').toLowerCase();
      const rawKeySplines = attr(attributes, 'keySplines');
      if (calcMode === 'spline') {
        const splines = rawKeySplines.split(';').map((segment) =>
          segment.trim().split(/[ ,]+/).filter(Boolean).map(Number)
        );
        if (
          !rawKeySplines
          || splines.length !== keyTimes.length - 1
          || splines.some((segment) =>
            segment.length !== 4
            || segment.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
          )
        ) {
          throw new Error(`${filename} SVG ${svgIndex + 1}: invalid keySplines for closed animateMotion path`);
        }
      } else if (rawKeySplines) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: keySplines requires calcMode="spline"`);
      }
    }

    const keyPoints = attr(attributes, 'keyPoints');
    if (keyPoints) {
      const points = keyPoints.split(';').map((value) => value.trim()).filter(Boolean);
      const numericPoints = points.map(Number);
      if (usesClosedMotionPath) {
        if (
          numericPoints.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
          || Math.abs(numericPoints[0]) > 0.000001
          || Math.abs(numericPoints.at(-1) - 1) > 0.000001
          || numericPoints.some((value, index) => index > 0 && value <= numericPoints[index - 1])
        ) {
          throw new Error(`${filename} SVG ${svgIndex + 1}: invalid keyPoints for closed animateMotion path`);
        }
      } else if (points[0] !== points.at(-1)) {
        throw new Error(`${filename} SVG ${svgIndex + 1}: non-seamless keyPoints`);
      }
    }
  }

  const minimumMotionKinds = svgDetailRequirements[svgIndex]?.minMotionKinds ?? 2;
  if (motionKinds.size < minimumMotionKinds) {
    throw new Error(
      `${filename} SVG ${svgIndex + 1}: only ${motionKinds.size} motion kind(s), expected at least ${minimumMotionKinds}`
    );
  }
  if (durations.size < 3 || beginOffsets.size < 3) {
    throw new Error(
      `${filename} SVG ${svgIndex + 1}: expected at least three distinct durations and negative phases, found `
      + `${durations.size}/${beginOffsets.size}`
    );
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
  const ids = [...svg.matchAll(/\bid=['"]([^'"]+)['"]/gi)].map((match) => match[1]);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    throw new Error(`${filename} SVG ${svgIndex + 1}: duplicate SVG id ${duplicate}`);
  }

  const localReferences = new Set(
    [...svg.matchAll(/url\(\s*#([^)\s]+)\s*\)/gi)].map((match) => match[1])
  );
  for (const match of svg.matchAll(/\b(?:href|xlink:href)=['"]([^'"]+)['"]/gi)) {
    if (!match[1].startsWith('#')) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: external href ${match[1]}`);
    }
    localReferences.add(match[1].slice(1));
  }
  for (const reference of localReferences) {
    if (!uniqueIds.has(reference)) {
      throw new Error(`${filename} SVG ${svgIndex + 1}: unresolved local reference #${reference}`);
    }
  }

  const detail = svgDetailRequirements[svgIndex];
  if (!detail) return;
  const shapeCount = (svg.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line|use)\b/gi) ?? []).length;
  const pathCharacters = [...svg.matchAll(/\bd=['"]([^'"]+)['"]/gi)]
    .reduce((total, match) => total + match[1].length, 0);
  const gradientCount = (svg.match(/<(?:linear|radial)Gradient\b/gi) ?? []).length;
  if (
    shapeCount < detail.minShapes
    || pathCharacters < detail.minPathCharacters
    || gradientCount < detail.minGradients
  ) {
    throw new Error(
      `${filename} SVG ${svgIndex + 1} (${detail.role}): detail density `
      + `${shapeCount} shapes/${pathCharacters} path chars/${gradientCount} gradients; expected at least `
      + `${detail.minShapes}/${detail.minPathCharacters}/${detail.minGradients}`
    );
  }
};

const validateMotionIdentity = (css, decodedSvgs, filename) => {
  const expected = expectedMotionIdentities.get(filename);
  if (!expected) return;

  const identityComment = css.match(/Motion identity:\s*([^\r\n*]+)/i);
  if (!identityComment) throw new Error(`${filename}: missing Motion identity header`);
  const actual = identityComment[1].split('/').map((token) => token.trim().toLowerCase()).filter(Boolean);
  if (actual.length !== 3 || actual.some((token, index) => token !== expected[index])) {
    throw new Error(`${filename}: Motion identity must be ${expected.join(' / ')}`);
  }

  const keyframeNames = [...css.matchAll(/@(?:-webkit-)?keyframes\s+([^\s{]+)/gi)].map((match) => match[1].toLowerCase());
  const smilIds = decodedSvgs.flatMap((svg) => [...svg.matchAll(
    /<(?:animate(?:Color|Motion|Transform)?|set)\b[^>]*\bid=['"]([^'"]+)['"]/gi
  )].map((match) => match[1].toLowerCase()));
  const implementationIds = [...keyframeNames, ...smilIds];
  for (const token of expected) {
    if (!implementationIds.some((identifier) => identifier.includes(token))) {
      throw new Error(`${filename}: Motion identity token ${token} is not linked to a SMIL id or keyframe`);
    }
  }
};

const validateCssContract = (root, filename) => {
  const className = `.cb-${path.basename(filename, '.css')}`;
  const declarations = new Map();
  let hasBefore = false;
  let hasAfter = false;
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    const selectors = splitSelectors(rule.selector);
    if (selectors.includes(className)) {
      for (const node of rule.nodes ?? []) {
        if (node.type === 'decl') declarations.set(node.prop.toLowerCase(), node.value.trim().toLowerCase());
      }
    }
    if (selectors.includes(`${className}::before`)) hasBefore = true;
    if (selectors.includes(`${className}::after`)) hasAfter = true;
  });

  const required = new Map([
    ['position', 'absolute'],
    ['inset', '0'],
    ['z-index', '5'],
    ['border-radius', '3.43px'],
    ['pointer-events', 'none'],
    ['overflow', 'hidden']
  ]);
  for (const [property, expected] of required) {
    if (declarations.get(property) !== expected) {
      throw new Error(`${filename}: ${className} requires ${property}: ${expected}`);
    }
  }
  if (!hasBefore || !hasAfter) {
    throw new Error(`${filename}: ${className} requires both ::before and ::after layers`);
  }
  root.walkDecls((declaration) => {
    if (isInsideKeyframes(declaration) || declaration.prop.toLowerCase() !== 'animation') return;
    const value = declaration.value.trim().toLowerCase();
    if (/^none(?:\s*!important)?$/.test(value)) return;
    const durations = [...value.matchAll(/(?:^|\s)(\d*\.?\d+)s\b/g)].map((match) => Number(match[1]));
    if (!durations.length || durations.some((duration) => !Number.isFinite(duration) || duration < 2.8)) {
      throw new Error(`${filename}: CSS animation duration must be at least 2.8s (${declaration.value})`);
    }
    if (!/\binfinite\b/.test(value)) {
      throw new Error(`${filename}: CSS animation must loop infinitely (${declaration.value})`);
    }
  });
  root.walkAtRules((atRule) => {
    if (/(?:^|-)keyframes$/i.test(atRule.name) && /breathe/i.test(atRule.params)) {
      throw new Error(`${filename}: generic breathe keyframes are not allowed`);
    }
  });
};

const splitTopLevelCssLayers = (value) => {
  const layers = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers.filter(Boolean);
};

const isZeroAlphaColor = (token) => {
  const normalized = token.toLowerCase().replace(/\s+/g, '');
  if (normalized === 'transparent') return true;
  if (/^#[0-9a-f]{4}$/i.test(normalized)) return normalized.at(-1) === '0';
  if (/^#[0-9a-f]{8}$/i.test(normalized)) return normalized.endsWith('00');
  if (!/^(?:rgba?|hsla?)\(/i.test(normalized)) return false;
  const body = normalized.slice(normalized.indexOf('(') + 1, -1);
  const slashAlpha = body.match(/\/(-?\d*\.?\d+)%?$/)?.[1];
  if (slashAlpha !== undefined) return Number(slashAlpha) === 0;
  const components = body.split(',');
  return components.length === 4 && Number(components[3].replace(/%$/, '')) === 0;
};

const validateNoTransparentDummyLayers = (root, filename) => {
  root.walkDecls(/^background(?:-image)?$/i, (declaration) => {
    for (const layer of splitTopLevelCssLayers(declaration.value)) {
      if (!/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(layer)) continue;
      const colors = layer.match(/transparent|#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([^)]*\)/gi) ?? [];
      if (colors.length >= 2 && colors.every(isZeroAlphaColor)) {
        throw new Error(`${filename}: fully transparent dummy gradient layer is not allowed (${layer})`);
      }
    }
  });
};

const tileBindingRegressionFixtures = [
  {
    name: 'background shorthand orphan',
    shouldReject: true,
    css: `
      @media not print {
        .fixture-shorthand {
          background: linear-gradient(#fff, #000) center/100% 160px repeat-y;
          animation: none;
        }
      }
    `
  },
  {
    name: 'media and supports scope hiding',
    shouldReject: true,
    css: [
      `
        .fixture-media {
          background-size: 100% 160px;
          background-repeat: no-repeat;
          animation: none;
        }

        @media screen {
          .fixture-media {
            background-size: 100% 160px;
            background-repeat: repeat-y;
            animation: fixture-media-tile 4s linear infinite;
          }
        }

        @keyframes fixture-media-tile {
          0% { background-position-y: 0; }
          100% { background-position-y: 160px; }
        }
      `,
      `
        @media screen {
          .fixture-supports {
            background-size: 100% 160px;
            background-repeat: no-repeat;
            animation: none;
          }

          @supports (display: grid) {
            .fixture-supports {
              background-size: 100% 160px;
              background-repeat: repeat-y;
              animation: fixture-supports-tile 4s linear infinite;
            }
          }
        }

        @keyframes fixture-supports-tile {
          0% { background-position-y: 0; }
          100% { background-position-y: 160px; }
        }
      `
    ]
  },
  {
    name: 'reduced motion and print static overrides',
    shouldReject: false,
    css: `
      .fixture-static {
        background: linear-gradient(#fff, #000) center / 100% 160px repeat-y;
        animation: fixture-static-tile 4s linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .fixture-static {
          animation: none !important;
        }
      }

      @media print {
        .fixture-static {
          animation-name: none !important;
        }
      }

      @keyframes fixture-static-tile {
        0% { background-position: 0 0; }
        100% { background-position: 0 160px; }
      }
    `
  },
  {
    name: 'static scope inherited tile no-repeat clipping',
    shouldReject: true,
    css: [
      `
        .fixture-reduced-clip {
          background-size: 100% 160px;
          background-repeat: repeat-y;
          animation: fixture-reduced-clip-tile 4s linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .fixture-reduced-clip {
            background-repeat: no-repeat;
            animation: none !important;
          }
        }

        @keyframes fixture-reduced-clip-tile {
          0% { background-position-y: 0; }
          100% { background-position-y: 160px; }
        }
      `,
      `
        .fixture-print-clip {
          background-size: 100% 160px;
          background-repeat: repeat-y;
          animation: fixture-print-clip-tile 4s linear infinite;
        }

        @media print {
          .fixture-print-clip {
            background-repeat: no-repeat;
            animation-name: none !important;
          }
        }

        @keyframes fixture-print-clip-tile {
          0% { background-position-y: 0; }
          100% { background-position-y: 160px; }
        }
      `
    ]
  }
];

const runTileBindingRegressionFixtures = () => {
  for (const fixture of tileBindingRegressionFixtures) {
    const cssCases = Array.isArray(fixture.css) ? fixture.css : [fixture.css];
    for (const [caseIndex, css] of cssCases.entries()) {
      let failure = null;
      try {
        const fixtureRoot = postcss.parse(css, { from: `${fixture.name}-${caseIndex + 1}.css` });
        const { tileKeyframes } = validateCssLoops(fixtureRoot, fixture.name);
        validateTileLoopBindings(fixtureRoot, fixture.name, tileKeyframes);
      } catch (error) {
        failure = error;
      }

      if (fixture.shouldReject) {
        if (!failure || !/100% 160px/.test(failure.message)) {
          throw new Error(
            `Tile binding regression fixture "${fixture.name}" case ${caseIndex + 1} was not rejected `
            + 'for its orphan 100% 160px layer'
          );
        }
      } else if (failure) {
        throw new Error(
          `Tile binding regression fixture "${fixture.name}" case ${caseIndex + 1} failed: ${failure.message}`
        );
      }
    }
  }
};

runTileBindingRegressionFixtures();

let svgTotal = 0;
let smilTotal = 0;
let cssLoopTotal = 0;
for (const filename of filenames) {
  const filePath = path.resolve(repositoryRoot, 'card-borders', filename);
  const css = fs.readFileSync(filePath, 'utf8');
  const root = postcss.parse(css, { from: filePath });
  validateCssContract(root, filename);
  const cssLoopValidation = validateCssLoops(root, filename);
  cssLoopTotal += cssLoopValidation.count;
  validateTileLoopBindings(root, filename, cssLoopValidation.tileKeyframes);
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) {
    throw new Error(`${filename}: missing reduced-motion CSS`);
  }
  validateNoTransparentDummyLayers(root, filename);
  const payloads = [...css.matchAll(dataSvgPattern)].map((match) => match[2]);
  if (expectedMotionIdentities.has(filename) && payloads.length !== 3) {
    throw new Error(`${filename}: expected exactly three SVG layers, found ${payloads.length}`);
  }
  if (payloads.length < 2) throw new Error(`${filename}: expected at least two SVG layers`);
  const decodedSvgs = payloads.map((payload) => decodeURIComponent(payload));
  validateMotionIdentity(css, decodedSvgs, filename);
  let fileSmil = 0;
  for (const [svgIndex, svg] of decodedSvgs.entries()) {
    validateSvgSafety(svg, filename, svgIndex);
    fileSmil += validateSmil(svg, filename, svgIndex);
    await sharp(Buffer.from(svg)).resize(500, 800).png().toBuffer();
    svgTotal += 1;
  }
  if (expectedMotionIdentities.has(filename) && (fileSmil < 20 || fileSmil > 24)) {
    throw new Error(`${filename}: SMIL count ${fileSmil}, expected 20..24`);
  }
  smilTotal += fileSmil;
  console.log(`${filename}: ${payloads.length} SVG, ${fileSmil} SMIL`);
}

console.log(JSON.stringify({ themes: filenames.length, svgs: svgTotal, smil: smilTotal, cssLoops: cssLoopTotal }));
