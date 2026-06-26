import { describe, expect, it } from 'vitest';
import { __test_getPlanForRound, simulateArenaSet, ArenaSimulatorDeckSnapshot } from '../services/arenaBattleSimulator';
import { __test_simulateCupBracket } from '../services/arenaCupService';
import { ARENA_MATCH_FORMAT, ARENA_ROUNDS_TO_WIN } from '../services/arenaRules';
import { buildArenaReplayJsonForStorage } from '../services/arenaMatchService';
import { generateArenaCardFromStreamer, normalizeArenaCardConfig } from '../services/arenaCatalog';

const makeCard = (id: string, power: 'high' | 'low') => ({
  card_id: id,
  channel_id: id,
  name: id,
  image_url: null,
  class_id: power === 'high' ? 'duelist' : 'supporter',
  class_name: power === 'high' ? '듀얼리스트' : '서포터',
  stats: power === 'high'
    ? { hp: 95, attack: 95, defense: 80, speed: 90, focus: 80 }
    : { hp: 10, attack: 8, defense: 5, speed: 10, focus: 10 },
  skills: [{ id: `${id}-skill`, name: '스킬', type: 'active' }]
});

const makeDeck = (name: string, power: 'high' | 'low', planCount = 5): ArenaSimulatorDeckSnapshot => {
  const cards = Array.from({ length: 6 }, (_, index) => makeCard(`${name}-${index + 1}`, power));
  return {
    deck_id: name,
    name,
    cards,
    round_plans: Array.from({ length: planCount }, (_, index) => ({
      round_no: (index + 1) as 1 | 2 | 3 | 4 | 5,
      formation_id: `test-${index + 1}`,
      tactic_style: 'balanced',
      focus_rule: 'frontline_first',
      slots: cards.map((card, cardIndex) => ({
        card_id: card.card_id,
        channel_id: card.channel_id,
        row: (cardIndex < 3 ? 1 : 0) as 0 | 1,
        col: (cardIndex % 3) as 0 | 1 | 2 | 3
      }))
    }))
  };
};

describe('arena battle rules', () => {
  it('uses best-of-five and stops after three round wins', () => {
    const result = simulateArenaSet({
      playerDeck: makeDeck('player', 'high'),
      opponentDeck: makeDeck('opponent', 'low'),
      matchSeed: 'arena-test-best-of-five'
    });

    expect(ARENA_MATCH_FORMAT).toBe('best_of_five');
    expect(ARENA_ROUNDS_TO_WIN).toBe(3);
    expect(result.playerWins).toBe(3);
    expect(result.opponentWins).toBe(0);
    expect(result.roundResults).toHaveLength(3);
    expect(result.roundResults.every((round) => round.winner_side === 'player')).toBe(true);
  });

  it('reuses the last round plan when a deck has fewer than five plans', () => {
    const deck = makeDeck('reuse', 'high', 3);

    expect(__test_getPlanForRound(deck, 1)?.round_no).toBe(1);
    expect(__test_getPlanForRound(deck, 3)?.round_no).toBe(3);
    expect(__test_getPlanForRound(deck, 4)?.round_no).toBe(3);
    expect(__test_getPlanForRound(deck, 5)?.round_no).toBe(3);
  });

  it('applies saved tactic style to round simulation power', () => {
    const aggressive = makeDeck('aggressive', 'high', 1);
    const guard = makeDeck('guard', 'high', 1);
    aggressive.round_plans[0].tactic_style = 'aggressive';
    guard.round_plans[0].tactic_style = 'guard';

    const aggressiveResult = simulateArenaSet({
      playerDeck: aggressive,
      opponentDeck: makeDeck('opponent-a', 'low', 1),
      matchSeed: 'arena-test-aggressive-style'
    });
    const guardResult = simulateArenaSet({
      playerDeck: guard,
      opponentDeck: makeDeck('opponent-g', 'low', 1),
      matchSeed: 'arena-test-guard-style'
    });

    expect(aggressiveResult.roundResults[0].player_power).not.toBe(guardResult.roundResults[0].player_power);
  });
});

describe('arena cup bracket', () => {
  it('creates placement matches and ranks all eight players for an eight player cup', () => {
    const participants = Array.from({ length: 8 }, (_, index) => {
      const deck = makeDeck(`cup-${index + 1}`, index === 0 ? 'high' : 'low');
      return {
        seed_no: 0,
        queue_id: String(index + 1),
        user_id: `user-${index + 1}`,
        deck_id: deck.deck_id,
        deck_hash: `hash-${index + 1}`,
        deck
      };
    });

    const result = __test_simulateCupBracket(participants, 'arena-cup-test-seed');

    expect(result.bracket.mode_id).toBe('eight_player_strategy_cup');
    expect(result.bracket.match_format).toBe('best_of_five');
    expect(result.bracket.rounds_to_win).toBe(3);
    expect(result.bracket.participants).toHaveLength(8);
    expect(result.bracket.matches).toHaveLength(12);
    expect(result.replay.matches).toHaveLength(12);
    expect(result.bracket.placements).toHaveLength(8);
    expect(result.bracket.placements.map((item: any) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.bracket.champion_user_id).toMatch(/^user-/);
  });
});
describe('arena replay storage policy', () => {
  it('bounds replay event count before storage', () => {
    const replayJson = buildArenaReplayJsonForStorage({
      match_id: '',
      match_format: ARENA_MATCH_FORMAT,
      rounds_to_win: ARENA_ROUNDS_TO_WIN,
      replay_storage: 'tick_events',
      rounds: [
        {
          round_no: 1,
          duration_ms: 1000,
          winner_side: 'player',
          unit_states: [{ id: 'u1', side: 'player', card_id: 'c1', max_hp: 100, start_hp: 100, final_hp: 80, alive: true }],
          events: Array.from({ length: 200 }, (_, index) => ({ t: index, type: 'hit', value: 1 }))
        }
      ]
    });

    expect(replayJson).toBeTruthy();
    const parsed = JSON.parse(replayJson || '{}');
    expect(parsed.replay_version).toBe(2);
    expect(parsed.rounds[0].events).toHaveLength(120);
    expect(parsed.rounds[0].unit_states).toHaveLength(1);
    expect(parsed.rounds[0].replay_truncated).toBe(true);
    expect(parsed.rounds[0].original_event_count).toBe(200);
    expect(parsed.rounds[0].timeline_summary.omitted_event_count).toBe(80);
  });

  it('emits replay event health state and final unit states for deterministic playback', () => {
    const result = simulateArenaSet({
      playerDeck: makeDeck('replay-player', 'high'),
      opponentDeck: makeDeck('replay-opponent', 'low'),
      matchSeed: 'arena-test-replay-health-state'
    });
    const round = result.replayRounds[0];
    const stateById = new Map((round.unit_states || []).map((state: any) => [state.id, state]));
    const healthEvents = round.events.filter((event: any) => ['DAMAGE', 'HEAL', 'SHIELD_GAIN'].includes(String(event.type || '').toUpperCase()));

    expect(round.unit_states?.length).toBeGreaterThan(0);
    expect(healthEvents.length).toBeGreaterThan(0);
    for (const event of healthEvents) {
      expect(typeof event.hp_before).toBe('number');
      expect(typeof event.hp_after).toBe('number');
      expect(typeof event.shield_before).toBe('number');
      expect(typeof event.shield_after).toBe('number');
      expect(typeof event.alive_after).toBe('boolean');
    }
    for (const state of stateById.values()) {
      if ((state as any).alive === false) expect((state as any).final_hp).toBe(0);
      expect((state as any).final_hp).toBeGreaterThanOrEqual(0);
      expect((state as any).final_hp).toBeLessThanOrEqual((state as any).max_hp);
    }
  });
});

describe('arena streamer card configuration', () => {
  const streamer: any = {
    channel_id: 'streamer-config-test',
    name: '설정 테스트',
    custom_images: [],
    custom_image_url: null,
    logo_url: null,
    is_image_banned: false
  };

  it('keeps configured cards deterministic while applying class, skills, tags, and fixed stat budget', () => {
    const config = normalizeArenaCardConfig({
      class_id: 'guardian',
      stat_focus: 'defense',
      combat_style: 'guard',
      skill_ids: ['aegis-pop', 'soft-taunt', 'last-cookie', 'neon-sting'],
      tag_ids: ['shield', 'frontline', 'not_allowed'],
      flavor_text: '전열 고정'
    });

    const first = generateArenaCardFromStreamer(streamer, { config });
    const second = generateArenaCardFromStreamer(streamer, { config });

    expect(first).toEqual(second);
    expect(first.config_source).toBe('streamer_config');
    expect(first.class.id).toBe('shield_knight');
    expect(first.skills.map((skill) => skill.id)).toEqual(['aegis-pop', 'soft-taunt', 'last-cookie']);
    expect(first.tags).toContain('shield');
    expect(first.tags).toContain('frontline');
    expect(first.tags).not.toContain('not_allowed');
    expect(Object.values(first.stats).reduce((sum, value) => sum + value, 0)).toBe(300);
  });

  it('drops skills that do not belong to the configured class', () => {
    const config = normalizeArenaCardConfig({
      class_id: 'supporter',
      skill_ids: ['bubble-tea', 'neon-sting', 'team-chant']
    });

    const card = generateArenaCardFromStreamer(streamer, { config });

    expect(card.class.id).toBe('healer');
    expect(card.skills.map((skill) => skill.id)).toContain('bubble-tea');
    expect(card.skills.map((skill) => skill.id)).not.toContain('neon-sting');
  });
});
