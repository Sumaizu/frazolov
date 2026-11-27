import { masked, norm } from './phrases.js';

const NOW = 1000;
const TEXT = [
  { line: 'утром кот проснулся рано', found: [['кот', 'tiny_frog'], ['утром', 'Соня']], hints: 'а' },
  { line: 'он тихо пошёл на кухню', found: [['тихо', 'Борщ']], hints: 'к' },
  { line: 'там стояла миска с молоком', found: [['миска', 'ЛисаАлиса']], hints: 'о' },
  { line: 'кот выпил всё до капли', found: [['кот', 'valera']], hints: 'л' },
  { line: 'потом он снова лёг спать', found: [], hints: 'та' },
];
const HINT_SHARE = [0.66, 0.4, 0.85, 0.2, 0.55];

const CHAT = [
  { user: 'kotofey', text: 'всем привет!' },
  { user: 'tiny_frog', text: 'кот', pts: 1 },
  { user: 'Соня', text: 'утром', pts: 1 },
  { user: 'neko_chan', text: 'собака' },
  { user: 'Борщ', text: 'тихо', pts: 1 },
  { user: 'Mishka_Gamer', text: 'тихо', repeat: true },
  { user: 'ЛисаАлиса', text: 'миска', pts: 1 },
  { user: 'pelmen', text: 'молоко?' },
  { user: 'valera', text: 'кот', pts: 1 },
  { user: 'neko_chan', text: 'не успеваю за вами' },
];

const TOTALS = [
  ['tiny_frog', 17], ['Борщ', 15], ['ЛисаАлиса', 12], ['kotofey', 11], ['pelmen', 9], ['Соня', 8], ['valera', 7],
  ['Mishka_Gamer', 6], ['ya_tut', 5], ['neko_chan', 4], ['pingvin', 3], ['Тимофей', 2], ['sova_noch', 1],
  ['zhuk', 1],
];

export function demoState(settings) {
  const words = [], points = new Map();
  TEXT.forEach(({ line, found, hints }, index) => {
    const finders = new Map(found);
    const known = new Set(hints);
    for (const [word, name] of found) {
      for (const letter of norm(word)) known.add(letter);
      points.set(name, (points.get(name) || 0) + 1);
    }
    for (const text of line.split(' ')) {
      const by = finders.get(text) || null;
      const how = by ? 'guess' : text.length <= 2 ? 'given'
        : Array.from(norm(text)).every((letter) => known.has(letter)) ? 'letters' : null;
      words.push({ line: index, len: text.length, word: how ? text : null, shown: how ? text : masked(text, known),
        by, how, missed: false });
    }
  });
  return {
    version: 1,
    now: NOW,
    state: 'playing',
    round: 4,
    starts_at: null,
    pause: settings.pause,
    hint_every: settings.hint_every,
    top: TOTALS.map(([name, score]) => ({ name, score, words: score })),
    players: TOTALS.length,
    stars: [],
    feed: CHAT.map((line, i) => ({ id: i + 1, user: line.user, text: line.text, color: '', pts: line.pts || 0,
      repeat: Boolean(line.repeat), star: '' })),
    words,
    lines: HINT_SHARE.map((share) => ({ done: false,
      hint_at: settings.hint_every ? NOW + Math.round(settings.hint_every * share) : null })),
    total: words.length,
    found: words.filter((word) => word.how).length,
    round_scores: Array.from(points, ([name, pts]) => ({ name, pts, words: pts })),
    started: NOW - 60,
    ends: settings.round_time ? NOW + Math.round(settings.round_time * 0.6) : null,
  };
}
