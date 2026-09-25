import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CosmeticFrame } from './CosmeticFrame';
import { cosmeticFrameConfig } from '../lib/cosmetics';
import { CosmeticFrameStatus } from './CosmeticFrameStatus';

const css = '.cb-chuseok-harvest-moon{--cosmetic-frame-layout:chuseok-webp-v1;}';
const border = { style_json: JSON.stringify({ class: 'cb-chuseok-harvest-moon', css }) };

describe('WebP cosmetic frame layers', () => {
  it('renders moon, fixed frame, and a shared cloud/rice foreground in that order', () => {
    const html = renderToStaticMarkup(<CosmeticFrame border={border} />).replace(/ data-cosmetic-layer-path="[^"]*"/g, '');
    expect(html).toContain('data-cosmetic-layout="chuseok-webp-v1"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<span data-cosmetic-layer="moon"></span><span data-cosmetic-layer="frame"></span><span data-cosmetic-layer="front">');
    expect(html).toContain('<span data-cosmetic-layer="front"><span data-cosmetic-layer="cloud-1">');
    expect(html).toContain('<span data-cosmetic-layer="rice-base"></span><span data-cosmetic-layer="rice-canopy"><span data-cosmetic-layer="rice-sway"><span data-cosmetic-layer="rice-tension">');
    expect(html.match(/data-cosmetic-layer=/g)).toHaveLength(11);
    expect(html).not.toContain('<svg');
  });

  it('does not add WebP children to an existing SVG theme or class-only legacy border', () => {
    for (const style of [{ class: 'cb-chuseok-harvest-moon', css: 'background:url(data:image/svg+xml,legacy)' }, { class: 'cb-sakura' }]) {
      const html = renderToStaticMarkup(<CosmeticFrame border={{ style_json: JSON.stringify(style) }} className="extra" />);
      expect(html).not.toContain('data-cosmetic-layer');
      expect(html).toContain('extra');
    }
    expect(renderToStaticMarkup(<CosmeticFrame />)).toBe('');
  });

  it('requires a real opt-in property scoped to the registered class', () => {
    expect(cosmeticFrameConfig(border.style_json).imageLayerLayout).toBe('chuseok-webp-v1');
    expect(cosmeticFrameConfig(JSON.stringify({ class: 'cb-other', css })).imageLayerLayout).toBeUndefined();
    expect(cosmeticFrameConfig(JSON.stringify({ class: 'cb-chuseok-harvest-moon', css: `/* ${css} */` })).imageLayerLayout).toBeUndefined();
    expect(cosmeticFrameConfig('invalid')).toEqual({ className: '' });
    expect(cosmeticFrameConfig('null')).toEqual({ className: '' });
  });

  it('renders arbitrary layers with stable paths and no user-supplied markup', () => {
    const styleJson = JSON.stringify({ class: 'cb-new', css: '.cb-new{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:fixed,front/mover/tilt,front/spark;}' });
    const html = renderToStaticMarkup(<CosmeticFrame border={{ style_json: styleJson }} />);
    expect(html).toContain('data-cosmetic-layout="layers-v1"');
    expect(html.match(/data-cosmetic-layer=/g)).toHaveLength(5);
    expect(html).toContain('data-cosmetic-layer-path="front/mover"><span data-cosmetic-layer="tilt"');
    expect(html).toContain('data-cosmetic-layer-path="front/mover/tilt"></span></span><span data-cosmetic-layer="spark"');
    expect(renderToStaticMarkup(<CosmeticFrameStatus styleJson={styleJson} />)).toContain('장식 레이어 5개 인식');
  });

  it('reports invalid definitions while keeping the original root fallback available', () => {
    const styleJson = JSON.stringify({ class: 'cb-new', css: '.cb-new{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:front,,back;}' });
    const html = renderToStaticMarkup(<CosmeticFrame border={{ style_json: styleJson }} />);
    expect(html).toContain('data-cosmetic-layer-error="true"');
    expect(html).not.toContain('data-cosmetic-layout=');
    expect(html).not.toContain('<span');
    const status = renderToStaticMarkup(<CosmeticFrameStatus styleJson={styleJson} />);
    expect(status).toContain('role="alert"');
    expect(status).toContain('레이어 구성 오류');
  });
});
