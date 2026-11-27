import { Emotes } from './emotes.js';
import { play } from './sound.js';

const STAGE_WIDTH = 1280, MINI_WIDTH = 1280 / 3, STAGE_HEIGHT = 720;
const TILE = 84, TILE_GAP = 10;
const CELL_MAX = 52, CELL_MIN = 10, SINGLE_ROW_MIN = 18, CELL_GAP = 0.09, WORD_GAP = 0.7, ROW_GAP = 0.25, LINE_GAP = 0.45, BAR = 9;
const FIELD = { width: 720, height: 520 };
const SIDE = { height: 664, rules: 159, row: 24, frame: 42, gap: 12 };
const BOARD = { height: 604, frame: 53, row: 32 };
const TOP_ROWS = 10;
const LONG_WORD = 7;
const FINAL_SECONDS = 3;
const CYCLES = new Map([['rainbow', 2400], ['heart-reds', 8000], ['snow-glint', 6000], ['glare', 3000], ['gem', 6000]]);
const TITLE = 'ФРАЗОЛОВ';
const REASONS = { all: 'Текст открыт!', time: 'Время вышло', skip: 'Раунд окончен' };
const NICK_COLORS = ['#ff8f85', '#ffb547', '#f2dd6e', '#8fe3ae', '#7fd4ff', '#b7a6ff', '#ff9ad5', '#8fe0d2'];
const SOUND_PRIORITY = ['win', 'end', 'start', 'long', 'guess', 'tick', 'hint'];

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function plural(n, one, few, many) {
  const units = n % 10, tens = n % 100;
  if (units === 1 && tens !== 11) return one;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

function clockText(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

function luminance(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function nickColor(message) {
  if (!/^#[0-9a-f]{6}$/i.test(message.color || '')) {
    let hash = 0;
    for (const ch of message.user.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return NICK_COLORS[hash % NICK_COLORS.length];
  }
  const value = parseInt(message.color.slice(1), 16);
  let rgb = [value >> 16 & 255, value >> 8 & 255, value & 255];
  const light = luminance(...rgb);
  if (light < 0.45) {
    const lift = (0.45 - light) / (1 - light);
    rgb = rgb.map((channel) => Math.round(channel + (255 - channel) * lift));
  }
  return 'rgb(' + rgb.join(',') + ')';
}

function keepInStep(event) {
  const cycle = CYCLES.get(event.animationName);
  if (cycle) event.target.style.setProperty('--phase', -(Date.now() % cycle) + 'ms');
}

function breakRows(lengths, first, cell, width) {
  const span = (len) => len * cell + (len - 1) * cell * CELL_GAP, gap = cell * WORD_GAP;
  const rows = [];
  let row = [], used = 0;
  for (let i = 0; i < lengths.length; i++) {
    const size = span(lengths[i]);
    if (size > width) return null;
    if (row.length && used + gap + size > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += (row.length ? gap : 0) + size;
    row.push(first + i);
  }
  if (row.length) rows.push(row);
  return rows;
}

function arrange(sentences, cell, width, single = false) {
  const blocks = [];
  let first = 0;
  for (const lengths of sentences) {
    const rows = breakRows(lengths, first, cell, width);
    if (!rows || (single && rows.length > 1)) return null;
    blocks.push(rows);
    first += lengths.length;
  }
  return blocks;
}

function blocksHeight(blocks, cell) {
  let height = (blocks.length - 1) * cell * LINE_GAP;
  for (const rows of blocks) height += rows.length * cell + rows.length * cell * ROW_GAP + BAR;
  return height;
}

export function phraseLayout(sentences, width, height) {
  for (let cell = CELL_MAX; cell >= SINGLE_ROW_MIN; cell -= 0.5) {
    const blocks = arrange(sentences, cell, width, true);
    if (blocks && blocksHeight(blocks, cell) <= height) return { cell, blocks };
  }
  for (let cell = CELL_MAX; cell > CELL_MIN; cell -= 0.5) {
    const blocks = arrange(sentences, cell, width);
    if (blocks && blocksHeight(blocks, cell) <= height) return { cell, blocks };
  }
  return { cell: CELL_MIN, blocks: arrange(sentences, CELL_MIN, Infinity) };
}

export function sideRows(roundCount, totalCount, capacity) {
  const round = Math.max(1, roundCount), total = Math.max(1, totalCount);
  if (round + total <= capacity) return { round, total: capacity - round };
  const rows = Math.max(1, Math.min(round, capacity - Math.min(total, TOP_ROWS)));
  return { round: rows, total: capacity - rows };
}

export class View {
  constructor() {
    this.still = false;
    this.settings = null;
    this.state = null;
    this.offset = 0;
    this.heard = [];
    this.emotes = new Emotes(() => this._redrawFeed());
    this._animate = false;
    this._previous = '';
    this._roundKey = '';
    this._words = [];
    this._bars = [];
    this._wordKeys = [];
    this._listKeys = {};
    this._stars = new Map();
    this._starsKey = '';
    this._cues = [];
    this._feedRows = new Map();
    this._feedNewest = 0;
    this._feedStale = false;
    this._secondsLeft = null;
    this._countdownFrom = null;
    this._mini = false;
    for (const letter of TITLE) $('brand-tiles').append(el('div', 'tile', letter));
    window.addEventListener('resize', () => this._fitStage());
    document.addEventListener('animationstart', keepInStep);
    this._fitStage();
    setInterval(() => this.tick(), 250);
  }

  setStill(still) {
    this.still = still;
    this._animate = false;
    this._previous = '';
    this._roundKey = '';
    this._listKeys = {};
    this._feedStale = true;
    this._cues = [];
  }

  use(settings) {
    this.settings = settings;
    const body = document.body;
    body.classList.toggle('nocam', settings.webcam === 'none');
    body.classList.toggle('vtuber', settings.webcam === 'vtuber');
    body.classList.toggle('mini', settings.mini);
    this._paintRules();
    this._listKeys = {};
    if (settings.mini === this._mini) return;
    this._mini = settings.mini;
    this._fitStage();
    if (this._roundKey && this.state && this.state.words) this._fitPhrase(this.state);
  }

  render(state) {
    this.state = state;
    this.offset = state.now - Date.now() / 1000;
    this._setStars(state.stars);
    this.emotes.watch(state.room_id);
    const stage = $('stage');
    if (state.state === 'stopped') {
      stage.hidden = $('lobby').hidden = true;
      this._roundKey = '';
      this._previous = 'stopped';
      this._cues = [];
      return;
    }
    stage.hidden = false;
    const paused = state.state === 'paused', waiting = !state.words, over = Boolean(state.results);
    const wasWaiting = !$('lobby').hidden;
    $('card').classList.toggle('results', over);
    $('card').classList.toggle('paused', paused);
    $('pause').hidden = !paused;
    $('head').hidden = $('play').hidden = waiting || paused;
    $('lobby').hidden = !waiting || paused;
    const roundKey = waiting ? '' : [state.round, state.started].concat(state.words.map((word) => word.line + '.' + word.len)).join(':');
    if (roundKey !== this._roundKey) {
      this._roundKey = roundKey;
      this._listKeys = {};
      if (!waiting) this._startRound(state, over);
    }
    if (this._animate && over && this._previous === 'playing') {
      const won = state.results.reason === 'all' && (state.round_scores || []).length;
      this._cue(won ? 'win' : 'end');
    }
    this._paintFeed(state);
    this._paintLists(state);
    if (paused) {
      this._paintPause(state);
    } else if (waiting) {
      if (!wasWaiting) this._paintTitle();
    } else {
      $('round').textContent = state.round;
      $('status').textContent = over ? REASONS[state.results.reason] || REASONS.skip : '';
      $('found').textContent = state.found;
      $('total').textContent = state.total;
      $('meter').style.width = (state.total ? 100 * state.found / state.total : 0) + '%';
      this._paintWords(state);
    }
    this._paintClock();
    this._playCues();
    this._previous = state.state;
    this._animate = !this.still;
  }

  tick() {
    if (this.still) return;
    this._paintClock();
    this._playCues();
  }

  _paintClock() {
    const state = this.state;
    if (!state || state.state === 'paused' || $('stage').hidden) return;
    const now = this.still ? state.now : Date.now() / 1000 + this.offset;
    if (state.state === 'countdown') {
      this._paintCountdown(Math.max(0, state.starts_at - now));
      return;
    }
    if (!state.words) return;
    let label = '', progress = 0, shown = false;
    if (state.state === 'results') {
      const left = Math.max(0, state.results.next_at - now);
      shown = true;
      label = 'следующий текст через ' + clockText(left);
      progress = left / Math.max(1, state.pause);
    }
    this._paintBars(state, now);
    $('timeline').style.visibility = shown ? 'visible' : 'hidden';
    $('label').textContent = label;
    $('fill').style.setProperty('--p', Math.max(0, Math.min(1, progress)).toFixed(3));
    const clock = $('clock');
    clock.hidden = !(state.state === 'playing' && state.ends);
    if (!clock.hidden) clock.textContent = clockText(state.ends - now);
  }

  _paintBars(state, now) {
    (state.lines || []).forEach((line, i) => {
      const bar = this._bars[i];
      if (!bar) return;
      bar.style.visibility = line.hint_at ? 'visible' : 'hidden';
      if (!line.hint_at) return;
      const left = Math.max(0, line.hint_at - now);
      bar.firstChild.style.setProperty('--p', Math.min(1, left / Math.max(1, state.hint_every)).toFixed(3));
    });
  }

  _fitStage() {
    const width = document.body.classList.contains('mini') ? MINI_WIDTH : STAGE_WIDTH;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / STAGE_HEIGHT);
    $('stage').style.setProperty('--k', scale);
  }

  _cue(name) {
    this._cues.push(name);
  }

  _playCues() {
    const name = SOUND_PRIORITY.find((sound) => this._cues.includes(sound));
    this._cues = [];
    if (!name || this.still || !this.settings.sound) return;
    this.heard.push(name);
    if (this.heard.length > 50) this.heard.shift();
    play(name, this.settings.volume);
  }

  _setStars(stars) {
    const key = JSON.stringify(stars || []);
    if (key === this._starsKey) return;
    this._starsKey = key;
    this._stars = new Map(stars || []);
    this._listKeys = {};
    this._feedStale = true;
  }

  _starOf(name) {
    return this._stars.get(String(name || '').toLowerCase()) || '';
  }

  _redrawFeed() {
    this._feedStale = true;
    if (this.state) this._paintFeed(this.state);
  }

  _startRound(state, over) {
    const phrase = $('phrase');
    phrase.textContent = '';
    this._wordKeys = state.words.map(() => '');
    this._words = state.words.map((word) => {
      const node = el('div', 'word');
      for (let i = 0; i < word.len; i++) {
        const cell = el('span');
        cell.style.setProperty('--j', i);
        node.append(cell);
      }
      return node;
    });
    this._fitPhrase(state);
    if (!this._animate || over) return;
    this._cue('start');
    const play = $('play');
    play.classList.remove('enter');
    void play.offsetWidth;
    play.classList.add('enter');
  }

  _fitPhrase(state) {
    const phrase = $('phrase'), sentences = [];
    for (const word of state.words) {
      if (!sentences[word.line]) sentences[word.line] = [];
      sentences[word.line].push(word.len);
    }
    const fit = phraseLayout(sentences, phrase.clientWidth || FIELD.width, phrase.clientHeight || FIELD.height);
    phrase.style.setProperty('--cell', fit.cell + 'px');
    phrase.textContent = '';
    this._bars = fit.blocks.map((rows) => {
      const sentence = el('div', 'sentence');
      for (const indices of rows) {
        const row = el('div', 'line');
        for (const i of indices) row.append(this._words[i]);
        sentence.append(row);
      }
      const bar = el('div', 'bar');
      bar.append(el('i'));
      sentence.append(bar);
      phrase.append(sentence);
      return bar;
    });
  }

  _paintWords(state) {
    const over = state.state === 'results';
    let lettered = false, opened = false;
    state.words.forEach((word, i) => {
      const kind = word.missed ? 'missed' : word.how === 'guess' ? 'open' : word.how ? 'shown' : over ? 'missed' : '';
      const key = kind + '|' + word.shown;
      if (key === this._wordKeys[i]) return;
      const wasShut = !this._wordKeys[i] || this._wordKeys[i].charAt(0) === '|';
      this._wordKeys[i] = key;
      const cells = this._words[i].children;
      for (let j = 0; j < cells.length; j++) {
        const letter = word.shown.charAt(j).trim();
        const fresh = this._animate && !kind && letter && !cells[j].textContent;
        cells[j].textContent = letter;
        cells[j].className = fresh ? 'lit' : '';
        if (fresh) lettered = true;
      }
      const revealed = this._animate && kind && kind !== 'missed' && wasShut;
      if (revealed && kind === 'open') {
        opened = true;
        this._cue(word.len >= LONG_WORD ? 'long' : 'guess');
      }
      if (revealed && kind === 'shown') lettered = true;
      this._words[i].className = 'word' + (kind ? ' ' + kind : '') + (revealed ? ' pop' : '');
    });
    if (lettered && !opened) this._cue('hint');
  }

  _sideCapacity(boxes) {
    const height = $('side').clientHeight || SIDE.height;
    const rules = $('box-rules').offsetHeight || SIDE.rules;
    return Math.max(2, Math.floor((height - rules - boxes * (SIDE.gap + SIDE.frame)) / SIDE.row));
  }

  _paintList(id, rows, limit, total, points, emptyText) {
    const key = JSON.stringify([rows.slice(0, limit).map((row) => [row.name, points(row)]), limit, total, emptyText]);
    if (this._listKeys[id] === key) return;
    this._listKeys[id] = key;
    const list = $(id);
    list.textContent = '';
    if (!rows.length) {
      list.append(el('li', 'note', emptyText));
      return;
    }
    const cut = total > limit;
    const shown = rows.slice(0, cut ? limit - 1 : limit);
    shown.forEach((row, i) => {
      const star = this._starOf(row.name);
      const name = el('span', star ? 'name ' + star : 'name', row.name);
      const item = el('li', i === 0 ? 'first' : '');
      item.append(el('span', 'place', i + 1), name, el('span', 'points', points(row)));
      list.append(item);
    });
    if (cut) {
      const rest = total - shown.length;
      list.append(el('li', 'note', 'и ещё ' + rest + ' ' + plural(rest, 'игрок', 'игрока', 'игроков')));
    }
  }

  _boardRows() {
    return Math.max(2, Math.floor((($('board-total').clientHeight || BOARD.height) - BOARD.frame) / BOARD.row));
  }

  _paintPause(state) {
    const round = state.round_scores || [], top = state.top || [], rows = this._boardRows();
    const nobody = !state.words ? 'раунд ещё не начался' : state.results ? 'никто не угадал' : 'пока никто не угадал';
    $('h-pause-round').textContent = state.results ? 'Итоги раунда' : 'В этом раунде';
    this._paintList('pause-round', round, rows, round.length, (row) => '+' + row.pts, nobody);
    this._paintList('pause-total', top, rows, state.players || 0, (row) => row.score, 'пока пусто');
  }

  _paintLists(state) {
    const waiting = !state.words, over = Boolean(state.results);
    const round = state.round_scores || [], top = state.top || [], players = state.players || 0;
    $('box-round').hidden = waiting;
    if (waiting) {
      this._paintList('list-total', top, this._sideCapacity(1), players, (row) => row.score, 'пока пусто');
      return;
    }
    const rows = sideRows(round.length, players, this._sideCapacity(2));
    $('h-round').textContent = over ? 'Итоги раунда' : 'В этом раунде';
    this._paintList('list-round', round, rows.round, round.length, (row) => '+' + row.pts,
      over ? 'никто не угадал' : 'пока никто не угадал');
    this._paintList('list-total', top, rows.total, players, (row) => row.score, 'пока пусто');
  }

  _paintRules() {
    const settings = this.settings;
    const rules = [
      'Угадывай слова текста, пиши в чат',
      'Одно слово — одно сообщение',
      'Буквы слова открываются в его строке',
      'Первому — очко за слово, Ё = Е',
    ];
    if (settings.hint_every) rules.push('Подсказка в строке — раз в ' + settings.hint_every + ' с');
    const list = $('rules');
    list.textContent = '';
    for (const rule of rules) list.append(el('li', '', rule));
  }

  _fillText(box, message) {
    const own = message.emotes || null;
    if (message.pts || message.repeat || (!own && !this.emotes.size)) {
      box.textContent = message.text;
      return;
    }
    let plain = '';
    message.text.split(' ').forEach((word, i) => {
      const url = word ? this.emotes.url(word, own) : '';
      if (!url) {
        plain += (i ? ' ' : '') + word;
        return;
      }
      if (plain || i) box.append(plain + (i ? ' ' : ''));
      plain = '';
      const image = el('img');
      image.alt = word;
      image.onerror = () => image.replaceWith(word);
      image.src = url;
      box.append(image);
    });
    if (plain) box.append(plain);
  }

  _messageRow(message, fresh) {
    const star = message.star || '';
    const marks = (message.pts ? ' hit' : '') + (fresh ? ' pop' : '');
    const row = el('div', 'msg' + marks);
    const nick = el('b', star, message.user);
    if (!star) nick.style.color = nickColor(message);
    const text = el('span', 'text');
    this._fillText(text, message);
    row.append(nick, ' ', text);
    if (message.pts) row.append(' ', el('i', 'points', '+' + message.pts));
    if (message.repeat) row.append(' ', el('i', 'mark', 'уже открыто'));
    return row;
  }

  _paintFeed(state) {
    const feed = state.feed || [], box = $('chat');
    if (this._feedStale) {
      this._feedStale = false;
      this._feedRows.clear();
      box.textContent = '';
    }
    const newest = feed.length ? feed[feed.length - 1].id : 0;
    if (newest < this._feedNewest) this._feedNewest = 0;
    const ids = new Set(feed.map((message) => message.id));
    this._feedRows.forEach((row, id) => {
      if (ids.has(id)) return;
      row.remove();
      this._feedRows.delete(id);
    });
    const note = box.querySelector('.note');
    if (feed.length && note) note.remove();
    if (!feed.length && !note) box.append(el('div', 'msg note', 'пока тихо'));
    for (const message of feed) {
      if (this._feedRows.has(message.id)) continue;
      const fresh = this._animate && message.id > this._feedNewest;
      const row = this._messageRow(message, fresh);
      this._feedRows.set(message.id, row);
      box.append(row);
    }
    this._feedNewest = Math.max(this._feedNewest, newest);
  }

  _tileSize(count, largest) {
    const room = ($('main').clientWidth || FIELD.width) - TILE_GAP * (count - 1);
    return Math.max(24, Math.min(largest, Math.floor(room / count)));
  }

  _paintTitle() {
    const box = $('lobby-tiles');
    box.textContent = '';
    box.style.setProperty('--tile', this._tileSize(TITLE.length, TILE) + 'px');
    Array.from(TITLE).forEach((letter, i) => {
      const tile = el('div', 'tile', letter);
      tile.style.setProperty('--i', i);
      if (!this._animate) tile.style.animation = 'none';
      box.append(tile);
    });
    this._secondsLeft = null;
    this._countdownFrom = null;
  }

  _paintCountdown(left) {
    const seconds = Math.ceil(left), ring = $('countdown'), number = $('countdown-number');
    if (this._countdownFrom === null) this._countdownFrom = Math.max(1, left);
    ring.style.setProperty('--p', Math.max(0, Math.min(1, left / this._countdownFrom)).toFixed(3));
    if (seconds === this._secondsLeft) return;
    this._secondsLeft = seconds;
    number.textContent = Math.max(1, seconds);
    ring.classList.toggle('final', seconds <= FINAL_SECONDS);
    number.classList.remove('beat');
    void number.offsetWidth;
    number.classList.add('beat');
    if (seconds <= FINAL_SECONDS && seconds > 0 && this._animate) this._cue('tick');
  }
}
