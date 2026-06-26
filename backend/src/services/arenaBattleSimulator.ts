import { createHash } from 'crypto';
import { ArenaDeck } from './arenaDeckService';
import { ArenaGeneratedCard } from './arenaCatalog';
import { ARENA_BATTLEFIELD_RULES, ARENA_MAX_ROUND_TICKS, ARENA_MAX_ROUNDS_PER_MATCH, ARENA_ROUNDS_TO_WIN, ARENA_TACTIC_CHIPS } from './arenaRules';
import { getArenaAdminControlConfigSync } from './arenaAdminControlService';

export type ArenaSide = 'player' | 'bot';
export type ArenaRoundWinner = ArenaSide | 'draw';

export interface ArenaSimulatorCardSnapshot {
  card_id: string;
  channel_id: string;
  name: string;
  image_url: string | null;
  class_id: string;
  class_name: string;
  class_role?: string;
  stats: ArenaGeneratedCard['stats'];
  skills: Array<{ id: string; name: string; type: string }>;
}

export interface ArenaSimulatorDeckSnapshot {
  deck_id: string;
  name: string;
  cards: ArenaSimulatorCardSnapshot[];
  round_plans: ArenaDeck['round_plans'];
  strategy_chip_id?: string;
}

export interface ArenaBattleEvent {
  t: number;
  type:
    | 'ROUND_START'
    | 'BASIC_ATTACK'
    | 'SKILL_CAST'
    | 'DAMAGE'
    | 'HEAL'
    | 'SHIELD_GAIN'
    | 'DEATH'
    | 'ROUND_RESULT';
  actor?: string;
  targets?: string[];
  value?: number;
  hp_before?: number;
  hp_after?: number;
  shield_before?: number;
  shield_after?: number;
  alive_after?: boolean;
  message?: string;
}

export interface ArenaReplayUnitState {
  id: string;
  side: ArenaSide;
  card_id: string;
  channel_id: string;
  max_hp: number;
  start_hp: number;
  final_hp: number;
  alive: boolean;
}

export interface ArenaRoundResult {
  round_no: number;
  winner_side: ArenaRoundWinner;
  duration_ms: number;
  player_power: number;
  bot_power: number;
  player_remaining_units: number;
  bot_remaining_units: number;
  player_total_damage: number;
  bot_total_damage: number;
  reason: string;
}

export interface ArenaRoundReplay {
  round_no: number;
  duration_ms: number;
  winner_side: ArenaRoundWinner;
  unit_states: ArenaReplayUnitState[];
  events: ArenaBattleEvent[];
}

export interface ArenaSetSimulationResult {
  roundResults: ArenaRoundResult[];
  replayRounds: ArenaRoundReplay[];
  playerWins: number;
  opponentWins: number;
  draws: number;
}

export interface ArenaSetSimulationInput {
  playerDeck: ArenaSimulatorDeckSnapshot;
  opponentDeck: ArenaSimulatorDeckSnapshot;
  opponentPowerMultiplier?: number;
  matchSeed: string;
  battlefield_rule_id?: string;
}

export interface ArenaRoundSimulationInput extends ArenaSetSimulationInput {
  roundNo: number;
}

type CombatUnit = {
  id: string;
  side: ArenaSide;
  card: ArenaSimulatorCardSnapshot;
  row: number;
  col: number;
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  attackIntervalMs: number;
  attackCooldownMs: number;
  energy: number;
  skillCost: number;
  critChance: number;
  critDamage: number;
  critTakenMod: number;
  shield: number;
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  alive: boolean;
  tacticStyle: string;
  focusRule: string;
};

const HEALING_CLASS_IDS = new Set(['healer', 'bard', 'purifier', 'supporter']);
const SHIELDING_CLASS_IDS = new Set(['shield_knight', 'iron_wall', 'vanguard', 'ward_keeper', 'guardian']);
const BREAKER_CLASS_IDS = new Set(['breaker']);
const BRUISER_DAMAGE_CLASS_IDS = new Set(['duelist', 'berserker', 'pursuer']);
const FINISHER_DAMAGE_CLASS_IDS = new Set(['sniper', 'assassin', 'rapid_gunner', 'executioner', 'ranger']);
const CASTER_CONTROL_CLASS_IDS = new Set(['fire_mage', 'frost_mage', 'storm_caller', 'curse_weaver', 'disruptor', 'arcanist']);

const getCardClassRole = (card: ArenaSimulatorCardSnapshot) => {
  if (card.class_role) return card.class_role;
  if (HEALING_CLASS_IDS.has(card.class_id)) return 'support';
  if (SHIELDING_CLASS_IDS.has(card.class_id)) return 'frontline';
  if (CASTER_CONTROL_CLASS_IDS.has(card.class_id) || BREAKER_CLASS_IDS.has(card.class_id)) return 'control';
  if (BRUISER_DAMAGE_CLASS_IDS.has(card.class_id) || FINISHER_DAMAGE_CLASS_IDS.has(card.class_id)) return 'damage';
  return 'tempo';
};

const getSkillDamageMultiplier = (card: ArenaSimulatorCardSnapshot) => {
  if (BREAKER_CLASS_IDS.has(card.class_id)) return 1.68;
  if (CASTER_CONTROL_CLASS_IDS.has(card.class_id) || getCardClassRole(card) === 'control') return 1.62;
  if (BRUISER_DAMAGE_CLASS_IDS.has(card.class_id)) return 1.58;
  if (FINISHER_DAMAGE_CLASS_IDS.has(card.class_id) || getCardClassRole(card) === 'damage') return 1.56;
  if (getCardClassRole(card) === 'tempo') return 1.5;
  return 1.36;
};

const TICK_MS = 250;
const MAX_EVENTS_PER_ROUND = 800;

const hashHex = (input: string) => createHash('sha256').update(input).digest('hex');
const hashInt = (input: string): number => parseInt(hashHex(input).slice(0, 8), 16);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const seededRatio = (seed: string) => hashInt(seed) / 0xffffffff;

export const pickArenaBattlefieldRule = (matchSeed: string) => {
  const disabled = new Set(getArenaAdminControlConfigSync().disabled_battlefield_rule_ids);
  const pool = ARENA_BATTLEFIELD_RULES.filter((rule) => !disabled.has(rule.id));
  const source = pool.length > 0 ? pool : ARENA_BATTLEFIELD_RULES;
  return source[hashInt(`${matchSeed}:battlefield`) % source.length];
};

const getPlanForRound = (deck: ArenaSimulatorDeckSnapshot, roundNo: number) => {
  const plans = deck.round_plans.length > 0 ? deck.round_plans : [];
  return plans.find((plan) => plan.round_no === roundNo) || plans[Math.min(roundNo - 1, Math.max(0, plans.length - 1))];
};

const applyTacticStyle = (
  tacticStyle: string,
  base: { hp: number; attack: number; defense: number; attackIntervalMs: number; skillCost: number; critChance: number }
) => {
  if (tacticStyle === 'aggressive') {
    return { ...base, attack: Math.round(base.attack * 1.08), defense: Math.max(0, base.defense - 4), skillCost: base.skillCost + 4 };
  }
  if (tacticStyle === 'guard' || tacticStyle === 'hold') {
    return { ...base, hp: Math.round(base.hp * 1.06), defense: base.defense + 8, attackIntervalMs: Math.round(base.attackIntervalMs * 1.04) };
  }
  if (tacticStyle === 'tempo') {
    return { ...base, attackIntervalMs: Math.round(base.attackIntervalMs * 0.94), skillCost: Math.max(72, base.skillCost - 5), attack: Math.round(base.attack * 0.97) };
  }
  if (tacticStyle === 'counter') {
    return { ...base, defense: base.defense + 4, critChance: Math.min(0.2, base.critChance + 0.025) };
  }
  if (tacticStyle === 'finisher') {
    return { ...base, attack: Math.round(base.attack * 1.04), critChance: Math.min(0.22, base.critChance + 0.04), defense: Math.max(0, base.defense - 3) };
  }
  return base;
};

const buildUnits = (
  deck: ArenaSimulatorDeckSnapshot,
  side: ArenaSide,
  roundNo: number,
  powerMultiplier: number,
  battlefieldRuleId?: string
): CombatUnit[] => {
  const plan = getPlanForRound(deck, roundNo);
  const chip = ARENA_TACTIC_CHIPS.find((item) => item.id === (deck.strategy_chip_id || 'none')) || ARENA_TACTIC_CHIPS[0];
  const chipMods = (chip?.modifiers || {}) as Record<string, number>;
  const battlefield = ARENA_BATTLEFIELD_RULES.find((item) => item.id === battlefieldRuleId);
  const fieldMods = (battlefield?.modifiers || {}) as Record<string, number>;
  const slotByCardId = new Map((plan?.slots || []).slice(0, 6).map((slot) => [slot.card_id, slot]));
  const selected = deck.cards
    .filter((card) => slotByCardId.has(card.card_id))
    .slice(0, 6);
  const fallback = selected.length > 0 ? selected : deck.cards.slice(0, 6);

  return fallback.map((card, index) => {
    const slot = slotByCardId.get(card.card_id);
    const row = slot?.row ?? (index < 3 ? 1 : 0);
    const col = slot?.col ?? (index % 3);
    const isFrontline = row === 1;
    const isBackline = row === 0;
    const roundPhase = roundNo >= 4 ? 'late' : 'early';
    const hpMod = (fieldMods.hp || 1) * (isBackline ? (chipMods.backline_hp || 1) : 1);
    const attackMod = (fieldMods.attack || 1) * (chipMods.attack || 1) * (roundPhase === 'early' ? (chipMods.early_attack || 1) : 1);
    const defenseMod = (isFrontline ? (fieldMods.frontline_defense || 1) * (chipMods.frontline_defense || 1) : 1) * (roundPhase === 'late' ? (chipMods.late_defense || 1) : 1);
    const hp = Math.round((700 + card.stats.hp * 12) * powerMultiplier * hpMod);
    const attack = Math.round((52 + card.stats.attack * 1.56) * powerMultiplier * attackMod);
    const defense = clamp(Math.round(card.stats.defense * 0.94 * powerMultiplier * defenseMod), 0, 90);
    const base = applyTacticStyle(String(plan?.tactic_style || 'balanced'), {
      hp,
      attack,
      defense,
      attackIntervalMs: Math.round(clamp(1850 - card.stats.speed * 13, 700, 1700) * (chipMods.attack_interval || 1)),
      skillCost: Math.round(clamp(116 - Math.round(card.stats.focus * 0.48), 72, 120) * (chipMods.skill_cost || 1) * (fieldMods.skill_cost || 1)),
      critChance: clamp(0.03 + card.stats.focus / 720, 0.03, 0.17)
    });
    return {
      id: `${side}:${card.card_id}`,
      side,
      card,
      row,
      col,
      maxHp: base.hp,
      hp: base.hp,
      attack: base.attack,
      defense: clamp(base.defense, 0, 120),
      attackIntervalMs: clamp(base.attackIntervalMs, 650, 1850),
      attackCooldownMs: (hashInt(`${side}:${card.card_id}:cooldown`) % 250),
      energy: 20 + (card.stats.focus % 18) + (roundPhase === 'late' ? Number(chipMods.late_energy || 0) : 0) + Number(fieldMods.start_energy || 0),
      skillCost: clamp(base.skillCost, 72, 128),
      critChance: clamp(base.critChance, 0.03, 0.22),
      critDamage: 1.5,
      critTakenMod: clamp(Number(chipMods.crit_taken || 1) * Number(fieldMods.crit_taken || 1), 0.75, 1.1),
      shield: 0,
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      alive: true,
      tacticStyle: String(plan?.tactic_style || 'balanced'),
      focusRule: String(plan?.focus_rule || 'frontline_first')
    };
  });
};

const unitPower = (unit: CombatUnit) =>
  unit.maxHp * 0.35 + unit.attack * 8 + unit.defense * 5 + (2000 - unit.attackIntervalMs) * 0.2 + unit.critChance * 400;

const living = (units: CombatUnit[]) => units.filter((unit) => unit.alive && unit.hp > 0);

const buildReplayUnitStates = (units: CombatUnit[]): ArenaReplayUnitState[] =>
  units.map((unit) => ({
    id: unit.id,
    side: unit.side,
    card_id: unit.card.card_id,
    channel_id: unit.card.channel_id,
    max_hp: unit.maxHp,
    start_hp: unit.maxHp,
    final_hp: Math.max(0, Math.round(unit.hp)),
    alive: unit.alive && unit.hp > 0
  }));

const chooseTarget = (actor: CombatUnit, enemies: CombatUnit[], seed: string) => {
  const aliveEnemies = living(enemies);
  const front = aliveEnemies.filter((unit) => unit.row === 1);
  const back = aliveEnemies.filter((unit) => unit.row === 0);
  const candidates = actor.focusRule === 'backline_first'
    ? (back.length > 0 ? back : aliveEnemies)
    : actor.focusRule === 'lowest_hp'
      ? aliveEnemies
      : actor.focusRule === 'highest_attack'
        ? aliveEnemies
        : (front.length > 0 ? front : aliveEnemies);
  return candidates.sort((a, b) => {
    if (actor.focusRule === 'highest_attack') {
      const attackDiff = b.attack - a.attack;
      if (attackDiff !== 0) return attackDiff;
    }
    const hpDiff = a.hp / a.maxHp - b.hp / b.maxHp;
    if (Math.abs(hpDiff) > 0.001) return hpDiff;
    const colDiff = Math.abs(a.col - actor.col) - Math.abs(b.col - actor.col);
    if (colDiff !== 0) return colDiff;
    return hashInt(`${seed}:${actor.id}:${a.id}`) - hashInt(`${seed}:${actor.id}:${b.id}`);
  })[0];
};

const pushEvent = (events: ArenaBattleEvent[], event: ArenaBattleEvent) => {
  if (events.length < MAX_EVENTS_PER_ROUND) events.push(event);
};

const applyDamage = (
  actor: CombatUnit,
  target: CombatUnit,
  rawDamage: number,
  t: number,
  seed: string,
  events: ArenaBattleEvent[]
) => {
  const crit = seededRatio(`${seed}:crit:${actor.id}:${target.id}:${t}`) < actor.critChance;
  const damageAfterDefense = rawDamage * (100 / (100 + target.defense));
  let damage = Math.max(1, Math.round(damageAfterDefense * (crit ? actor.critDamage * target.critTakenMod : 1)));
  const hpBefore = target.hp;
  const shieldBefore = target.shield;
  if (target.shield > 0) {
    const shieldUsed = Math.min(target.shield, damage);
    target.shield -= shieldUsed;
    damage -= shieldUsed;
  }
  if (damage > 0) {
    target.hp = Math.max(0, target.hp - damage);
    actor.damageDealt += damage;
    target.damageTaken += damage;
    pushEvent(events, {
      t,
      type: 'DAMAGE',
      actor: actor.id,
      targets: [target.id],
      value: damage,
      hp_before: Math.max(0, Math.round(hpBefore)),
      hp_after: Math.max(0, Math.round(target.hp)),
      shield_before: Math.max(0, Math.round(shieldBefore)),
      shield_after: Math.max(0, Math.round(target.shield)),
      alive_after: target.hp > 0
    });
  }
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    pushEvent(events, {
      t,
      type: 'DEATH',
      actor: target.id,
      hp_before: Math.max(0, Math.round(target.hp)),
      hp_after: 0,
      shield_before: Math.max(0, Math.round(target.shield)),
      shield_after: Math.max(0, Math.round(target.shield)),
      alive_after: false,
      message: `${target.card.name} 전투 불능`
    });
  }
};

const castSkill = (
  actor: CombatUnit,
  allies: CombatUnit[],
  enemies: CombatUnit[],
  t: number,
  seed: string,
  events: ArenaBattleEvent[]
) => {
  const skill = actor.card.skills.find((item) => item.type === 'active') || actor.card.skills[0];
  actor.energy = Math.max(0, actor.energy - actor.skillCost);
  pushEvent(events, { t, type: 'SKILL_CAST', actor: actor.id, message: skill ? skill.name : '스킬' });

  if (HEALING_CLASS_IDS.has(actor.card.class_id) || getCardClassRole(actor.card) === 'support') {
    const target = living(allies).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (target) {
      const heal = Math.round(actor.attack * 1.1 + actor.card.stats.focus * 1.7);
      const hpBefore = target.hp;
      const applied = Math.max(0, Math.min(heal, target.maxHp - target.hp));
      target.hp += applied;
      actor.healingDone += applied;
      pushEvent(events, {
        t,
        type: 'HEAL',
        actor: actor.id,
        targets: [target.id],
        value: applied,
        hp_before: Math.max(0, Math.round(hpBefore)),
        hp_after: Math.max(0, Math.round(target.hp)),
        shield_before: Math.max(0, Math.round(target.shield)),
        shield_after: Math.max(0, Math.round(target.shield)),
        alive_after: target.alive && target.hp > 0
      });
    }
    return;
  }

  if (SHIELDING_CLASS_IDS.has(actor.card.class_id)) {
    const target = living(allies).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (target) {
      const shield = Math.round(actor.maxHp * 0.095 + actor.card.stats.defense * 1.6);
      const shieldBefore = target.shield;
      target.shield = clamp(target.shield + shield, 0, Math.round(target.maxHp * 0.5));
      pushEvent(events, {
        t,
        type: 'SHIELD_GAIN',
        actor: actor.id,
        targets: [target.id],
        value: Math.max(0, target.shield - shieldBefore),
        hp_before: Math.max(0, Math.round(target.hp)),
        hp_after: Math.max(0, Math.round(target.hp)),
        shield_before: Math.max(0, Math.round(shieldBefore)),
        shield_after: Math.max(0, Math.round(target.shield)),
        alive_after: target.alive && target.hp > 0
      });
    }
    return;
  }

  const target = chooseTarget(actor, enemies, `${seed}:skill`);
  if (!target) return;
  const multiplier = getSkillDamageMultiplier(actor.card);
  const focusSkillMod = clamp(1 + (actor.card.stats.focus - 55) * 0.0025, 0.94, 1.08);
  applyDamage(actor, target, actor.attack * multiplier * focusSkillMod, t, `${seed}:skill`, events);
};

const simulateRound = (
  playerDeck: ArenaSimulatorDeckSnapshot,
  botDeck: ArenaSimulatorDeckSnapshot,
  roundNo: number,
  seed: string,
  botPowerMultiplier: number,
  battlefieldRuleId?: string
): { result: ArenaRoundResult; replay: ArenaRoundReplay } => {
  const playerUnits = buildUnits(playerDeck, 'player', roundNo, 1, battlefieldRuleId);
  const botUnits = buildUnits(botDeck, 'bot', roundNo, botPowerMultiplier, battlefieldRuleId);
  const events: ArenaBattleEvent[] = [];
  const battlefield = ARENA_BATTLEFIELD_RULES.find((item) => item.id === battlefieldRuleId);
  pushEvent(events, { t: 0, type: 'ROUND_START', message: battlefield ? `${roundNo}라운드 시작 · ${battlefield.name}` : `${roundNo}라운드 시작` });

  let durationMs = ARENA_MAX_ROUND_TICKS * TICK_MS;
  for (let tick = 0; tick < ARENA_MAX_ROUND_TICKS; tick += 1) {
    const t = tick * TICK_MS;
    const actors = [...living(playerUnits), ...living(botUnits)]
      .map((unit) => {
        unit.attackCooldownMs -= TICK_MS;
        unit.energy = Math.min(200, unit.energy + 2 + unit.card.stats.focus * 0.026);
        return unit;
      })
      .filter((unit) => unit.attackCooldownMs <= 0)
      .sort((a, b) => {
        const speedDiff = b.card.stats.speed - a.card.stats.speed;
        if (speedDiff !== 0) return speedDiff;
        return hashInt(`${seed}:order:${t}:${a.id}`) - hashInt(`${seed}:order:${t}:${b.id}`);
      });

    for (const actor of actors) {
      if (!actor.alive) continue;
      const allies = actor.side === 'player' ? playerUnits : botUnits;
      const enemies = actor.side === 'player' ? botUnits : playerUnits;
      if (living(enemies).length === 0) break;

      if (actor.energy >= actor.skillCost) {
        castSkill(actor, allies, enemies, t, seed, events);
      } else {
        const target = chooseTarget(actor, enemies, seed);
        if (target) {
          pushEvent(events, { t, type: 'BASIC_ATTACK', actor: actor.id, targets: [target.id] });
          applyDamage(actor, target, actor.attack, t, seed, events);
          actor.energy = Math.min(200, actor.energy + 12);
        }
      }
      actor.attackCooldownMs += actor.attackIntervalMs;
    }

    if (living(playerUnits).length === 0 || living(botUnits).length === 0) {
      durationMs = t + TICK_MS;
      break;
    }
  }

  const playerAlive = living(playerUnits);
  const botAlive = living(botUnits);
  const playerDamage = playerUnits.reduce((total, unit) => total + unit.damageDealt, 0);
  const botDamage = botUnits.reduce((total, unit) => total + unit.damageDealt, 0);
  let winner: ArenaRoundWinner = 'draw';
  let reason = 'time_limit_tiebreaker';
  if (playerAlive.length > 0 && botAlive.length === 0) {
    winner = 'player';
    reason = 'all_bot_units_defeated';
  } else if (botAlive.length > 0 && playerAlive.length === 0) {
    winner = 'bot';
    reason = 'all_player_units_defeated';
  } else if (playerAlive.length !== botAlive.length) {
    winner = playerAlive.length > botAlive.length ? 'player' : 'bot';
  } else {
    const playerHpRatio = playerAlive.reduce((total, unit) => total + unit.hp / unit.maxHp, 0);
    const botHpRatio = botAlive.reduce((total, unit) => total + unit.hp / unit.maxHp, 0);
    if (Math.abs(playerHpRatio - botHpRatio) > 0.05) winner = playerHpRatio > botHpRatio ? 'player' : 'bot';
    else if (Math.abs(playerDamage - botDamage) > 25) winner = playerDamage > botDamage ? 'player' : 'bot';
  }

  pushEvent(events, {
    t: durationMs,
    type: 'ROUND_RESULT',
    message: winner === 'draw' ? '라운드 무승부' : winner === 'player' ? '플레이어 라운드 승리' : '봇 라운드 승리'
  });

  const result: ArenaRoundResult = {
    round_no: roundNo,
    winner_side: winner,
    duration_ms: durationMs,
    player_power: Math.round(playerUnits.reduce((total, unit) => total + unitPower(unit), 0)),
    bot_power: Math.round(botUnits.reduce((total, unit) => total + unitPower(unit), 0)),
    player_remaining_units: playerAlive.length,
    bot_remaining_units: botAlive.length,
    player_total_damage: playerDamage,
    bot_total_damage: botDamage,
    reason
  };

  return {
    result,
    replay: {
      round_no: roundNo,
      duration_ms: durationMs,
      winner_side: winner,
      unit_states: buildReplayUnitStates([...playerUnits, ...botUnits]),
      events
    }
  };
};

export const simulateArenaSet = ({
  playerDeck,
  opponentDeck,
  opponentPowerMultiplier = 1,
  matchSeed,
  battlefield_rule_id
}: ArenaSetSimulationInput): ArenaSetSimulationResult => {
  const roundResults: ArenaRoundResult[] = [];
  const replayRounds: ArenaRoundReplay[] = [];
  let playerWins = 0;
  let opponentWins = 0;
  let draws = 0;

  for (let roundNo = 1; roundNo <= ARENA_MAX_ROUNDS_PER_MATCH && playerWins < ARENA_ROUNDS_TO_WIN && opponentWins < ARENA_ROUNDS_TO_WIN; roundNo += 1) {
    const round = simulateRound(playerDeck, opponentDeck, roundNo, `${matchSeed}:round:${roundNo}`, opponentPowerMultiplier, battlefield_rule_id);
    roundResults.push(round.result);
    replayRounds.push(round.replay);
    if (round.result.winner_side === 'player') playerWins += 1;
    else if (round.result.winner_side === 'bot') opponentWins += 1;
    else draws += 1;
  }

  return { roundResults, replayRounds, playerWins, opponentWins, draws };
};

export const simulateArenaRound = ({
  playerDeck,
  opponentDeck,
  opponentPowerMultiplier = 1,
  matchSeed,
  battlefield_rule_id,
  roundNo
}: ArenaRoundSimulationInput) =>
  simulateRound(playerDeck, opponentDeck, roundNo, `${matchSeed}:round:${roundNo}`, opponentPowerMultiplier, battlefield_rule_id);

export const __test_getPlanForRound = getPlanForRound;

