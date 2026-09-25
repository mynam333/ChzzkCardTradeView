import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCosmeticRuntimeForTests,
  ensureCosmeticCss,
  MAX_CONCURRENT_SVG_MOTION_AREA,
  MAX_CONCURRENT_SVG_MOTION_THEMES,
  migrateFramePxToContainerUnits,
  normalizeSvgInCss,
  selectActiveCosmeticSvgMotionKeys,
  SVG_CSS_ONLY_MIN_RENDER_AREA,
  SVG_SMIL_ONLY_MIN_RENDER_AREA,
  stripSvgSmilAnimationsExceptDataSvgIndexInCss,
  stripSvgSmilAnimationsInCss
} from './cosmetics';

afterEach(() => {
  __resetCosmeticRuntimeForTests();
  vi.unstubAllGlobals();
});

const svgMotionCss = (key: string, timelines: number, durationOffset: number = 0): string => {
  const perLayer = [
    Math.ceil(timelines / 3),
    Math.ceil((timelines - Math.ceil(timelines / 3)) / 2),
    0
  ];
  perLayer[2] = timelines - perLayer[0] - perLayer[1];
  let animationIndex = 0;
  const svg = (count: number) => {
    const animations = Array.from({ length: count }, () => {
      const index = animationIndex;
      animationIndex += 1;
      return `%3Canimate id='${key}-motion-${index}' attributeName='opacity' values='.6%3B1%3B.6' dur='${4 + durationOffset + index / 10}s' repeatCount='indefinite'%2F%3E`;
    }).join('');
    return `url("data:image/svg+xml,%3Csvg viewBox='0 0 100 160'%3E%3Cpath d='M1 1H99V159H1Z'%2F%3E${animations}%3C%2Fsvg%3E")`;
  };
  return `.${key}{background-image:${svg(perLayer[0])}}.${key}::before{background-image:${svg(perLayer[1])};animation:${key}-before 9s ease-in-out infinite}.${key}::after{background-image:${svg(perLayer[2])};animation:${key}-after 11s linear infinite}@keyframes ${key}-before{0%,100%{transform:translate3d(0,0,0);opacity:.7}50%{transform:translate3d(1px,0,0);opacity:.9}}@keyframes ${key}-after{0%,100%{transform:translate3d(0,0,0);opacity:.7}50%{transform:translate3d(-1px,0,0);opacity:.9}}@media(prefers-reduced-motion:reduce){.${key}::before,.${key}::after{animation:none}}`;
};

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
    expect(SVG_SMIL_ONLY_MIN_RENDER_AREA).toBe(120_000);
    expect(SVG_CSS_ONLY_MIN_RENDER_AREA).toBe(500_000);

    const engagedCandidates = [
      { key: 'center', engaged: false, distance: 0, visibleArea: 40_000, order: 0 },
      { key: 'near', engaged: false, distance: 20, visibleArea: 10_000, order: 1 },
      { key: 'hovered', engaged: true, distance: 900, visibleArea: 70_000, order: 2 }
    ];
    expect([...selectActiveCosmeticSvgMotionKeys(engagedCandidates)]).toEqual(['hovered', 'near']);

    const richCandidates = [24, 22, 20].map((timelines, order) => ({
      key: `rich-${order}`,
      engaged: false,
      distance: order,
      visibleArea: 10_000,
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

  it('keeps only the selected data SVG dynamic while preserving every static layer', () => {
    const css = svgMotionCss('cb-layer-lod', 24);
    const signatureOnly = stripSvgSmilAnimationsExceptDataSvgIndexInCss(css, 2);

    expect(signatureOnly.match(/%3Canimate\b/g)).toHaveLength(8);
    expect(signatureOnly.match(/%3Cpath\b/g)).toHaveLength(3);
    expect(signatureOnly).toContain("id='cb-layer-lod-motion-16'");
    expect(signatureOnly).not.toContain("id='cb-layer-lod-motion-15'");
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

  it('preserves WebP bytes during CSS normalization and logical-pixel migration', () => {
    const uri = 'data:image/webp;base64,UklGRjgwcHgrLz09';
    const css = `.cb-test{--image:url("${uri}");border-radius:3.43px;background-image:var(--image)}`;
    const migrated = migrateFramePxToContainerUnits(normalizeSvgInCss(css));
    expect(migrated).toContain(uri);
    expect(migrated).toContain('border-radius:calc(var(--cosmetic-frame-unit) * 3.43)');
    expect(stripSvgSmilAnimationsInCss(migrated)).toBe(migrated);
  });

  it.each([
    ['cb-chuseok-harvest-moon', '--cosmetic-frame-layout:chuseok-webp-v1;', false],
    ['cb-new-layer-theme', '--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:frame,front/cloud;', false],
    ['cb-css-only', 'animation:custom-motion 12s infinite;', false],
    ['cb-autumn', '--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:frame,front/cloud;', true]
  ] as const)('keeps large %s CSS motion alive, pausing only hidden/offscreen instances', (key, declarations, mixed) => {
    let hidden = false;
    let offscreen = false;
    let scheduled: (() => void) | undefined;
    let visibilityChanged: (() => void) | undefined;
    const attributes = new Map<string, string>();
    const frame = {
      parentElement: null,
      checkVisibility: () => true,
      getBoundingClientRect: () => ({ left: 0, top: offscreen ? 2000 : 0, right: 768, bottom: offscreen ? 3228.8 : 1228.8, width: 768, height: 1228.8 }),
      matches: () => false,
      contains: () => false,
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key)
    };
    const style = { textContent: '', setAttribute: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('window', {
      innerWidth: 1280, innerHeight: 900,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: () => void) => { scheduled = callback; return 1; }),
      cancelAnimationFrame: vi.fn(),
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' })
    });
    vi.stubGlobal('document', {
      get visibilityState() { return hidden ? 'hidden' : 'visible'; },
      activeElement: null,
      getElementsByClassName: () => mixed ? [frame, { ...frame }] : [frame],
      addEventListener: (event: string, callback: () => void) => { if (event === 'visibilitychange') visibilityChanged = callback; },
      removeEventListener: vi.fn(),
      createElement: () => style,
      head: { appendChild: vi.fn() }
    });
    const css = `.${key}{${declarations}}${mixed ? svgMotionCss(key, 24) : ''}`;
    const cosmetic = { style_json: JSON.stringify({ class: key, css }) };
    ensureCosmeticCss(cosmetic);
    scheduled?.();
    expect(attributes.size).toBe(0); // No SVG LOD or size-based static fallback.
    hidden = true;
    visibilityChanged?.();
    expect(attributes.get('data-cosmetic-motion-paused')).toBe('true');
    hidden = false;
    offscreen = true;
    visibilityChanged?.();
    scheduled?.();
    expect(attributes.get('data-cosmetic-motion-paused')).toBe('true');
    offscreen = false;
    ensureCosmeticCss(cosmetic);
    scheduled?.();
    expect(attributes.size).toBe(0);
    expect(style.textContent).toContain(declarations);
    if (mixed) {
      // Repeated large SVG artwork is static, but independent CSS carriers still run.
      expect(style.textContent).not.toMatch(/%3Canimate\b/);
      expect(style.textContent).not.toContain('animation-play-state:paused!important;');
    }
  });

  it('does not rewrite layer names that happen to end in a pixel-like suffix', () => {
    const css = '.cb-test{--cosmetic-frame-layers:front/leaf-12px;} .cb-test [data-cosmetic-layer="leaf-12px"]{inset:-1.5px;transform:translateX(2px)}';
    const migrated = migrateFramePxToContainerUnits(css);
    expect(migrated).toContain('front/leaf-12px;');
    expect(migrated).toContain('[data-cosmetic-layer="leaf-12px"]');
    expect(migrated).toContain('inset:calc(var(--cosmetic-frame-unit) * -1.5)');
  });

  it('enforces reduced motion on arbitrary nested layers and their pseudo-elements', () => {
    let reduce = true;
    let preferenceChanged: (() => void) | undefined;
    const style = { textContent: '', setAttribute: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('window', {
      matchMedia: () => ({ get matches() { return reduce; }, addEventListener: (_event: string, cb: () => void) => { preferenceChanged = cb; }, removeEventListener: vi.fn() })
    });
    vi.stubGlobal('document', { createElement: () => style, head: { appendChild: vi.fn() } });
    const css = '.cb-custom{--cosmetic-frame-layout:layers-v1;--cosmetic-frame-layers:front/spark;} .cb-custom [data-cosmetic-layer="spark"]::before{animation:spark 5s infinite;}';
    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-custom', css }) });
    expect(style.textContent).toContain('.cb-custom [data-cosmetic-layer]::before');
    expect(style.textContent).toContain('.cb-custom [data-cosmetic-layer]::after{animation:none!important;transition:none!important;}');
    reduce = false;
    preferenceChanged?.();
    expect(style.textContent).toContain('animation:spark 5s infinite');
    expect(style.textContent).not.toContain('animation:none!important');
  });

  it('recompiles injected SVGs when the reduced-motion preference changes', () => {
    let prefersReducedMotion = false;
    let notifyPreferenceChange: (() => void) | undefined;
    let runScheduledFrame: (() => void) | undefined;
    const frame = {
      parentElement: null,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100
      }),
      checkVisibility: () => true,
      matches: () => false,
      contains: () => false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn()
    };
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
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: () => void) => {
        runScheduledFrame = callback;
        return 1;
      }),
      cancelAnimationFrame: vi.fn(),
      getComputedStyle: vi.fn(() => ({
        display: 'block',
        visibility: 'visible',
        contentVisibility: 'visible',
        opacity: '1',
        overflowX: 'visible',
        overflowY: 'visible'
      })),
      matchMedia: vi.fn(() => mediaQuery)
    });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      activeElement: null,
      documentElement: {},
      getElementsByClassName: vi.fn((key: string) => key === 'cb-motion-test' ? [frame] : []),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => style),
      head: { appendChild: vi.fn() }
    });

    const css = `.cb-motion-test{inset:1px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160'%3E%3Cpath d='M1 1H99V159H1Z'/%3E%3Canimate attributeName='opacity' values='.6;1;.6' dur='4s' repeatCount='indefinite'/%3E%3C/svg%3E")}`;
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-motion-test', css })
    });

    // 신규 SMIL 프레임은 실제 DOM 면적을 확인하기 전까지 정적으로 주입됩니다.
    expect(style.textContent).not.toMatch(/%3Canimate\b/);
    runScheduledFrame?.();
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
    let runScheduledFrame: (() => void) | undefined;
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
      requestAnimationFrame: vi.fn((callback: () => void) => {
        runScheduledFrame = callback;
        return 17;
      }),
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
    // 신규 SMIL 테마는 예산 승인 전 정적으로 시작합니다.
    expect(style?.textContent).not.toMatch(/%3Canimate\b/);
    runScheduledFrame?.();
    expect(style?.textContent).toMatch(/%3Canimate\b/);
    expect(onVisibilityChange).toBeTypeOf('function');

    // 갱신 예약이 남아 있는 상태에서 탭이 숨겨지는 경로도 검증합니다.
    ensureCosmeticCss({
      style_json: JSON.stringify({ class: 'cb-hidden-tab-test', css })
    });

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

  it('moves an observed frame across full, signature-SMIL, and CSS-only size tiers', () => {
    const scheduledFrames: Array<() => void> = [];
    let triggerIntersection: IntersectionObserverCallback | undefined;
    let triggerResize: ResizeObserverCallback | undefined;
    const intersectionObserve = vi.fn();
    const intersectionUnobserve = vi.fn();
    const intersectionDisconnect = vi.fn();
    const resizeObserve = vi.fn();
    const resizeUnobserve = vi.fn();
    const resizeDisconnect = vi.fn();
    const mutationObserve = vi.fn();
    const mutationDisconnect = vi.fn();
    const removeWindowListener = vi.fn();
    const removeDocumentListener = vi.fn();
    const removeMediaListener = vi.fn();
    let prefersReducedMotion = false;
    let notifyMediaChange: (() => void) | undefined;
    const makeFrame = (rect: { left: number; top: number; right: number; bottom: number }) => {
      const pausedAttributes = new Set<string>();
      return {
        parentElement: null,
        getBoundingClientRect: () => ({
          ...rect,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top
        }),
        checkVisibility: () => true,
        matches: () => false,
        contains: () => false,
        setAttribute: vi.fn((name: string) => pausedAttributes.add(name)),
        removeAttribute: vi.fn((name: string) => pausedAttributes.delete(name)),
        isMotionPaused: () => pausedAttributes.has('data-cosmetic-motion-paused'),
        isSmilOnly: () => pausedAttributes.has('data-cosmetic-motion-smil-only'),
        isCssOnly: () => pausedAttributes.has('data-cosmetic-motion-css-only')
      };
    };
    const heavyRect = { left: 450, top: 350, right: 550, bottom: 450 };
    const mediumRect = { left: 600, top: 350, right: 700, bottom: 450 };
    const lightRect = { left: 750, top: 350, right: 850, bottom: 450 };
    const heavyFrame = makeFrame(heavyRect);
    const sharedSmallFrame = makeFrame({ left: 450, top: 350, right: 550, bottom: 450 });
    const mediumFrame = makeFrame(mediumRect);
    const mediumOffscreenFrame = makeFrame({ left: -200, top: 350, right: -100, bottom: 450 });
    const lightFrame = makeFrame(lightRect);
    const documentElement = {};
    const framesByKey = new Map<string, ReturnType<typeof makeFrame>[]>([
      ['cb-autumn', [heavyFrame]],
      ['cb-runtime-22', [mediumFrame, mediumOffscreenFrame]],
      ['cb-runtime-20', [lightFrame]]
    ]);
    const stylesByKey = new Map<string, {
      textContent: string;
      setAttribute: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    }>();

    const mediaQuery = {
      get matches() { return prefersReducedMotion; },
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        notifyMediaChange = listener;
      }),
      removeEventListener: removeMediaListener
    } as unknown as MediaQueryList;

    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: removeWindowListener,
      requestAnimationFrame: vi.fn((callback: () => void) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      }),
      cancelAnimationFrame: vi.fn(),
      matchMedia: vi.fn(() => mediaQuery),
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
      visibilityState: 'visible',
      activeElement: null,
      documentElement,
      getElementsByClassName: vi.fn((key: string) => framesByKey.get(key) ?? []),
      addEventListener: vi.fn(),
      removeEventListener: removeDocumentListener,
      createElement: vi.fn(() => {
        const style = { textContent: '', setAttribute: vi.fn(), remove: vi.fn() };
        style.setAttribute.mockImplementation((name: string, value: string) => {
          if (name === 'data-cb-css') stylesByKey.set(value, style);
        });
        return style;
      }),
      head: { appendChild: vi.fn() }
    });
    class FakeIntersectionObserver {
      root = null;
      rootMargin = '0px';
      thresholds = [0, 0.001, 0.25, 0.5, 0.75, 1];
      observe = intersectionObserve;
      unobserve = intersectionUnobserve;
      disconnect = intersectionDisconnect;
      takeRecords = vi.fn(() => []);

      constructor(callback: IntersectionObserverCallback) {
        triggerIntersection = callback;
      }
    }
    class FakeResizeObserver {
      observe = resizeObserve;
      unobserve = resizeUnobserve;
      disconnect = resizeDisconnect;

      constructor(callback: ResizeObserverCallback) {
        triggerResize = callback;
      }
    }
    class FakeMutationObserver {
      observe = mutationObserve;
      disconnect = mutationDisconnect;
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);

    for (const [key, timelines] of [['cb-autumn', 24], ['cb-runtime-22', 22], ['cb-runtime-20', 20]] as const) {
      ensureCosmeticCss({
        style_json: JSON.stringify({ class: key, css: svgMotionCss(key, timelines) })
      });
      expect(stylesByKey.get(key)?.textContent).not.toMatch(/%3Canimate\b/);
    }
    scheduledFrames.shift()?.();

    // 실제 운영 밀도(20~24 SMIL)에서는 면적 가중치 때문에 가까운 두 테마만 승인됩니다.
    expect(stylesByKey.get('cb-autumn')?.textContent).toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(24);
    expect(stylesByKey.get('cb-runtime-22')?.textContent).toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-runtime-20')?.textContent).not.toMatch(/%3Canimate\b/);
    expect(heavyFrame.isMotionPaused()).toBe(false);
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(mediumFrame.isMotionPaused()).toBe(false);
    expect(mediumOffscreenFrame.isMotionPaused()).toBe(true);
    expect(lightFrame.isMotionPaused()).toBe(true);
    expect(resizeObserve).toHaveBeenCalledWith(documentElement);
    expect(resizeObserve).toHaveBeenCalledWith(heavyFrame);
    expect(resizeObserve).toHaveBeenCalledWith(mediumFrame);
    expect(resizeObserve).toHaveBeenCalledWith(mediumOffscreenFrame);
    expect(resizeObserve).toHaveBeenCalledWith(lightFrame);
    expect(intersectionObserve).toHaveBeenCalledTimes(4);
    expect(mutationObserve).toHaveBeenCalledWith(documentElement, expect.objectContaining({
      childList: true,
      subtree: true
    }));

    Object.assign(heavyRect, { left: 350, top: 250, right: 650, bottom: 550 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();

    // 카드 자체 크기는 제한하지 않습니다. 커진 한 장은 계속 동작하고,
    // 새 가시 면적 예산을 넘긴 다음 테마가 정지합니다.
    expect(stylesByKey.get('cb-autumn')?.textContent).toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(24);
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain(
      '.cb-autumn[data-cosmetic-motion-smil-only="true"]'
    );
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain('animation:none!important;');
    expect(stylesByKey.get('cb-runtime-22')?.textContent).not.toMatch(/%3Canimate\b/);
    expect(heavyFrame.isMotionPaused()).toBe(false);
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(mediumFrame.isMotionPaused()).toBe(true);

    // 논리 4×(256 × 409.6)는 가이드의 전체 CSS+SMIL 검증 범위에 남습니다.
    Object.assign(heavyRect, { left: 372, top: 195.2, right: 628, bottom: 604.8 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(false);

    Object.assign(heavyRect, { left: 300, top: 250, right: 700, bottom: 549.9975 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(false);

    Object.assign(heavyRect, { left: 300, top: 250, right: 700, bottom: 550 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(true);
    // Autumn의 대형 LOD는 particle/projection SVG의 시그니처 8개만 재생하고,
    // base와 micro-detail은 같은 정적 세공을 유지합니다.
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(8);

    // 8× 논리 카드(512 × 819.2 ≈ 419k)는 시그니처 SMIL 구간에 남습니다.
    Object.assign(heavyRect, { left: 244, top: 0, right: 756, bottom: 819.2 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(true);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(8);

    // 500,000px² 바로 아래에서는 중간 tier, 정확한 경계부터 CSS-only입니다.
    Object.assign(heavyRect, { left: 187.5, top: 0, right: 812.5, bottom: 799.9984 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(true);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(8);

    Object.assign(heavyRect, { left: 187.5, top: 0, right: 812.5, bottom: 800 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(true);
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain(
      'animation:cb-autumn-before 9s ease-in-out infinite'
    );
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain(
      'animation:cb-autumn-after 11s linear infinite'
    );
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toContain(
      'animation-play-state:paused!important;'
    );

    // 화면 밖/예산 제한은 CSS-only보다 우선해 바깥 carrier까지 정지합니다.
    Object.assign(heavyRect, { left: 1100, top: 0, right: 1725, bottom: 800 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isMotionPaused()).toBe(true);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain(
      'animation-play-state:paused!important;'
    );

    Object.assign(heavyRect, { left: 187.5, top: 0, right: 812.5, bottom: 800 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isMotionPaused()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(true);
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toContain(
      'animation-play-state:paused!important;'
    );

    // 감소 모션이 초대형 CSS-only보다 우선하며, 복구 후에는 CSS carrier가 재개됩니다.
    prefersReducedMotion = true;
    notifyMediaChange?.();
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toMatch(/%3Canimate\b/);
    expect(stylesByKey.get('cb-autumn')?.textContent).toContain(
      'animation:none!important;'
    );
    prefersReducedMotion = false;
    notifyMediaChange?.();
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toContain(
      'animation-play-state:paused!important;'
    );

    // 한 key가 style을 공유하므로, 일부만 보이는 초대형 인스턴스와 작은
    // 인스턴스가 동시에 예산 안에 들어와도 가장 높은 tier를 둘 다 사용합니다.
    framesByKey.set('cb-autumn', [heavyFrame, sharedSmallFrame]);
    Object.assign(heavyRect, { left: 990, top: 0, right: 1615, bottom: 800 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isCssOnly()).toBe(true);
    expect(sharedSmallFrame.isCssOnly()).toBe(true);
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(sharedSmallFrame.isSmilOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent).not.toMatch(/%3Canimate\b/);

    Object.assign(heavyRect, { left: 990, top: 0, right: 1390, bottom: 300 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(true);
    expect(sharedSmallFrame.isSmilOnly()).toBe(true);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(sharedSmallFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(8);

    Object.assign(heavyRect, { left: 600, top: 350, right: 700, bottom: 450 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(sharedSmallFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(sharedSmallFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(24);

    framesByKey.set('cb-autumn', [heavyFrame]);
    triggerIntersection?.([], {} as IntersectionObserver);
    scheduledFrames.shift()?.();
    expect(intersectionUnobserve).toHaveBeenCalledWith(sharedSmallFrame);
    expect(resizeUnobserve).toHaveBeenCalledWith(sharedSmallFrame);

    // 초대형에서 중간 tier로 내려오면 시그니처 SVG가 다시 활성화됩니다.
    Object.assign(heavyRect, { left: 300, top: 250, right: 700, bottom: 550 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(true);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(8);

    Object.assign(heavyRect, { left: 350, top: 250, right: 650, bottom: 550 });
    triggerResize?.([], {} as ResizeObserver);
    scheduledFrames.shift()?.();
    expect(heavyFrame.isSmilOnly()).toBe(false);
    expect(heavyFrame.isCssOnly()).toBe(false);
    expect(stylesByKey.get('cb-autumn')?.textContent.match(/%3Canimate\b/g)).toHaveLength(24);

    // DOM에서 빠진 프레임은 두 요소 observer 모두에서 해제됩니다.
    framesByKey.set('cb-runtime-22', []);
    triggerIntersection?.([], {} as IntersectionObserver);
    scheduledFrames.shift()?.();
    expect(intersectionUnobserve).toHaveBeenCalledWith(mediumFrame);
    expect(intersectionUnobserve).toHaveBeenCalledWith(mediumOffscreenFrame);
    expect(resizeUnobserve).toHaveBeenCalledWith(mediumFrame);
    expect(resizeUnobserve).toHaveBeenCalledWith(mediumOffscreenFrame);

    __resetCosmeticRuntimeForTests();
    expect(intersectionUnobserve).toHaveBeenCalledWith(heavyFrame);
    expect(intersectionUnobserve).toHaveBeenCalledWith(lightFrame);
    expect(resizeUnobserve).toHaveBeenCalledWith(heavyFrame);
    expect(resizeUnobserve).toHaveBeenCalledWith(lightFrame);
    expect(intersectionDisconnect).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(mutationDisconnect).toHaveBeenCalledTimes(1);
    expect(removeWindowListener).toHaveBeenCalled();
    expect(removeDocumentListener).toHaveBeenCalled();
    expect(removeMediaListener).toHaveBeenCalledWith('change', expect.any(Function));

    // teardown은 중복 호출되어도 observer를 다시 건드리지 않습니다.
    __resetCosmeticRuntimeForTests();
    expect(intersectionDisconnect).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(mutationDisconnect).toHaveBeenCalledTimes(1);
  });

  it('starts changed SMIL frames static while identical CSS keeps its current approval', () => {
    const scheduledFrames: Array<() => void> = [];
    const frame = {
      parentElement: null,
      getBoundingClientRect: () => ({
        left: 450, top: 350, right: 550, bottom: 450, width: 100, height: 100
      }),
      checkVisibility: () => true,
      matches: () => false,
      contains: () => false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn()
    };
    const adaptiveFrame = {
      parentElement: null,
      getBoundingClientRect: () => ({
        left: 100, top: 0, right: 900, bottom: 1000, width: 800, height: 1000
      }),
      checkVisibility: () => true,
      matches: () => true,
      contains: () => false,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn()
    };
    const stylesByKey = new Map<string, {
      textContent: string;
      setAttribute: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    }>();
    const newlyStandardizedFrameKeys = [
      'cb-chuseok-harvest-moon',
      'cb-beach',
      'cb-cheese-fondue',
      'cb-galaxy',
      'cb-hanok-yeonhwa',
      'cb-heart-pop',
      'cb-steampunk'
    ];
    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
      addEventListener: vi.fn(),
      requestAnimationFrame: vi.fn((callback: () => void) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      }),
      cancelAnimationFrame: vi.fn(),
      matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
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
      visibilityState: 'visible',
      activeElement: null,
      documentElement: {},
      getElementsByClassName: vi.fn((key: string) => {
        if (key === 'cb-transition') return [frame];
        if (newlyStandardizedFrameKeys.includes(key)) return [adaptiveFrame];
        return [];
      }),
      addEventListener: vi.fn(),
      createElement: vi.fn(() => {
        const style = { textContent: '', setAttribute: vi.fn(), remove: vi.fn() };
        style.setAttribute.mockImplementation((name: string, value: string) => {
          if (name === 'data-cb-css') stylesByKey.set(value, style);
        });
        return style;
      }),
      head: { appendChild: vi.fn() }
    });

    const staticCss = '.cb-transition{border:1px solid transparent}';
    const motion20 = svgMotionCss('cb-transition', 20);
    const changedMotion20 = `${motion20}\n.cb-transition{outline-color:transparent}`;
    const motion24 = svgMotionCss('cb-transition', 24, 1);

    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-transition', css: staticCss }) });
    scheduledFrames.shift()?.();
    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-transition', css: motion20 }) });
    expect(stylesByKey.get('cb-transition')?.textContent).not.toMatch(/%3Canimate\b/);
    scheduledFrames.shift()?.();
    expect(stylesByKey.get('cb-transition')?.textContent).toMatch(/%3Canimate\b/);

    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-transition', css: motion20 }) });
    expect(stylesByKey.get('cb-transition')?.textContent).toMatch(/%3Canimate\b/);
    scheduledFrames.shift()?.();

    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-transition', css: changedMotion20 }) });
    expect(stylesByKey.get('cb-transition')?.textContent).not.toMatch(/%3Canimate\b/);
    scheduledFrames.shift()?.();
    expect(stylesByKey.get('cb-transition')?.textContent).toMatch(/%3Canimate\b/);

    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'cb-transition', css: motion24 }) });
    expect(stylesByKey.get('cb-transition')?.textContent).not.toMatch(/%3Canimate\b/);
    scheduledFrames.shift()?.();
    expect(stylesByKey.get('cb-transition')?.textContent.match(/%3Canimate\b/g)).toHaveLength(24);

    // 프레임이 아닌 기존 SVG 코스메틱은 카드 프레임 예산의 영향을 받지 않습니다.
    const nameCss = svgMotionCss('ne-svg-name', 20);
    ensureCosmeticCss({ style_json: JSON.stringify({ class: 'ne-svg-name', css: nameCss }) });
    expect(stylesByKey.get('ne-svg-name')?.textContent.match(/%3Canimate\b/g)).toHaveLength(20);

    for (const frameKey of newlyStandardizedFrameKeys) {
      adaptiveFrame.setAttribute.mockClear();
      adaptiveFrame.removeAttribute.mockClear();
      ensureCosmeticCss({
        style_json: JSON.stringify({ class: frameKey, css: svgMotionCss(frameKey, 20) })
      });
      scheduledFrames.shift()?.();
      expect(stylesByKey.get(frameKey)?.textContent).not.toMatch(/%3Canimate\b/);
      expect(adaptiveFrame.removeAttribute).toHaveBeenCalledWith('data-cosmetic-motion-paused');
      expect(adaptiveFrame.setAttribute).not.toHaveBeenCalledWith(
        'data-cosmetic-motion-smil-only',
        'true'
      );
      expect(adaptiveFrame.setAttribute).toHaveBeenCalledWith(
        'data-cosmetic-motion-css-only',
        'true'
      );
    }
  });
});
