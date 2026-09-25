import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minifyCss } from '../../../backend/src/utils/css';
import { readCosmeticFrameLayers } from './cosmeticFrameLayers';

const metadata = '--cosmetic-frame-layout: layers-v1; --cosmetic-frame-layers: back, frame, front/cloud, front/rice/sway;';
const parse = (css: string, key = 'cb-custom') => readCosmeticFrameLayers(key, css);

describe('CSS-declared cosmetic layers', () => {
  it('creates ordered nested layers for arbitrary themes with no per-theme code', () => {
    const result = parse(`.cb-custom { ${metadata} }`);
    expect(result.imageLayerLayout).toBe('layers-v1');
    expect(result.layers?.map((layer) => layer.path)).toEqual(['back', 'frame', 'front', 'front/cloud', 'front/rice', 'front/rice/sway']);
    expect(result.layers?.at(-1)).toEqual({ name: 'sway', path: 'front/rice/sway', parentPath: 'front/rice' });
  });

  it('shares parents, deduplicates paths and permits the same name in separate groups', () => {
    const result = parse('.cb-custom{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:back/spark,front/spark,back/spark,front;}');
    expect(result.layers?.map((layer) => layer.path)).toEqual(['back', 'back/spark', 'front', 'front/spark']);
  });

  it('does not impose an arbitrary layer count or artwork-size limit', () => {
    const paths = Array.from({ length: 160 }, (_, i) => `group/particle-${i}`).join(',');
    const css = `.cb-custom{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:${paths};--art:url("data:image/webp;base64,${'AAAA'.repeat(260_000)}");}`;
    expect(parse(css).layers).toHaveLength(161);
  });

  it('does not interpret comments, strings, URLs, child selectors, conditions or keyframes as metadata', () => {
    for (const css of [
      `/* .cb-custom{${metadata}} */`,
      `.cb-custom{content:"{${metadata}}";--art:url(data:image/svg+xml,{${metadata}})}`,
      `.cb-custom::before{${metadata}}`,
      `.cb-custom [data-cosmetic-layer="front"]{${metadata}}`,
      `.cb-other{${metadata}}`,
      `@media(min-width:0){.cb-custom{${metadata}}}`,
      `@keyframes cb-motion{from{${metadata}}}`
    ]) expect(parse(css)).toEqual({});
  });

  it('handles comments, selector lists, root compound selectors and important declarations', () => {
    const css = `@charset "UTF-8";
      .other, .cosmetic-frame.cb-custom { /* root */ --cosmetic-frame-layout: layers-v1 !important; --cosmetic-frame-layers: back, /* group */ front/cloud !important; }
      .cb-custom { --cosmetic-frame-layout: unsupported; --cosmetic-frame-layers: ignored; }`;
    expect(parse(css).layers?.map((layer) => layer.path)).toEqual(['back', 'front', 'front/cloud']);
    expect(parse(css)).toEqual(parse(minifyCss(css)));
  });

  it('rejects invalid manifests atomically without HTML injection or partial blank layouts', () => {
    for (const manifest of ['front,,back', 'front/', '../front', 'front//back', '<img>', 'front[onclick=x]', 'var(--layers)', '"front,back"', 'Front', '1front']) {
      const result = parse(`.cb-custom{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:${manifest};}`);
      expect(result.layerError).toBeTruthy();
      expect(result.layers).toBeUndefined();
      expect(result.imageLayerLayout).toBeUndefined();
    }
    expect(parse('.cb-custom{--cosmetic-frame-layout:layers-v2}').layerError).toBeTruthy();
    expect(parse('.cb-custom{--cosmetic-frame-layout:layers-v1}').layerError).toBeTruthy();
  });

  it('keeps already-registered Chuseok v7 compatible after the real backend minifier', () => {
    const css = readFileSync(new URL('../../../card-borders/chuseok-harvest-moon.css', import.meta.url), 'utf8');
    const config = parse(css, 'cb-chuseok-harvest-moon');
    expect(config.imageLayerLayout).toBe('chuseok-webp-v1');
    expect(config.layers).toHaveLength(11);
    expect(parse(minifyCss(css), 'cb-chuseok-harvest-moon')).toEqual(config);
    expect(parse(css.replaceAll('cb-chuseok-harvest-moon', 'cb-renamed'), 'cb-renamed')).toEqual(config);
    const images = css.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g);
    expect(images).toHaveLength(6);
    expect(minifyCss(css).match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g)).toEqual(images);
  });

  it('converts the supplied artwork to a general manifest without changing any motion or image', () => {
    const css = readFileSync(new URL('../../../card-borders/chuseok-harvest-moon.css', import.meta.url), 'utf8');
    const legacy = parse(css, 'cb-chuseok-harvest-moon');
    const genericCss = css.replaceAll('chuseok-webp-v1', 'layers-v1')
      .replace('--cosmetic-frame-layout: layers-v1;', `--cosmetic-frame-layout: layers-v1;--cosmetic-frame-layers:${legacy.layers?.map((layer) => layer.path).join(',')};`);
    expect(parse(minifyCss(genericCss), 'cb-chuseok-harvest-moon').layers).toEqual(legacy.layers);
  });
});
