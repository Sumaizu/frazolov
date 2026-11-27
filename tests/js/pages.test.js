import { SOUNDS, measure } from '../../site/js/sound.js';
import { phraseLayout, sideRows } from '../../site/js/view.js';
import { eq, no, ok, test } from './harness.js';

const SITE = '/site/';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, note = 'условие', ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    let value = null;
    try {
      value = check();
    } catch (error) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error('не дождались: ' + note);
    await wait(30);
  }
}

async function open(path, ready) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;border:0;background:#333';
  frame.src = SITE + path;
  document.body.append(frame);
  await until(() => ready(frame.contentWindow), 'страница ' + path + ' не поднялась');
  return frame;
}

const element = (w, id) => w.document.getElementById(id);
const all = (w, selector) => Array.from(w.document.querySelectorAll(selector));
const box = (node) => {
  const rect = node.getBoundingClientRect();
  return [Math.round(rect.left), Math.round(rect.right)];
};
const camAt = (w) => {
  const stage = w.document.getElementById('stage').getBoundingClientRect();
  const cam = w.document.querySelector('.cam').getBoundingClientRect();
  return [cam.left - stage.left, cam.top - stage.top, cam.width, cam.height].map(Math.round);
};
const cellsOf = (node) => Array.from(node.children, (cell) => cell.textContent || ' ').join('');

function forget() {
  for (const key of Object.keys(localStorage)) if (key.startsWith('frazolov')) localStorage.removeItem(key);
}

const overlay = (query = '') => open('overlay.html' + (query ? '?' + query : ''), (w) => w.frazolov && w.frazolov.game);
const embedded = (query = '') => open('overlay.html?embed=1' + (query ? '&' + query : ''),
  (w) => w.frazolov && w.frazolov.game);

async function playing(query = '', phrase = '') {
  const frame = await overlay(query);
  const w = frame.contentWindow, game = w.frazolov.game;
  if (phrase) game.phrases = { next: () => phrase.split('|') };
  await until(() => !element(w, 'lobby').hidden, 'отсчёт на экране');
  game.tick(game.startsAt);
  await until(() => all(w, '#phrase .word').length && element(w, 'lobby').hidden, 'раунд на экране');
  return { frame, w, game, chat: w.frazolov.chat, view: w.frazolov.view };
}

function showSource(w, visible) {
  w.dispatchEvent(new w.CustomEvent('obsSourceVisibleChanged', { detail: { visible } }));
}

function fakeSockets(chat) {
  const sockets = [];
  chat.Socket = class {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }

    send(line) {
      this.sent.push(line);
    }

    close() {
      this.closed = true;
    }
  };
  return sockets;
}

function inside(inner, outer, note) {
  const a = inner.getBoundingClientRect(), b = outer.getBoundingClientRect();
  ok(a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5,
    note + ': ' + [a.left, a.right, a.top, a.bottom].map(Math.round) + ' вне ' +
    [b.left, b.right, b.top, b.bottom].map(Math.round));
}

test('раскладка текста: каждое предложение с новой строки, клетка — самая крупная', () => {
  const lengths = (sentence) => sentence.split(' ').map((word) => word.length);
  const text = ['утром кот проснулся рано', 'он тихо пошёл на кухню', 'там стояла миска с молоком',
    'кот выпил всё до капли', 'потом он снова лёг спать'].map(lengths);
  const full = phraseLayout(text, 720, 560);
  eq(full.blocks.length, 5);
  ok(full.blocks.every((rows) => rows.length === 1), 'в полном оверлее предложение — одной строкой');
  eq(full.blocks.flat(2), Array.from({ length: 24 }, (_, i) => i));
  ok(full.cell >= 24, full.cell);
  const mini = phraseLayout(text, 402, 600);
  eq(mini.blocks.flat(2), full.blocks.flat(2));
  ok(mini.blocks.some((rows) => rows.length > 1), 'в узком переносится');
  eq(phraseLayout([[3, 4]], 720, 560).cell, 52);
});

test('счёт: занимает всё место, при переполнении — десятка общего счёта и итоги раунда', () => {
  eq(sideRows(3, 5, 16), { round: 3, total: 13 });
  eq(sideRows(0, 0, 16), { round: 1, total: 15 });
  eq(sideRows(12, 30, 16), { round: 6, total: 10 });
  eq(sideRows(40, 40, 16), { round: 6, total: 10 });
});

test('звуки: каждый не пуст, не перегружен и не тянется', async () => {
  eq(SOUNDS.slice().sort(), ['end', 'guess', 'hint', 'long', 'start', 'tick', 'win']);
  for (const name of SOUNDS) {
    const loud = await measure(name, 100), quiet = await measure(name, 30);
    ok(loud.peak > 0.08 && loud.peak < 0.98, name + ': пик ' + loud.peak.toFixed(3));
    ok(loud.seconds > 0.05 && loud.seconds < 3.6, name + ': длится ' + loud.seconds.toFixed(2) + ' с');
    ok(quiet.peak < loud.peak * 0.7, name + ': громкость не слушается настройки');
  }
  ok((await measure('guess', 0)).peak < 0.001);
});

test('оверлей: открылся — отсчёт десять секунд, потом раунд', async () => {
  forget();
  const frame = await overlay();
  const w = frame.contentWindow, game = w.frazolov.game;
  eq(game.state, 'countdown');
  ok(Math.abs(game.startsAt - game.clock() - 10) < 1.5);
  await until(() => !element(w, 'stage').hidden && !element(w, 'lobby').hidden, 'отсчёт на экране');
  ok(['10', '9'].includes(element(w, 'countdown-number').textContent));
  ok(element(w, 'play').hidden);
  eq(all(w, '#lobby-tiles .tile').map((tile) => tile.textContent).join(''), 'ФРАЗОЛОВ');
  eq(w.frazolov.chat.status.state, 'off');
  game.tick(game.startsAt);
  await until(() => element(w, 'lobby').hidden && all(w, '#phrase .word').length, 'раунд на экране');
  const state = game.snapshot();
  eq([state.state, all(w, '#phrase .word').length, all(w, '#phrase .sentence').length], ['playing', state.total, 5]);
  eq(all(w, '#abc').length, 0, 'алфавита нет');
  eq(all(w, '#phrase .bar').filter((bar) => bar.style.visibility === 'visible').length, 5);
  eq(all(w, '#phrase .word').map(cellsOf), state.words.map((word) => word.shown));
  ok(element(w, 'play').classList.contains('enter'));
  eq(w.frazolov.view.heard, ['start']);
  frame.remove();
});

test('оверлей: слово из чата открывается, его буквы — во всей фразе, команды слушаются модератора', async () => {
  forget();
  const { frame, w, game, chat, view } = await playing('', 'кот ест торт');
  game.round.lines[0].known = new Set();
  game._bump();
  await until(() => all(w, '#phrase .word').map(cellsOf).join('').trim() === '', 'буквы погасли');
  chat.onMessage('Вася', 'кот', false, { msgId: 'm1', login: 'vasya', color: '#FF69B4' });
  chat.onMessage('Петя', 'всем привет', false, { msgId: 'm2', login: 'petya', color: '' });
  await until(() => all(w, '#phrase .word.open').length === 1, 'слово открылось');
  eq(all(w, '#phrase .word').map(cellsOf), ['кот', '  т', 'то т']);
  ok(all(w, '#phrase .word')[2].querySelector('span.lit'), 'новые буквы подсвечены');
  ok(all(w, '#phrase .word.open')[0].classList.contains('pop'));
  await until(() => view.heard.includes('guess'), 'звук угаданного слова');
  const text = () => element(w, 'chat').innerText;
  ok(text().includes('Вася') && text().includes('+1'), text());
  ok(element(w, 'list-total').innerText.includes('Вася') && element(w, 'list-round').innerText.includes('Вася'));
  chat.onMessage('Оля', 'кот', false, {});
  await until(() => text().includes('уже открыто'), 'пометка в чате');
  chat.onClear({ msgId: 'm2' });
  await until(() => !text().includes('всем привет'), 'сообщение убрано');
  chat.onMessage('Петя', '!фразолов-раунд', false, {});
  eq(game.state, 'playing');
  chat.onMessage('Модер', '!фразолов-раунд', true, {});
  await until(() => element(w, 'card').classList.contains('results'), 'итоги раунда');
  eq(element(w, 'status').textContent, 'Раунд окончен');
  eq(all(w, '#phrase .word.missed').map(cellsOf), ['ест', 'торт']);
  ok(element(w, 'label').textContent.startsWith('следующий текст через'));
  chat.onMessage('Модер', '!фразолов-сброс', true, {});
  await until(() => element(w, 'list-total').innerText.includes('пока пусто'), 'счёт сброшен');
  frame.remove();
});

test('оверлей: фраза открыта целиком — «Фраза открыта!» и звук победы', async () => {
  forget();
  const { frame, w, game, chat, view } = await playing('', 'мы идём домой');
  game.round.lines[0].known = new Set(['м', 'ы']);
  game.round.words[0].how = 'given';
  game._bump();
  chat.onMessage('Вася', 'идём', false, {});
  chat.onMessage('Петя', 'домой', false, {});
  await until(() => element(w, 'card').classList.contains('results'), 'итоги');
  eq(element(w, 'status').textContent, 'Текст открыт!');
  await until(() => view.heard.includes('win'), 'звук победы');
  frame.remove();
});

test('оверлей: на паузе вместо игры — счёт раунда слева и общий счёт справа', async () => {
  forget();
  const { frame, w, game, chat } = await playing('hint_every=0', 'кот ест торт');
  chat.onMessage('Вася', 'торт', false, {});
  await until(() => all(w, '#phrase .word.open').length === 1, 'слово открыто');
  const field = box(element(w, 'main'));
  game.pause();
  await until(() => !element(w, 'pause').hidden, 'экран паузы');
  eq([element(w, 'head').hidden, element(w, 'play').hidden, element(w, 'lobby').hidden], [true, true, true]);
  eq(element(w, 'pause-round').innerText.replace(/\s+/g, ' ').trim(), '1 Вася +1');
  const main = box(element(w, 'main')), left = box(element(w, 'board-round')), right = box(element(w, 'board-total'));
  ok(main[0] <= left[0] && left[1] < right[0] && right[1] <= main[1], [main, left, right].join(' | '));
  eq(w.getComputedStyle(element(w, 'side')).display, 'none');
  chat.onMessage('Оля', 'кот', false, {});
  await until(() => element(w, 'chat').innerText.includes('Оля'), 'сообщение в чате');
  eq(game.snapshot().words.filter((word) => word.how === 'guess').length, 1);
  game.resume();
  await until(() => element(w, 'pause').hidden && !element(w, 'play').hidden, 'игра вернулась');
  eq(box(element(w, 'main')), field);
  frame.remove();
  forget();
});

test('оверлей: источник скрыли — игра остановилась, показали — отсчёт и новая фраза', async () => {
  forget();
  const { frame, w, game } = await playing();
  const first = game.answers().text[0];
  showSource(w, false);
  eq(game.state, 'stopped');
  await until(() => element(w, 'stage').hidden, 'оверлей пуст');
  showSource(w, true);
  eq(game.state, 'countdown');
  game.tick(game.startsAt);
  ok(game.answers().text[0] !== first);
  frame.remove();
});

test('оверлей: окошко под вебку на общем месте, минималистичный оверлей — вертикальный и без фона', async () => {
  forget();
  const full = await playing();
  eq([box(element(full.w, 'card')), box(element(full.w, 'main'))], [[0, 1280], [318, 1038]]);
  eq(camAt(full.w), [18, 494, 280, 210], 'окошко под вебку — там же, где в других играх');
  full.frame.remove();
  const vtuber = await playing('webcam=vtuber');
  eq(camAt(vtuber.w), [18, 344, 280, 360], 'окошко витубера — там же, где в других играх');
  eq(box(element(vtuber.w, 'main'))[1], 1038, 'правый край поля на месте');
  vtuber.frame.remove();
  const mini = await playing('mini=1');
  ok(mini.w.document.body.classList.contains('mini'));
  const stage = box(element(mini.w, 'stage')), field = box(element(mini.w, 'main'));
  ok(Math.abs(stage[1] - stage[0] - 1280 / 3) <= 1 && field[0] - stage[0] === 12 && stage[1] - field[1] === 12,
    'вертикальная сцена 640×1080: ' + [stage, field]);
  for (const node of [mini.w.document.querySelector('.chatbox'), element(mini.w, 'side'),
    mini.w.document.querySelector('.cam'), element(mini.w, 'timeline')]) {
    eq(mini.w.getComputedStyle(node).display, 'none');
  }
  eq(mini.w.getComputedStyle(element(mini.w, 'card')).backgroundImage, 'none');
  eq(all(mini.w, '#brand-tiles .tile').length, 8, 'название — плашками');
  ok(mini.w.document.querySelector('.head .logo').naturalWidth > 0, 'логотип сайта рядом с названием');
  mini.frame.remove();
  const nocam = await playing('webcam=none');
  eq(nocam.w.getComputedStyle(nocam.w.document.querySelector('.cam')).display, 'none');
  nocam.frame.remove();
});

test('оверлей: самый длинный текст помещается в поле и в полном, и в минималистичном оверлее', async () => {
  forget();
  const { TEXTS } = await import('../../site/js/phrases.js');
  const size = (text) => text.join('').length;
  const longest = TEXTS.slice().sort((a, b) => size(b) - size(a))[0].join('|');
  for (const query of ['', 'mini=1', 'webcam=vtuber']) {
    const { frame, w } = await playing(query, longest);
    const words = all(w, '#phrase .word');
    for (const word of words) inside(word, element(w, 'phrase'), query || 'полный');
    const cell = words[0].firstElementChild.getBoundingClientRect().width;
    ok(cell >= (query === 'mini=1' ? 16 : 22), 'клетка ' + cell);
    frame.remove();
  }
});

test('оверлей: у особых ников свой цвет — в чате и в счёте', async () => {
  forget();
  const { frame, w, game, chat } = await playing('', 'кот ест торт');
  chat.onMessage('Sumaizu', 'кот', false, { login: 'sumaizu' });
  chat.onMessage('FRA3A', 'привет', false, { login: 'fra3a' });
  await until(() => all(w, '#chat .msg').length === 2, 'сообщения в чате');
  eq(all(w, '#chat .msg b').map((nick) => nick.className), ['rainbow', 'thyme']);
  await until(() => w.document.querySelector('#list-total .name.rainbow'), 'радуга в счёте');
  eq(game.snapshot().feed[0].star, 'rainbow');
  frame.remove();
});

test('встроенный оверлей: пока игру не начали — неподвижный пример', async () => {
  forget();
  const frame = await embedded('hint_every=15');
  const w = frame.contentWindow, api = w.frazolov;
  eq([api.game.state, api.chat.status.state], ['stopped', 'off']);
  const chat = element(w, 'chat').innerText;
  ok(chat.includes('уже открыто') && chat.includes('+1'), chat);
  ok(element(w, 'rules').innerText.includes('очко за слово'));
  ok(all(w, '#list-round li').length >= 3 && all(w, '#list-total li').length >= 10);
  ok(element(w, 'rules').innerText.includes('раз в 15 с'));
  eq(all(w, '#phrase .sentence').length, 5);
  eq(all(w, '#phrase .word.open').map(cellsOf), ['утром', 'кот', 'тихо', 'миска', 'кот']);
  const label = element(w, 'label').textContent;
  await wait(600);
  eq(element(w, 'label').textContent, label);
  eq(api.view.heard, []);
  api.apply({ mini: true, hint_every: 0 });
  ok(w.document.body.classList.contains('mini'));
  no(element(w, 'rules').innerText.includes('Подсказка'));
  showSource(w, true);
  eq(api.game.state, 'stopped');
  frame.remove();
});

test('встроенный оверлей: «начать» — настоящая игра, настройки меняются на ходу, «остановить» — пример', async () => {
  forget();
  const frame = await embedded();
  const w = frame.contentWindow, api = w.frazolov;
  const sockets = fakeSockets(api.chat);
  api.apply({ channel: 'some_channel' });
  eq(sockets.length, 0);
  api.start();
  eq([api.game.state, sockets.length], ['countdown', 1]);
  await until(() => !element(w, 'lobby').hidden, 'отсчёт на экране');
  api.game.tick(api.game.startsAt);
  await until(() => element(w, 'lobby').hidden && all(w, '#phrase .word').length, 'раунд на экране');
  api.apply({ channel: 'some_channel', mini: true, hint_every: 77 });
  eq([api.game.state, api.game.s.hint_every, api.game.snapshot().round], ['playing', 77, 1]);
  await until(() => w.document.body.classList.contains('mini'), 'минималистичный оверлей на ходу');
  inside(all(w, '#phrase .word').pop(), element(w, 'phrase'), 'фраза разложена заново');
  showSource(w, false);
  eq(api.game.state, 'playing');
  api.stop();
  eq([api.game.state, api.chat.status.state, sockets[0].closed], ['stopped', 'off', true]);
  await until(() => element(w, 'chat').innerText.includes('уже открыто'), 'снова пример');
  frame.remove();
  forget();
});

const gameOf = (w) => element(w, 'game').contentWindow;
const mainPage = (query = '') => open('index.html' + query,
  (w) => gameOf(w).frazolov && gameOf(w).frazolov.game && !element(w, 'play').disabled);
const link = (w) => element(w, 'link').value;
const query = (w) => (link(w).split('?')[1] || '');

function type(w, id, value) {
  const field = element(w, id);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('страница: при первом заходе — пример, рекомендуемые настройки и готовая ссылка для OBS', async () => {
  forget();
  const frame = await mainPage();
  const w = frame.contentWindow, game = gameOf(w);
  ok(link(w).endsWith('/site/overlay.html'), link(w));
  ok(element(w, 'link-status').textContent.includes('канал'));
  eq(element(w, 'status').textContent, '');
  ok(element(w, 'link-panel').hidden && element(w, 'settings').hidden);
  no(element(w, 'example-note').hidden);
  eq([game.frazolov.game.state, all(game, '#phrase .sentence').length], ['stopped', 5]);
  ok(w.document.querySelector('.foot .alpha').textContent.includes('Альфа'));
  eq(['pause', 'hint_every', 'round_time', 'volume'].map((key) => element(w, 's-' + key).value),
    ['20', '20', '0', '100']);
  ok(element(w, 's-sound').checked && element(w, 's-chat_commands').checked && !element(w, 's-mini').checked);
  eq(['pause', 'hint', 'skip', 'reset'].map((id) => element(w, id).disabled), [true, true, true, true]);
  const author = w.document.querySelector('.author a');
  eq([author.textContent, author.getAttribute('href')], ['Sumaizu', 'https://twitch.tv/sumaizu']);
  const home = w.document.querySelector('.top .logo');
  eq(home.getAttribute('href'), 'https://gamesonstream.ru/');
  ok(home.querySelector('img').naturalWidth > 0, 'логотип загрузился');
  const commands = all(w, '.check code').map((node) => node.textContent);
  eq(commands, ['!фразолов-раунд', '!фразолов-пауза', '!фразолов-сброс']);
  frame.remove();
  forget();
});

test('страница: логотип и кнопки — одной полосой по центру, игра на всю страницу', async () => {
  forget();
  const frame = await mainPage();
  const w = frame.contentWindow;
  const place = (node) => node.getBoundingClientRect();
  const strip = w.document.querySelector('.top');
  const parts = [w.document.querySelector('.top .logo'), element(w, 's-channel'), element(w, 'play'),
    element(w, 'pause'), element(w, 'hint'), element(w, 'skip'), element(w, 'reset'), element(w, 'toggle-settings'),
    element(w, 'toggle-link')];
  const title = place(parts[0]);
  parts.forEach((node, i) => {
    ok(place(node).top < title.bottom && place(node).bottom > title.top, 'не в строке — ' + i);
  });
  const left = place(strip).left, right = w.innerWidth - place(strip).right;
  ok(Math.abs(left - right) <= 2, 'не по центру — ' + left + ' и ' + right);
  const screen = place(element(w, 'game'));
  ok(screen.top < title.bottom + 30 && screen.bottom > w.innerHeight - 60, [screen.top, screen.bottom]);
  ok(Math.abs(screen.width / screen.height - 16 / 9) < 0.02);
  eq([w.document.documentElement.scrollHeight, w.document.documentElement.scrollWidth], [w.innerHeight, w.innerWidth]);
  frame.remove();
  forget();
});

test('страница: «Начать» запускает игру, кнопки управляют раундом, «Остановить» возвращает пример', async () => {
  forget();
  const frame = await mainPage();
  const w = frame.contentWindow, game = gameOf(w), api = game.frazolov;
  const sockets = fakeSockets(api.chat);
  element(w, 'play').click();
  eq([api.game.state, sockets.length], ['stopped', 0]);
  ok(element(w, 'status').textContent.includes('канал'));
  element(w, 's-channel').value = 'https://twitch.tv/Some_One';
  element(w, 'play').click();
  eq([element(w, 's-channel').value, query(w), api.game.state, sockets.length],
    ['some_one', 'channel=some_one', 'countdown', 1]);
  eq(element(w, 'play').textContent, 'Остановить');
  api.game.phrases = { next: () => ['вчера любопытный сосед', 'тайком спрятал ключ', 'под старым диваном'] };
  api.game.tick(api.game.startsAt);
  await until(() => all(game, '#phrase .word').length && element(game, 'lobby').hidden, 'раунд в рамке');
  await until(() => !element(w, 'hint').disabled, 'кнопки ожили');
  const lit = () => api.game.round.lines.reduce((sum, line) => sum + line.known.size, 0);
  const before = lit();
  element(w, 'hint').click();
  eq(lit(), before + 1);
  element(w, 'pause').click();
  eq(api.game.state, 'paused');
  await until(() => element(w, 'pause').textContent === 'Продолжить' && element(w, 'hint').disabled, 'пауза');
  element(w, 'pause').click();
  eq(api.game.state, 'playing');
  api.chat.onMessage('Вася', 'ключ', false, {});
  element(w, 'reset').click();
  eq([api.game.snapshot().players, element(w, 'reset').textContent], [1, 'Точно?']);
  element(w, 'reset').click();
  eq(api.game.snapshot().players, 0);
  element(w, 'skip').click();
  eq([api.game.state, api.game.snapshot().results.reason], ['results', 'skip']);
  element(w, 'skip').click();
  eq([api.game.state, api.game.snapshot().round], ['playing', 2]);
  element(w, 'play').click();
  eq([api.game.state, element(w, 'play').textContent, sockets[0].closed], ['stopped', 'Начать', true]);
  await until(() => element(game, 'chat').innerText.includes('уже открыто'), 'снова пример');
  frame.remove();
  forget();
});

test('страница: настройки действуют сразу и запоминаются, адрес страницы важнее запомненного', async () => {
  forget();
  let frame = await mainPage();
  let w = frame.contentWindow;
  element(w, 'toggle-settings').click();
  type(w, 's-hint_every', '45');
  type(w, 's-mini', true);
  ok(query(w).includes('hint_every=45') && query(w).includes('mini=1'), query(w));
  await until(() => gameOf(w).frazolov.game.s.hint_every === 45, 'игра получила настройки');
  ok(element(w, 'webcam-field').hidden && element(w, 'game').parentNode.classList.contains('mini'));
  frame.remove();
  frame = await mainPage();
  w = frame.contentWindow;
  eq([element(w, 's-hint_every').value, element(w, 's-mini').checked], ['45', true]);
  element(w, 'defaults').click();
  eq([element(w, 's-hint_every').value, element(w, 's-mini').checked, query(w)], ['20', false, '']);
  frame.remove();
  frame = await mainPage('?pause=9');
  eq(frame.contentWindow.document.getElementById('s-pause').value, '9');
  frame.remove();
  forget();
});
