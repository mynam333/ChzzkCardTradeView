export type ArenaVfxPresetKind = 'attack' | 'skill' | 'ultimate' | 'heal' | 'guard' | 'control' | 'burn' | 'poison' | 'tempo' | 'retire' | 'effect';

export type ArenaVfxPreset = {
  kind: ArenaVfxPresetKind;
  label: string;
  glyph: string;
  color: number;
  secondary: number;
  impactScale: number;
  projectileWidth: number;
  hitStop: number;
  motion: 'dash' | 'projectile' | 'aura' | 'bind' | 'burst' | 'collapse';
};

export const ARENA_VFX_PRESETS: Record<ArenaVfxPresetKind, ArenaVfxPreset> = {
  attack: { kind: 'attack', label: '피격', glyph: '↯', color: 0xf43f5e, secondary: 0xfda4af, impactScale: 1.04, projectileWidth: 8, hitStop: 1, motion: 'dash' },
  skill: { kind: 'skill', label: '스킬', glyph: '✦', color: 0xf43f5e, secondary: 0xfda4af, impactScale: 1.14, projectileWidth: 9, hitStop: 0.94, motion: 'projectile' },
  ultimate: { kind: 'ultimate', label: '궁극기', glyph: '✦', color: 0xfacc15, secondary: 0xf97316, impactScale: 1.5, projectileWidth: 12, hitStop: 1.2, motion: 'burst' },
  heal: { kind: 'heal', label: '회복', glyph: '+', color: 0x4ade80, secondary: 0x86efac, impactScale: 0.92, projectileWidth: 8, hitStop: 0.62, motion: 'aura' },
  guard: { kind: 'guard', label: '보호', glyph: '◇', color: 0x60a5fa, secondary: 0xbae6fd, impactScale: 0.98, projectileWidth: 8, hitStop: 0.68, motion: 'aura' },
  control: { kind: 'control', label: '제어', glyph: '×', color: 0xa78bfa, secondary: 0xc4b5fd, impactScale: 1.18, projectileWidth: 10, hitStop: 0.96, motion: 'bind' },
  burn: { kind: 'burn', label: '화상', glyph: '!' , color: 0xf97316, secondary: 0xef4444, impactScale: 1.24, projectileWidth: 9, hitStop: 1.06, motion: 'burst' },
  poison: { kind: 'poison', label: '중독', glyph: '•', color: 0x84cc16, secondary: 0x22c55e, impactScale: 1.05, projectileWidth: 8, hitStop: 0.82, motion: 'projectile' },
  tempo: { kind: 'tempo', label: '템포', glyph: '»', color: 0x60a5fa, secondary: 0x38bdf8, impactScale: 1.08, projectileWidth: 8, hitStop: 0.86, motion: 'projectile' },
  retire: { kind: 'retire', label: '전투불능', glyph: '!', color: 0x334155, secondary: 0x94a3b8, impactScale: 1.2, projectileWidth: 8, hitStop: 1.08, motion: 'collapse' },
  effect: { kind: 'effect', label: '효과', glyph: '•', color: 0xf43f5e, secondary: 0xfda4af, impactScale: 1.04, projectileWidth: 8, hitStop: 1, motion: 'projectile' }
};

const knownKinds = new Set(Object.keys(ARENA_VFX_PRESETS));
const tagPriority: ArenaVfxPresetKind[] = ['retire', 'ultimate', 'burn', 'poison', 'heal', 'guard', 'control', 'tempo', 'skill', 'attack'];

export const resolveArenaVfxPreset = (input: {
  vfxKind?: string;
  damageType?: string;
  actionType?: string;
  skillType?: string;
  effectTags?: string[];
  text?: string;
}) => {
  const direct = String(input.vfxKind || '').trim().toLowerCase();
  if (knownKinds.has(direct)) return ARENA_VFX_PRESETS[direct as ArenaVfxPresetKind];
  const damageType = String(input.damageType || '').trim().toLowerCase();
  if (damageType === 'heal') return ARENA_VFX_PRESETS.heal;
  if (damageType === 'shield') return ARENA_VFX_PRESETS.guard;
  if (damageType === 'control') return ARENA_VFX_PRESETS.control;

  const tags = new Set((input.effectTags || []).map((tag) => String(tag).trim().toLowerCase()));
  for (const kind of tagPriority) {
    if (tags.has(kind)) return ARENA_VFX_PRESETS[kind];
  }

  const actionType = String(input.actionType || '').trim().toLowerCase();
  if (knownKinds.has(actionType)) return ARENA_VFX_PRESETS[actionType as ArenaVfxPresetKind];
  if (String(input.skillType || '').toLowerCase() === 'ultimate') return ARENA_VFX_PRESETS.ultimate;

  const text = String(input.text || '').toLowerCase();
  if (text.includes('ultimate') || text.includes('ult') || text.includes('궁극')) return ARENA_VFX_PRESETS.ultimate;
  if (text.includes('burn') || text.includes('fire') || text.includes('ignite') || text.includes('화상') || text.includes('불꽃')) return ARENA_VFX_PRESETS.burn;
  if (text.includes('poison') || text.includes('venom') || text.includes('toxin') || text.includes('독') || text.includes('중독')) return ARENA_VFX_PRESETS.poison;
  if (text.includes('heal') || text.includes('recover') || text.includes('회복') || text.includes('재생')) return ARENA_VFX_PRESETS.heal;
  if (text.includes('guard') || text.includes('shield') || text.includes('barrier') || text.includes('보호') || text.includes('방어')) return ARENA_VFX_PRESETS.guard;
  if (text.includes('stun') || text.includes('slow') || text.includes('control') || text.includes('기절') || text.includes('지연')) return ARENA_VFX_PRESETS.control;
  if (text.includes('tempo') || text.includes('speed') || text.includes('haste') || text.includes('템포') || text.includes('속도') || text.includes('가속')) return ARENA_VFX_PRESETS.tempo;
  return ARENA_VFX_PRESETS.effect;
};
