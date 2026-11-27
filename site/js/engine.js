import { masked, norm, pick } from './phrases.js';

export const COMMANDS = new Map([['!фразолов-раунд', 'skip'], ['!фразолов-пауза', 'pause'],
  ['!фразолов-сброс', 'reset']]);
export const STARS = new Map([
  ['sumaizu', 'rainbow'],
  ['sukoshissrb', 'white'],
  ['fra3a', 'thyme'],
  ['welovegames', 'heart'],
  ['higashi_vo', 'snow'],
  ['renozis', 'glare'],
  ['sulffur_', 'gem'],
]);
export const BOTS = [
  'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'jeetbot', 'soundalerts', 'sery_bot',
  'kofistreambot', 'tangiabot', 'botisimo', 'lumiastream', 'streamstickers', 'creatisbot', 'own3d', 'dixperbro',
  'pokemoncommunitygame', 'songlistbot', 'pretzelrocks', 'restreambot', 'commanderroot', 'frostytoolsdotcom',
];
export const START_DELAY = 10;
export const CHAT_KEEP = 60;
export const CHAT_SHOWN = 30;
export const CHAT_TEXT_MAX = 300;
export const TOP_SHOWN = 30;
export const GIVEN_UP_TO = 2;
export const STARTING_LETTERS = 2;
export const WORD_POINTS = 1;

const EMOTES_MAX = 30;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EMOTE_ID_RE = /^[A-Za-z0-9_]{1,80}$/;
const WORD_RE = /^[а-я]+$/;
const PUNCTUATION = ' \t.,!?…:;"\'«»()[]<>-—';
const INVISIBLE = /[​‌‍⁠﻿­͏⠀\u{E0000}]/gu;
const IGNORED = new Set(BOTS);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase());

function trim(text, chars) {
  let from = 0, to = text.length;
  while (from < to && chars.includes(text[from])) from++;
  while (to > from && chars.includes(text[to - 1])) to--;
  return text.slice(from, to);
}

function cleanEmotes(raw) {
  const emotes = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emotes;
  let count = 0;
  for (const name of Object.keys(raw)) {
    const id = String(raw[name]);
    if (!name || name.length > 60 || /\s/.test(name) || !EMOTE_ID_RE.test(id)) continue;
    emotes[name] = id;
    if (++count >= EMOTES_MAX) break;
  }
  return emotes;
}

export function nextReset(since, mode, hour = 0, hours = 12) {
  if (mode === 'timer') return since + Math.max(1, hours) * 3600;
  if (mode !== 'day' && mode !== 'week' && mode !== 'month') return null;
  const from = new Date(since * 1000);
  if (isNaN(from.getTime())) return null;
  const year = from.getFullYear(), month = from.getMonth(), day = from.getDate();
  let due;
  if (mode === 'day') {
    due = new Date(year, month, day, hour);
    if (due <= from) due = new Date(year, month, day + 1, hour);
  } else if (mode === 'week') {
    const monday = day - (from.getDay() + 6) % 7;
    due = new Date(year, month, monday, hour);
    if (due <= from) due = new Date(year, month, monday + 7, hour);
  } else {
    due = new Date(year, month, 1, hour);
    if (due <= from) due = new Date(year, month + 1, 1, hour);
  }
  return due.getTime() / 1000;
}

export class Scores {
  constructor(storage = null, key = 'frazolov.scores') {
    this.storage = storage;
    this.key = key;
    this.data = new Map();
    this.since = null;
    if (!storage) return;
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}');
      for (const [id, entry] of Object.entries(saved)) {
        if (!entry || typeof entry !== 'object') continue;
        this.data.set(id, { name: String(entry.name || id), score: Math.trunc(Number(entry.score) || 0),
          words: Math.trunc(Number(entry.words) || 0) });
      }
      const since = Number(storage.getItem(key + '.since'));
      this.since = Number.isFinite(since) && since > 0 ? since : null;
    } catch (error) {
      this.data = new Map();
      this.since = null;
    }
  }

  get size() {
    return this.data.size;
  }

  add(name, points) {
    const id = name.toLowerCase();
    const entry = this.data.get(id) || { name, score: 0, words: 0 };
    entry.name = name;
    entry.score += points;
    entry.words += 1;
    this.data.set(id, entry);
    this._save();
  }

  reset(now) {
    this.data = new Map();
    if (now !== undefined && now !== null) this.since = now;
    this._save();
  }

  mark(now) {
    this.since = now;
    this._save();
  }

  top(count) {
    const rows = Array.from(this.data.values()).sort((a, b) => b.score - a.score || byName(a, b));
    return (count === undefined ? rows : rows.slice(0, count))
      .map((entry) => ({ name: entry.name, score: entry.score, words: entry.words }));
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(Object.fromEntries(this.data)));
      if (this.since === null) this.storage.removeItem(this.key + '.since');
      else this.storage.setItem(this.key + '.since', String(this.since));
    } catch (error) {
      this.storage = null;
    }
  }
}

export class Game {
  constructor(phrases, settings, scores = null, { rng = Math.random, clock = () => Date.now() / 1000 } = {}) {
    this.phrases = phrases;
    this.s = Object.assign({}, settings);
    this.scores = scores || new Scores();
    this.rng = rng;
    this.clock = clock;
    this.version = 0;
    this.state = 'stopped';
    this.roundNo = 0;
    this.round = null;
    this.results = null;
    this.startsAt = null;
    this._held = null;
    this.listeners = [];
    this.onchange = null;
    this._events = [];
    this._delivering = false;
    this._chat = [];
    this._chatNo = 0;
    this._resetDue = null;
    this._planReset();
  }

  open(delay = START_DELAY) {
    return this._run(() => {
      if (this.state !== 'stopped') return false;
      this.state = 'countdown';
      this.startsAt = this.clock() + delay;
      this._emit('countdown', { starts_at: this.startsAt });
      this._bump();
      return true;
    });
  }

  stop() {
    return this._run(() => {
      if (this.state === 'stopped') return;
      this._halt();
      this._emit('stopped');
      this._bump();
    });
  }

  pause() {
    return this._run(() => this._pause());
  }

  resume() {
    return this._run(() => this._resume());
  }

  skip() {
    return this._run(() => this._skip());
  }

  hint(index = null) {
    return this._run(() => {
      if (this.state !== 'playing') return false;
      const lines = this.round.lines.filter((line, i) => (index === null || i === index) && this._hidden(line).length);
      if (!lines.length) return false;
      this._hint(pick(this.rng, lines), this.clock());
      return true;
    });
  }

  resetScores() {
    return this._run(() => this._resetScores());
  }

  configure(settings) {
    return this._run(() => {
      const before = this.s, s = Object.assign({}, settings), now = this.clock();
      const changed = (...keys) => keys.some((key) => before[key] !== s[key]);
      this.s = s;
      if (changed('reset_mode', 'reset_hour', 'reset_hours') && this.scores.since !== null) this.scores.mark(now);
      this._planReset();
      const held = this._held, from = held ? held.at : now;
      if (this.state === 'playing' || (held && held.state === 'playing')) {
        const round = this.round;
        if (changed('round_time')) round.ends = s.round_time ? round.started + round.idle + s.round_time : null;
        if (changed('hint_every')) for (const line of round.lines) this._planHint(line, from);
      }
      this._bump();
    });
  }

  feed(user, text, { mod = false, msgId = null, login = null, color = null, emotes = null } = {}) {
    return this._run(() => {
      const name = String(user || '').trim();
      const message = String(text || '').normalize('NFC').replace(INVISIBLE, '').trim();
      login = String(login || '').toLowerCase();
      if (!name || !message || IGNORED.has(login || name.toLowerCase())) return null;
      const entry = this._say(name, message, msgId, login, color, emotes);
      if (message.charAt(0) === '!') return this._command(message, mod);
      if (this.state !== 'playing') return null;
      const word = norm(trim(message, PUNCTUATION));
      return WORD_RE.test(word) ? this._guess(name, word, entry) : null;
    });
  }

  unsay({ msgId = null, user = null, everything = false } = {}) {
    return this._run(() => {
      const who = String(user || '').toLowerCase();
      const gone = (entry) => everything || (msgId ? entry.msgId === String(msgId)
        : Boolean(who) && (entry.login === who || entry.user.toLowerCase() === who));
      const kept = this._chat.filter((entry) => !gone(entry));
      const removed = this._chat.length - kept.length;
      if (removed) {
        this._chat = kept;
        this._bump();
      }
      return removed;
    });
  }

  tick(now = this.clock()) {
    return this._run(() => {
      if (this._resetDue !== null && now >= this._resetDue) this._resetScores(true, now);
      if (this.state === 'countdown') {
        if (now >= this.startsAt) this._newRound();
      } else if (this.state === 'playing') {
        const round = this.round;
        if (round.ends && now >= round.ends) {
          this._finish('time');
          return;
        }
        for (const line of round.lines) {
          if (this.state === 'playing' && line.hintAt && now >= line.hintAt) this._hint(line, now);
        }
      } else if (this.state === 'results') {
        if (now >= this.results.next_at) this._newRound();
      }
    });
  }

  answers() {
    const round = this.round;
    if (!round) return { text: null, words: [] };
    const words = round.words.map((word) => ({ word: word.text, line: word.line, by: word.by, how: word.how }));
    return { text: round.lines.map((line) => line.text), words };
  }

  snapshot() {
    const now = this.clock();
    const state = {
      version: this.version,
      now: Math.round(now * 100) / 100,
      state: this.state,
      round: this.roundNo,
      starts_at: this.state === 'countdown' ? this.startsAt : null,
      pause: this.s.pause,
      hint_every: this.s.hint_every,
      top: this.scores.top(TOP_SHOWN),
      players: this.scores.size,
      stars: Array.from(STARS),
      feed: this._chat.slice(-CHAT_SHOWN).map((entry) => {
        const message = { id: entry.id, user: entry.user, text: entry.text, color: entry.color, pts: entry.pts,
          repeat: entry.repeat, star: entry.star };
        if (Object.keys(entry.emotes).length) message.emotes = Object.assign({}, entry.emotes);
        return message;
      }),
    };
    const round = this.round;
    if (!round) return state;
    const over = Boolean(this.results);
    state.words = round.words.map((word) => {
      const open = Boolean(word.how) || over;
      const known = round.lines[word.line].known;
      return { line: word.line, len: word.len, word: open ? word.text : null,
        shown: open ? word.text : masked(word.text, known), by: word.by, how: word.how, missed: over && !word.how };
    });
    state.lines = round.lines.map((line) => ({ done: this._done(line),
      hint_at: this.state === 'playing' ? line.hintAt : null }));
    state.total = round.words.length;
    state.found = round.words.filter((word) => word.how).length;
    state.round_scores = this._roundScores();
    state.started = Math.round(round.started * 100) / 100;
    state.ends = round.ends;
    if (this.results) state.results = Object.assign({}, this.results);
    return state;
  }

  _run(action) {
    const result = action();
    this._deliver();
    return result;
  }

  _deliver() {
    if (this._delivering) return;
    this._delivering = true;
    try {
      while (this._events.length) {
        const event = this._events.shift();
        for (const listener of this.listeners.slice()) {
          try {
            listener(event);
          } catch (error) {
            continue;
          }
        }
      }
    } finally {
      this._delivering = false;
    }
  }

  _emit(type, data = {}) {
    const event = Object.assign({ type, at: this.clock() }, data);
    this._events.push(event);
    return event;
  }

  _bump() {
    this.version += 1;
    if (this.onchange) this.onchange();
  }

  _halt() {
    this.state = 'stopped';
    this.round = null;
    this.results = null;
    this.startsAt = null;
    this._held = null;
  }

  _pause() {
    if (this.state === 'stopped' || this.state === 'paused') return false;
    this._held = { state: this.state, at: this.clock() };
    this.state = 'paused';
    this._emit('paused');
    this._bump();
    return true;
  }

  _resume() {
    if (this.state !== 'paused') return false;
    const idle = this.clock() - this._held.at, round = this.round;
    if (this.startsAt !== null) this.startsAt += idle;
    if (this.results) this.results.next_at += idle;
    if (round) {
      round.idle += idle;
      if (round.ends) round.ends += idle;
      for (const line of round.lines) if (line.hintAt) line.hintAt += idle;
    }
    this.state = this._held.state;
    this._held = null;
    this._emit('resumed');
    this._bump();
    return true;
  }

  _skip() {
    if (this.state === 'playing') this._finish('skip');
    else if (this.state === 'results') this._newRound();
  }

  _resetScores(auto = false, now = this.clock()) {
    this.scores.reset(now);
    this._planReset();
    this._emit('scores_reset', { auto });
    this._bump();
  }

  _planReset() {
    const s = this.s;
    if (!s.reset_mode || s.reset_mode === 'never') {
      this._resetDue = null;
      return;
    }
    if (this.scores.since === null) this.scores.mark(this.clock());
    this._resetDue = nextReset(this.scores.since, s.reset_mode, s.reset_hour || 0, s.reset_hours || 12);
  }

  _command(message, mod) {
    const command = COMMANDS.get(message.toLowerCase().split(/\s+/)[0]);
    if (!command || !mod || this.s.chat_commands === false) return null;
    if (command === 'skip') this._skip();
    else if (command === 'reset') this._resetScores();
    else if (!this._resume()) this._pause();
    return { type: 'command', command };
  }

  _say(name, text, msgId, login, color, emotes) {
    this._chatNo += 1;
    const entry = {
      id: this._chatNo,
      user: name,
      text: text.slice(0, CHAT_TEXT_MAX),
      color: typeof color === 'string' && COLOR_RE.test(color) ? color.toLowerCase() : '',
      pts: 0,
      repeat: false,
      star: STARS.get(login || name.toLowerCase()) || '',
      emotes: cleanEmotes(emotes),
      msgId: String(msgId || ''),
      login,
    };
    this._chat.push(entry);
    if (this._chat.length > CHAT_KEEP) this._chat.shift();
    if (this.state !== 'stopped') this._bump();
    return entry;
  }

  _guess(name, word, entry) {
    const round = this.round, now = this.clock();
    const matches = round.words.filter((item) => item.key === word);
    if (!matches.length) return null;
    const shut = matches.filter((item) => !item.how);
    if (!shut.length) {
      entry.repeat = true;
      return this._emit('repeat', { user: name, word: matches[0].text, by: matches[0].by });
    }
    const lines = new Set();
    for (const item of shut) {
      item.how = 'guess';
      item.by = name;
      item.at = now;
      lines.add(round.lines[item.line]);
    }
    for (const line of lines) this._learn(line, word);
    const points = WORD_POINTS, viewer = name.toLowerCase();
    const score = round.scores.get(viewer) || { name, pts: 0, words: 0 };
    score.name = name;
    score.pts += points;
    score.words += 1;
    round.scores.set(viewer, score);
    this.scores.add(name, points);
    entry.pts = points;
    const event = this._emit('guess', { user: name, word: shut[0].text, pts: points,
      total: this.scores.data.get(viewer).score });
    if (!this._settle()) for (const line of lines) this._planHint(line, now);
    this._bump();
    return event;
  }

  _learn(line, letters) {
    for (const letter of norm(letters)) line.known.add(letter);
    for (const item of line.words) {
      if (!item.how && Array.from(item.key).every((letter) => line.known.has(letter))) item.how = 'letters';
    }
  }

  _hidden(line) {
    const hidden = new Set();
    for (const item of line.words) {
      if (item.how) continue;
      for (const letter of item.key) if (!line.known.has(letter)) hidden.add(letter);
    }
    return Array.from(hidden).sort();
  }

  _done(line) {
    return line.words.every((item) => item.how);
  }

  _planHint(line, from) {
    line.hintAt = this.s.hint_every && !this._done(line) ? from + this.s.hint_every : null;
  }

  _settle() {
    if (!this.round.lines.every((line) => this._done(line))) return false;
    this._finish('all');
    return true;
  }

  _hint(line, now) {
    const hidden = this._hidden(line);
    if (!hidden.length) {
      line.hintAt = null;
      return;
    }
    const letter = pick(this.rng, hidden);
    this._learn(line, letter);
    this._emit('hint', { line: this.round.lines.indexOf(line), letter });
    if (!this._settle()) this._planHint(line, now);
    this._bump();
  }

  _newRound() {
    const text = this.phrases.next(), now = this.clock();
    const words = [];
    const lines = text.map((sentence, index) => {
      const line = { text: sentence, known: new Set(), words: [], hintAt: null };
      for (const word of sentence.split(' ').filter(Boolean)) {
        const item = { text: word, key: norm(word), len: word.length, line: index,
          how: word.length <= GIVEN_UP_TO ? 'given' : null, by: null, at: null };
        line.words.push(item);
        words.push(item);
        if (item.how) for (const letter of item.key) line.known.add(letter);
      }
      return line;
    });
    this.roundNo += 1;
    this.round = { text, lines, words, scores: new Map(), started: now, idle: 0,
      ends: this.s.round_time ? now + this.s.round_time : null };
    for (const line of lines) {
      const letters = Array.from(norm(line.text.replace(/ /g, '')));
      while (letters.filter((letter) => line.known.has(letter)).length < STARTING_LETTERS) {
        const hidden = this._hidden(line);
        if (!hidden.length) break;
        this._learn(line, pick(this.rng, hidden));
      }
    }
    this.results = null;
    this.startsAt = null;
    this.state = 'playing';
    this._emit('round_start', { round: this.roundNo, text, words: words.length });
    if (!this._settle()) for (const line of lines) this._planHint(line, now);
    this._bump();
  }

  _roundScores() {
    return Array.from(this.round.scores.values()).sort((a, b) => b.pts - a.pts || byName(a, b))
      .map((entry) => ({ name: entry.name, pts: entry.pts, words: entry.words }));
  }

  _finish(reason) {
    const round = this.round, now = this.clock();
    this.results = { reason, at: now, round: this.roundNo, text: round.text.slice(), next_at: now + this.s.pause,
      scores: this._roundScores() };
    this.state = 'results';
    for (const line of round.lines) line.hintAt = null;
    this._emit('round_end', { round: this.roundNo, reason, text: round.text.slice(),
      found: round.words.filter((item) => item.how === 'guess').length, total: round.words.length,
      scores: this.results.scores, missed: round.words.filter((item) => !item.how).map((item) => item.text) });
    this._bump();
  }
}
