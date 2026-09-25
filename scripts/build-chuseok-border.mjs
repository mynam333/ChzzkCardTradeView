import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Embed the supplied WebP bytes unchanged. No SVG wrapper or new artwork.
// Usage: node scripts/build-chuseok-border.mjs "<directory containing the six .txt files>"
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repository, 'frontend/package.json'));
const sharp = require('sharp');
const sourceDirectory = process.argv[2] ?? 'C:/Users/mynam/Downloads/한가위테두리';
const output = path.join(repository, 'card-borders/chuseok-harvest-moon.css');
const width = 992;
const height = 1586;
const hingeY = 1410;
const percent = (n, size) => `${Number((n / size * 100).toFixed(8))}%`;
const move = (x, y) => `translate3d(${percent(x, width)}, ${percent(y, height)}, 0)`;
const assets = {};
for (const [key, filename] of Object.entries({ moon: '달', frame: '테두리', cloud1: '구름1', cloud2: '구름2', cloud3: '구름3', rice: '벼' })) {
  const input = fs.readFileSync(path.join(sourceDirectory, `${filename}.txt`), 'utf8').trim();
  const base64 = input.replace(/^data:image\/webp;base64,/i, '').replace(/\s+/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error(`${filename}: invalid WebP base64`);
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) throw new Error(`${filename}: non-canonical WebP base64`);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'webp' || metadata.width !== width || metadata.height !== height || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) {
    throw new Error(`${filename}: expected one transparent ${width}x${height} WebP`);
  }
  assets[key] = `url("data:image/webp;base64,${base64}")`;
}

const css = `/* Chuseok Harvest Moon: supplied WebP artwork, revision 7.
   Motion identity: three-cloud-parallax / harvest-moon-libration / panicle-wind-bow
   Requires CosmeticFrame's chuseok-webp-v1 decorative layers for motion.
   Back to front: moon / fixed frame / clouds and rooted rice together.
   Without the enhanced component the same CSS renders a complete static fallback.
   WebP bytes are unchanged; SVG/SMIL is replaced by closed CSS transform loops.
   Rice y >= ${hingeY} remains fixed. Its canopy bends around that same join. */
.cb-chuseok-harvest-moon {
  --cosmetic-frame-layout: chuseok-webp-v1;
  --chuseok-revision: 7;
  ${Object.entries(assets).map(([key, value]) => `--chuseok-${key}: ${value};`).join('\n  ')}
  --chuseok-rice-hinge: ${percent(hingeY, height)};
  --chuseok-rice-foot: ${percent(height - hingeY, height)};
  position: absolute;
  inset: 0;
  z-index: 5;
  border-radius: 3.43px;
  pointer-events: none;
  overflow: hidden;
  isolation: isolate;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-position: center;
  background-image: var(--chuseok-rice), var(--chuseok-cloud3), var(--chuseok-cloud2), var(--chuseok-cloud1), var(--chuseok-frame), var(--chuseok-moon);
  box-shadow: 0 0 10px rgba(218, 181, 104, .2);
  animation: none !important;
  transform: none !important;
  filter: none !important;
}
.cb-chuseok-harvest-moon::before,
.cb-chuseok-harvest-moon::after { content: none; }
.cb-chuseok-harvest-moon[data-cosmetic-layout="chuseok-webp-v1"] { background-image: none; }

.cb-chuseok-harvest-moon [data-cosmetic-layer] {
  display: block;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-position: center;
  transform-style: flat;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="moon"] {
  z-index: 0;
  background-image: var(--chuseok-moon);
  animation: chuseok-harvest-moon-libration 18.8s cubic-bezier(.42, 0, .58, 1) -7.1s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="frame"] {
  z-index: 1;
  background-image: var(--chuseok-frame);
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="front"] {
  z-index: 2;
  isolation: isolate;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="frame"],
.cb-chuseok-harvest-moon [data-cosmetic-layer="front"],
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-base"] {
  animation: none !important;
  transform: none !important;
  filter: none !important;
  opacity: 1;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="cloud-1"] {
  background-image: var(--chuseok-cloud1);
  animation: chuseok-three-cloud-parallax-one 15.6s cubic-bezier(.42, 0, .58, 1) -8.3s infinite,
    chuseok-three-cloud-parallax-depth-one 9.7s cubic-bezier(.42, 0, .58, 1) -4.8s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="cloud-2"] {
  animation: chuseok-three-cloud-parallax-two 13.9s cubic-bezier(.42, 0, .58, 1) -7.4s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="cloud-2-turn"] {
  background-image: var(--chuseok-cloud2);
  transform-origin: ${percent(675, width)} ${percent(242, height)};
  animation: chuseok-three-cloud-parallax-turn 17.9s cubic-bezier(.42, 0, .58, 1) -10.2s infinite,
    chuseok-three-cloud-parallax-silk-two 18.3s cubic-bezier(.42, 0, .58, 1) -10.4s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="cloud-3"] {
  background-image: var(--chuseok-cloud3);
  animation: chuseok-three-cloud-parallax-three 12.6s cubic-bezier(.42, 0, .58, 1) -5.9s infinite,
    chuseok-three-cloud-parallax-depth-three 10.9s cubic-bezier(.42, 0, .58, 1) -6.7s infinite,
    chuseok-three-cloud-parallax-silk-three 16.8s cubic-bezier(.42, 0, .58, 1) -8.9s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-base"] {
  background-image: var(--chuseok-rice);
  clip-path: inset(var(--chuseok-rice-hinge) 0 0 0);
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-canopy"] {
  clip-path: inset(0 0 var(--chuseok-rice-foot) 0);
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-sway"],
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-tension"] {
  transform-origin: 0 var(--chuseok-rice-hinge);
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-sway"] {
  animation: chuseok-panicle-wind-bow 11.7s cubic-bezier(.42, 0, .58, 1) -8.1s infinite;
}
.cb-chuseok-harvest-moon [data-cosmetic-layer="rice-tension"] {
  background-image: var(--chuseok-rice);
  animation: chuseok-panicle-wind-bow-tension 14.8s cubic-bezier(.42, 0, .58, 1) -5.7s infinite,
    chuseok-panicle-wind-bow-light 16.1s cubic-bezier(.42, 0, .58, 1) -9.2s infinite;
}

@keyframes chuseok-harvest-moon-libration {
  0%, 100% { transform: ${move(0, 0)}; }
  50% { transform: ${move(-3, -9)}; }
}
@keyframes chuseok-three-cloud-parallax-one {
  0%, 100% { transform: ${move(0, 0)}; }
  22% { transform: ${move(7, -2)}; }
  49% { transform: ${move(13, 1)}; }
  77% { transform: ${move(5, 3)}; }
}
@keyframes chuseok-three-cloud-parallax-depth-one {
  0%, 100% { opacity: .96; }
  30% { opacity: 1; }
  69% { opacity: .975; }
}
@keyframes chuseok-three-cloud-parallax-two {
  0%, 100% { transform: ${move(0, 0)}; }
  25% { transform: ${move(-6, -2)}; }
  52% { transform: ${move(10, -1)}; }
  80% { transform: ${move(4, 3)}; }
}
@keyframes chuseok-three-cloud-parallax-turn {
  0%, 100% { transform: rotate(0deg); }
  21% { transform: rotate(-.38deg); }
  49% { transform: rotate(.46deg); }
  76% { transform: rotate(-.16deg); }
}
@keyframes chuseok-three-cloud-parallax-silk-two {
  0%, 100% { filter: brightness(1); }
  32% { filter: brightness(1.02); }
  73% { filter: brightness(1.006); }
}
@keyframes chuseok-three-cloud-parallax-three {
  0%, 100% { transform: ${move(0, 0)}; }
  20% { transform: ${move(-8, -2)}; }
  48% { transform: ${move(-18, 2)}; }
  78% { transform: ${move(-7, 4)}; }
}
@keyframes chuseok-three-cloud-parallax-depth-three {
  0%, 100% { opacity: .975; }
  27% { opacity: 1; }
  68% { opacity: .986; }
}
@keyframes chuseok-three-cloud-parallax-silk-three {
  0%, 100% { filter: brightness(1); }
  28% { filter: brightness(1.018); }
  69% { filter: brightness(1.006); }
}
@keyframes chuseok-panicle-wind-bow {
  0%, 100% { transform: skewX(0deg); }
  23% { transform: skewX(-2.4deg); }
  51% { transform: skewX(1.25deg); }
  78% { transform: skewX(-.6deg); }
}
@keyframes chuseok-panicle-wind-bow-tension {
  0%, 100% { transform: scaleY(1); }
  28% { transform: scaleY(.9986); }
  70% { transform: scaleY(1.001); }
}
@keyframes chuseok-panicle-wind-bow-light {
  0%, 100% { filter: brightness(1); }
  29% { filter: brightness(1.018); }
  70% { filter: brightness(1.004); }
}
.cb-chuseok-harvest-moon[data-cosmetic-motion-paused="true"] [data-cosmetic-layer] {
  animation-play-state: paused !important;
}
@media (prefers-reduced-motion: reduce) {
  .cb-chuseok-harvest-moon,
  .cb-chuseok-harvest-moon [data-cosmetic-layer] { animation: none !important; }
}
@media print {
  .cb-chuseok-harvest-moon,
  .cb-chuseok-harvest-moon [data-cosmetic-layer] { animation: none !important; }
}
`;

fs.writeFileSync(output, css);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(css), webpAssets: Object.keys(assets).length, svgAssets: 0, smil: 0, riceFixedFromY: hingeY }, null, 2));
