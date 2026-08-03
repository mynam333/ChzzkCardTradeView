import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureCosmeticCss,
  MAX_CONCURRENT_SVG_MOTION_AREA,
  MAX_CONCURRENT_SVG_MOTION_THEMES,
  migrateFramePxToContainerUnits,
  normalizeSvgInCss,
  selectActiveCosmeticSvgMotionKeys,
  stripSvgSmilAnimationsInCss
} from './cosmetics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cosmetic SVG motion handling', () => {
  it('keeps three small themes active but prioritizes engagement within the visible-area budget', () => {
    const smallCandidates = ['a', 'b', 'c', 'd'].map((key, order) => ({
      key,
      engaged: false,
      distance: order * 10,
      visibleArea: 26_000,
      order
    }));
    expect([...selectActiveCosmeticSvgMotionKeys(smallCandidates)]).toEqual(['a', 'b', 'c']);
    expect(MAX_CONCURRENT_SVG_MOTION_THEMES).toBe(3);
    expect(MAX_CONCURRENT_SVG_MOTION_AREA).toBe(90_000);

    const engagedCandidates = [
      { key: 'center', engaged: false, distance: 0, visibleArea: 40_000, order: 0 },
      { key: 'near', engaged: false, distance: 20, visibleArea: 10_000, order: 1 },
      { key: 'hovered', engaged: true, distance: 900, visibleArea: 70_000, order: 2 }
    ];
    expect([...selectActiveCosmeticSvgMotionKeys(engagedCandidates)]).toEqual(['hovered', 'near']);

    const richCandidates = [13, 11, 11].map((timelines, order) => ({
      key: `rich-${order}`,
      engaged: false,
      distance: order,
      visibleArea: 26_214.4,
      motionWeight: timelines / 7,
      order
    }));
    expect([...selectActiveCosmeticSvgMotionKeys(richCandidates)]).toEqual(['rich-0', 'rich-1']);
  });

  it('always animates one engaged oversized card without imposing a card-size limit', () => {
    const active = selectActiveCosmeticSvgMotionKeys([
      { key: 'large', engaged: true, distance: 0, visibleArea: 240_000, order: 0 },
      { key: 'small', engaged: false, distance: 10, visibleArea: 10_000, order: 1 }
    ]);

    expect([...active]).toEqual(['large']);
  });

  it('does not let repeated instances of one theme bypass the visible-area budget', () => {
    const active = selectActiveCosmeticSvgMotionKeys([
      {
        key: 'repeated',
        engaged: true,
        distance: 0,
        visibleArea: 240_000,
        visibleInstances: 12,
        order: 0
      },
      { key: 'small', engaged: false, distance: 10, visibleArea: 10_000, visibleInstances: 1, order: 1 }
    ]);

    expect([...active]).toEqual(['small']);
  });

  it('normalizes and removes self-closing and paired SMIL while preserving static SVG art', () => {
    const css = `.cb-test {
      background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160'><path id='frame' d='M1 1H99V159H1Z' stroke='#fff'/><animate attributeName='opacity' values='.8;1;.8' dur='4s' repeatCount='indefinite'/><g><animateTransform attributeName='transform' type='rotate' values='0;12;0' dur='6s' repeatCount='indefinite'></animateTransform></g></svg>");
    }`;

    const normalized = normalizeSvgInCss(css);
    const stripped = stripSvgSmilAnimationsInCss(normalized);

    expect(normalized).toMatch(/%3Canimate\b/);
    expect(normalized).toMatch(/%3CanimateTransform\b/);
    expect(stripped).not.toMatch(/%3C(?:animate|set)\b/i);
    expect(stripped).toMatch(/id='frame'/);
    expect(stripped).toMatch(/stroke='%23fff'/);
    expect(stripped).toMatch(/%3Cg%3E%3C\/g%3E/);
  });

  it('strips SMIL only inside utf8 SVG data URLs', () => {
    const encodedSmil = "%3Canimate attributeName='opacity' values='0;1;0' dur='3s' repeatCount='indefinite'/%3E";
    const css = `.x{content:"${encodedSmil}";background:url("data:image/png;base64,${encodedSmil}")}`;

    expect(stripSvgSmilAnimationsInCss(css)).toBe(css);
  });

  it('removes SMIL whose closing slash is percent-encoded like production theme SVGs', () => {
    const css = `.cb-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Cg%3E%3CanimateTransform attributeName='transform' type='rotate' values='0%3B360' dur='8s' repeatCount='indefinite'%2F%3E%3C%2Fg%3E%3Cpath d='M1 1H99V159H1Z'%3E%3Canimate attributeName='opacity' values='.7%3B1%3B.7' dur='4s' repeatCount='indefinite'%3E%3C%2Fanimate%3E%3C%2Fpath%3E%3C%2Fsvg%3E")}`;

    const stripped = stripSvgSmilAnimationsInCss(css);

    expect(stripped).not.toMatch(/%3C(?:animate(?:Color|Motion|Transform)?|set)\b/i);
    expect(stripped).toMatch(/%3Cg%3E%3C%2Fg%3E/);
    expect(stripped).toMatch(/%3Cpath\b/);
  });

  it('preserves static art between self-closing and paired animations of the same tag', () => {
    const css = `.cb-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Canimate attributeName='opacity' values='.7%3B1%3B.7' dur='4s' repeatCount='indefinite'%2F%3E%3Cpath id='KEEP' d='M2 2H98V158H2Z'%2F%3E%3Canimate attributeName='stroke-width' values='1%3B2%3B1' dur='5s' repeatCount='indefinite'%3E%3C%2Fanimate%3E%3C%2Fsvg%3E")}`;

    const stripped = stripSvgSmilAnimationsInCss(css);

    expect(stripped).not.toMatch(/%3Canimate\b/i);
    expect(stripped).toMatch(/id='KEEP'/);
    expect(stripped).toMatch(/d='M2 2H98V158H2Z'/);
  });

  it('does not let a paired animation consume a following self-closing static path', () => {
    const css = `.cb-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Canimate attributeName='opacity' values='.7%3B1%3B.7' dur='4s' repeatCount='indefinite'%3E%3C%2Fanimate%3E%3Cpath id='KEEP-AFTER' d='M3 3H97V157H3Z'%2F%3E%3C%2Fsvg%3E")}`;

    const stripped = stripSvgSmilAnimationsInCss(css);

    expect(stripped).not.toMatch(/%3Canimate\b/i);
    expect(stripped).toMatch(/id='KEEP-AFTER'/);
  });

  it('removes a paired animateMotion together with its self-closing mpath child', () => {
    const css = `.cb-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Cdefs%3E%3Cpath id='route' d='M0 0H10'%2F%3E%3C%2Fdefs%3E%3Cg id='mover'%3E%3CanimateMotion dur='6s' repeatCount='indefinite'%3E%3Cmpath href='%23route'%2F%3E%3C%2FanimateMotion%3E%3C%2Fg%3E%3C%2Fsvg%3E")}`;

    const stripped = stripSvgSmilAnimationsInCss(css);

    expect(stripped).not.toMatch(/%3C(?:animateMotion|mpath)\b/i);
    expect(stripped).not.toMatch(/%3C%2FanimateMotion%3E/i);
    expect(stripped).toMatch(/id='mover'/);
    expect(stripped).toMatch(/id='route'/);
  });

  it('keeps SVG data URLs intact while frame px values migrate to container units', () => {
    const css = `.cb-test{inset:-15px;background-size:100% 160px;background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Canimate attributeName='opacity' values='.7;1;.7' dur='4s' repeatCount='indefinite'/%3E%3C/svg%3E")}`;
    const migrated = migrateFramePxToContainerUnits(css);

    expect(migrated).toMatch(/inset:calc\(var\(--cosmetic-frame-unit\) \* -15\)/);
    expect(migrated).toMatch(/background-size:100% calc\(var\(--cosmetic-frame-unit\) \* 160\)/);
    expect(migrated).toMatch(/%3Canimate attributeName='opacity'/);
    expect(migrated).not.toMatch(/viewBox='0 0 100 calc/);
  });

  it('recompiles injected SVGs when the reduced-motion preference changes', () => {
    let prefersReducedMotion = false;
    let notifyPreferenceChange: (() => void) | undefined;
    const style = {
      textContent: '',
      setAttribute: vi.fn(),
      remove: vi.fn()
    };
    const mediaQuery = {
      get matches() { return prefersReducedMotion; },
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        notifyPreferenceChange = listener;
      })
    };
    vi.stubGlobal('window', { matchMedia: vi.fn(() => mediaQuery) });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() }
    });

    const css = `.cb-motion-test{inset:1px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160'%3E%3Cpath d='M1 1H99V159H1Z'/%3E%3Canimate attributeName='opacity' values='.6;1;.6' dur='4s' repeatCount='indefinite'/%3E%3C/svg%3E")}`;
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-motion-test', css })
    });

    expect(style.textContent).toMatch(/%3Canimate\b/);
    expect(style.textContent).toMatch(/var\(--cosmetic-frame-unit\)/);

    prefersReducedMotion = true;
    notifyPreferenceChange?.();
    expect(style.textContent).not.toMatch(/%3Canimate\b/);
    expect(style.textContent).toMatch(/%3Cpath\b/);

    prefersReducedMotion = false;
    notifyPreferenceChange?.();
    expect(style.textContent).toMatch(/%3Canimate\b/);
  });

  it('strips motion synchronously when a hidden tab suspends requestAnimationFrame', () => {
    let visibilityState = 'visible';
    let onVisibilityChange: (() => void) | undefined;
    const cancelAnimationFrame = vi.fn();
    const frame = {
      parentElement: null,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 128, bottom: 204.8, width: 128, height: 204.8
      }),
      checkVisibility: () => true,
      matches: () => false,
      contains: () => false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn()
    };
    const injectedStyles: Array<{
      textContent: string;
      setAttribute: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 17),
      cancelAnimationFrame,
      getComputedStyle: vi.fn(() => ({
        display: 'block',
        visibility: 'visible',
        contentVisibility: 'visible',
        opacity: '1',
        overflowX: 'visible',
        overflowY: 'visible'
      }))
    });
    vi.stubGlobal('document', {
      get visibilityState() { return visibilityState; },
      activeElement: null,
      documentElement: {},
      getElementsByClassName: vi.fn((key: string) => key === 'cb-hidden-tab-test' ? [frame] : []),
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'visibilitychange') onVisibilityChange = listener;
      }),
      createElement: vi.fn(() => {
        const style = { textContent: '', setAttribute: vi.fn(), remove: vi.fn() };
        injectedStyles.push(style);
        return style;
      }),
      head: { appendChild: vi.fn() }
    });

    const css = `.cb-hidden-tab-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Cpath d='M1 1H99V159H1Z'%2F%3E%3Canimate attributeName='opacity' values='.6%3B1%3B.6' dur='4s' repeatCount='indefinite'%2F%3E%3C%2Fsvg%3E")}`;
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-hidden-tab-test', css })
    });
    const style = injectedStyles.at(-1);
    expect(style?.textContent).toMatch(/%3Canimate\b/);
    expect(onVisibilityChange).toBeTypeOf('function');

    visibilityState = 'hidden';
    onVisibilityChange?.();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(style?.textContent).not.toMatch(/%3Canimate\b/);
    expect(frame.setAttribute).toHaveBeenCalledWith('data-cosmetic-motion-paused', 'true');

    const hiddenCss = `.cb-hidden-new-test{background:url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Cpath id='static' d='M1 1H99V159H1Z'%2F%3E%3Canimate attributeName='opacity' values='.5%3B1%3B.5' dur='5s' repeatCount='indefinite'%2F%3E%3C%2Fsvg%3E")}`;
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-hidden-new-test', css: hiddenCss })
    });
    const hiddenStyle = injectedStyles.at(-1);
    expect(hiddenStyle?.textContent).not.toMatch(/%3Canimate\b/);
    expect(hiddenStyle?.textContent).toMatch(/id='static'/);

    frame.removeAttribute.mockClear();
    ensureCosmeticCss({
      style_json: JSON.stringify({
        class: 'cb-hidden-tab-test',
        css: '.cb-hidden-tab-test{border:1px solid transparent}'
      })
    });
    expect(frame.removeAttribute).toHaveBeenCalledWith('data-cosmetic-motion-paused');

    frame.removeAttribute.mockClear();
    frame.setAttribute('data-cosmetic-motion-paused', 'true');
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-hidden-tab-test' })
    });
    expect(frame.removeAttribute).toHaveBeenCalledWith('data-cosmetic-motion-paused');
  });
});
