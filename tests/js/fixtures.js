import { clean } from '../../site/js/config.js';
import { Game } from '../../site/js/engine.js';

export const PLAIN = { pause: 30, hint_every: 20 };

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeClock(start = 1000) {
  const clock = () => clock.t;
  clock.t = start;
  return clock;
}

export function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

export function fixedPhrases(...lines) {
  let next = 0;
  return { next: () => lines[next++ % lines.length].split('|') };
}

export const PHRASE = 'кот съел рыбу вчера';

export function makeGame({ settings = {}, phrases = [PHRASE], scores = null, at = 1000, seed = 1 } = {}) {
  const clock = fakeClock(at);
  const game = new Game(fixedPhrases(...phrases), clean({ ...PLAIN, ...settings }), scores,
    { rng: seeded(seed), clock });
  const events = [];
  game.listeners.push((event) => events.push(event));
  return { game, clock, events };
}

export function startRound(options = {}) {
  const made = makeGame(options);
  made.game.open(0);
  made.game.tick();
  return made;
}

export const shown = (game) => game.snapshot().words.map((word) => word.shown);
export const known = (game, line = 0) => Array.from(game.round.lines[line].known).sort();
export const hintAt = (game, line = 0) => game.snapshot().lines[line].hint_at;
export const local = (...when) => new Date(...when).getTime() / 1000;
