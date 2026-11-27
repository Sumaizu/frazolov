import { clean } from '../../site/js/config.js';
import { BOTS, CHAT_KEEP, CHAT_SHOWN, CHAT_TEXT_MAX, Game, STARS, Scores, nextReset } from '../../site/js/engine.js';
import { Phrases, TEXTS, masked } from '../../site/js/phrases.js';
import { fakeClock, hintAt, known, local, makeGame, memoryStorage, seeded, shown, startRound } from './fixtures.js';
import { eq, no, ok, test } from './harness.js';

const types = (events) => events.map((event) => event.type);
const last = (list) => list[list.length - 1];
const sorted = (list) => Array.from(list).sort();

function blank(game) {
  for (const line of game.round.lines) {
    line.known = new Set();
    for (const word of line.words) {
      if (word.how === 'given') for (const letter of word.key) line.known.add(letter);
      else word.how = null;
    }
  }
  return game;
}

const fresh = (options = {}) => {
  const made = startRound(options);
  blank(made.game);
  return made;
};

test('запуск: отсчёт, потом раунд', () => {
  const { game, clock, events } = makeGame();
  eq(game.state, 'stopped');
  ok(game.open(10));
  no(game.open(10), 'второй раз не открывается');
  eq([game.state, game.snapshot().starts_at], ['countdown', clock.t + 10]);
  clock.t += 9.9;
  game.tick();
  eq(game.state, 'countdown');
  clock.t += 0.1;
  game.tick();
  const state = game.snapshot();
  eq([state.state, state.round, state.total, state.words.map((word) => word.len)], ['playing', 1, 4, [3, 4, 4, 5]]);
  eq(types(events), ['countdown', 'round_start']);
  eq(game.answers().text, ['кот съел рыбу вчера']);
});

test('запуск: остановка стирает раунд, новый запуск начинает со следующего текста', () => {
  const { game } = startRound({ phrases: ['кот съел рыбу', 'мама мыла раму'] });
  game.stop();
  eq([game.state, game.snapshot().words], ['stopped', undefined]);
  game.open(0);
  game.tick();
  eq(game.answers().text, ['мама мыла раму']);
});

test('раунд: слова скрыты, сразу видны буквы — хотя бы два места в тексте', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { game } = startRound({ seed, phrases: ['кот съел рыбу вчера'] });
    const state = game.snapshot(), lit = known(game);
    const letters = Array.from('котсъелрыбувчера');
    ok(letters.filter((letter) => lit.includes(letter)).length >= 2, 'зерно ' + seed);
    ok(lit.length <= 2, 'зерно ' + seed);
    ok(state.words.every((word) => word.word === null && !word.how), 'зерно ' + seed);
    ok(state.words.some((word) => word.shown.trim()), 'хоть одна буква видна, зерно ' + seed);
    eq(state.words.map((word) => word.shown), game.answers().words.map((word) => masked(word.word, new Set(lit))));
  }
});

test('раунд: слова из одной-двух букв открыты сразу, их буквы — в строке', () => {
  const { game } = startRound({ phrases: ['не трогай мокрую кружку'] });
  const state = game.snapshot();
  eq(state.words[0], { line: 0, len: 2, word: 'не', shown: 'не', by: null, how: 'given', missed: false });
  ok(known(game).includes('н') && known(game).includes('е'));
  eq(state.found, 1);
  no(state.words.slice(1).some((word) => word.how));
});

test('раунд: угаданное слово открывается и приносит очко, его буквы — в строке', () => {
  const { game, events } = fresh({ phrases: ['кот ест торт'] });
  eq(shown(game), ['   ', '   ', '    ']);
  const event = game.feed('Вася', 'кот');
  eq([event.type, event.user, event.word, event.pts], ['guess', 'Вася', 'кот', 1]);
  eq(shown(game), ['кот', '  т', 'то т']);
  const state = game.snapshot();
  eq([state.words[0].by, state.words[0].how, state.found], ['Вася', 'guess', 1]);
  eq(state.round_scores, [{ name: 'Вася', pts: 1, words: 1 }]);
  eq(state.top, [{ name: 'Вася', score: 1, words: 1 }]);
  eq(last(game.snapshot().feed).pts, 1);
  eq(last(events).type, 'guess');
});

test('раунд: слово, открытое буквами, — без очков; написать его потом — «уже открыто»', () => {
  const { game, events } = fresh({ phrases: ['кот ест ток'] });
  game.feed('Вася', 'кот');
  const state = game.snapshot();
  eq([state.words[2].how, state.words[2].by, state.words[2].word], ['letters', null, 'ток']);
  eq(state.found, 2);
  eq(game.feed('Петя', 'ток').type, 'repeat');
  eq(game.feed('Оля', 'кот').type, 'repeat');
  const feed = game.snapshot().feed;
  eq(feed.map((message) => [message.user, message.pts, message.repeat]),
    [['Вася', 1, false], ['Петя', 0, true], ['Оля', 0, true]]);
  eq(game.snapshot().top.map((row) => row.name), ['Вася']);
  eq(types(events).filter((type) => type === 'repeat').length, 2);
});

test('раунд: слово, которое в тексте дважды, открывается в обоих местах, очко — одно', () => {
  const { game } = fresh({ phrases: ['кот видит кот вдали'] });
  eq(game.feed('Вася', 'кот').pts, 1);
  const state = game.snapshot();
  eq([state.words[0].by, state.words[2].by], ['Вася', 'Вася']);
  eq(state.top[0].score, 1);
});

test('раунд: слово можно написать по-разному', () => {
  const { game } = fresh({ phrases: ['ёжик ест кота дома'] });
  eq(game.feed('Вася', '  КОТА!  ').type, 'guess');
  eq(game.feed('Петя', '«ежик»').type, 'guess');
  eq(game.feed('Оля', 'Дома...').type, 'guess');
  const words = game.snapshot().words;
  eq([words[0].shown, words[0].by], ['ёжик', 'Петя']);
});

test('раунд: что словом не считается', () => {
  const { game } = fresh({ phrases: ['кот ест торт'] });
  for (const text of ['кот ест', 'cat', 'к0т', 'котик', 'ко', '!кот', '123']) eq(game.feed('Вася', text), null, text);
  eq(game.snapshot().found, 0);
});

test('раунд: боты не играют и в чат на экране не попадают', () => {
  const { game } = fresh({ phrases: ['кот ест торт'] });
  for (const bot of BOTS.slice(0, 3)) eq(game.feed(bot, 'кот', { login: bot }), null);
  eq(game.feed('ВасяБот', 'кот', { login: 'nightbot' }), null);
  eq([game.snapshot().feed, game.snapshot().found], [[], 0]);
});

test('раунд: весь текст открыт — итоги, потом следующий текст', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест тост', 'мы идём домой'], settings: { pause: 15 } });
  game.feed('Вася', 'кот');
  game.feed('Петя', 'ест');
  eq(game.state, 'results');
  const state = game.snapshot();
  eq([state.results.reason, state.results.next_at, state.results.text], ['all', clock.t + 15, ['кот ест тост']]);
  eq(state.words.map((word) => [word.word, word.how, word.missed]),
    [['кот', 'guess', false], ['ест', 'guess', false], ['тост', 'letters', false]]);
  eq(state.lines, [{ done: true, hint_at: null }]);
  const end = last(events);
  eq([end.type, end.reason, end.found, end.total, end.missed], ['round_end', 'all', 2, 3, []]);
  eq(game.feed('Оля', 'тост'), null, 'на итогах слова не считаются');
  clock.t += 14.9;
  game.tick();
  eq(game.state, 'results');
  clock.t += 0.1;
  game.tick();
  eq([game.state, game.snapshot().round, game.answers().text], ['playing', 2, ['мы идём домой']]);
  eq(game.snapshot().round_scores, []);
  eq(game.snapshot().top.length, 2);
});

test('раунд: лимит времени — неоткрытые слова видны в итогах', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест торт'], settings: { round_time: 60, hint_every: 0 } });
  eq(game.snapshot().ends, clock.t + 60);
  clock.t += 59;
  game.tick();
  eq(game.state, 'playing');
  clock.t += 1;
  game.tick();
  const state = game.snapshot();
  eq([state.state, state.results.reason], ['results', 'time']);
  eq(state.words.map((word) => [word.shown, word.missed]), [['кот', true], ['ест', true], ['торт', true]]);
  eq(last(events).missed, ['кот', 'ест', 'торт']);
});

test('подсказки: после тишины открывается одна буква в строке', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 20 } });
  const start = clock.t;
  eq(hintAt(game), start + 20);
  clock.t = start + 19.9;
  game.tick();
  eq(known(game), []);
  clock.t = start + 20;
  game.tick();
  const hint = last(events);
  eq([hint.type, hint.line], ['hint', 0]);
  eq(known(game), [hint.letter]);
  eq(shown(game), game.answers().words.map((word) => masked(word.word, new Set([hint.letter]))));
  eq(hintAt(game), start + 40);
});

test('подсказки: угаданное слово начинает отсчёт заново', () => {
  const { game, clock } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 20 } });
  clock.t += 15;
  game.feed('Вася', 'ест');
  eq(hintAt(game), clock.t + 20);
  clock.t += 19;
  game.tick();
  eq(known(game), sorted('ест'));
});

test('подсказки: могут открыть текст сами — без очков', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 20 } });
  for (let i = 0; i < 10 && game.state === 'playing'; i++) {
    clock.t += 20;
    game.tick();
  }
  eq(game.state, 'results');
  const hints = types(events).filter((type) => type === 'hint').length;
  ok(hints >= 3 && hints <= 6, 'подсказок ' + hints + ' — не больше, чем разных букв в тексте');
  eq([game.snapshot().round_scores, game.snapshot().top], [[], []]);
  eq(game.snapshot().words.map((word) => word.how), ['letters', 'letters', 'letters']);
});

test('подсказки: выключаются нулём', () => {
  const { game, clock } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 0 } });
  eq(hintAt(game), null);
  clock.t += 10000;
  game.tick();
  eq([game.state, known(game)], ['playing', []]);
});

test('подсказки: кнопка открывает букву сразу, на итогах — нет', () => {
  const { game, events } = fresh({ phrases: ['кот ест торт'] });
  ok(game.hint());
  eq(known(game).length, 1);
  eq(last(events).type, 'hint');
  game.skip();
  no(game.hint());
});

test('пауза: раунд замирает, «продолжить» возвращает его с того же места', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 20, round_time: 100 } });
  const start = clock.t;
  game.feed('Вася', 'кот');
  clock.t += 5;
  ok(game.pause());
  no(game.pause());
  eq(game.state, 'paused');
  eq(game.feed('Петя', 'ест'), null, 'на паузе слова не считаются');
  eq(last(game.snapshot().feed).text, 'ест', 'но чат идёт');
  clock.t += 1000;
  game.tick();
  eq(game.state, 'paused');
  ok(game.resume());
  no(game.resume());
  const state = game.snapshot();
  eq([state.state, state.found, state.lines[0].hint_at, state.ends], ['playing', 1, start + 1020, start + 1100]);
  eq(state.started, start);
  eq(types(events).slice(-2), ['paused', 'resumed']);
});

test('пауза: отсчёт и перерыв между раундами тоже замирают', () => {
  const { game, clock } = makeGame();
  game.open(10);
  clock.t += 4;
  game.pause();
  clock.t += 100;
  game.tick();
  game.resume();
  eq(game.snapshot().starts_at, clock.t + 6);
  clock.t += 6;
  game.tick();
  game.skip();
  const next = game.snapshot().results.next_at;
  game.pause();
  clock.t += 50;
  game.resume();
  eq(game.snapshot().results.next_at, next + 50);
  game.pause();
  game.stop();
  eq(game.state, 'stopped');
});

test('команды: «раунд» заканчивает раунд, на итогах — сразу следующий; «сброс» обнуляет счёт', () => {
  const { game, events } = fresh({ phrases: ['кот ест торт', 'мы идём домой'] });
  game.feed('Вася', 'кот');
  eq(game.feed('Модер', '!фразолов-раунд', { mod: true }), { type: 'command', command: 'skip' });
  eq([game.state, game.snapshot().results.reason], ['results', 'skip']);
  game.feed('Модер', '!ФРАЗОЛОВ-РАУНД сейчас', { mod: true });
  eq([game.state, game.answers().text], ['playing', ['мы идём домой']]);
  game.feed('Модер', '!фразолов-сброс', { mod: true });
  eq(game.snapshot().top, []);
  eq(types(events).filter((type) => type === 'scores_reset').length, 1);
});

test('команды: «пауза» ставит игру на паузу, ещё раз — продолжает', () => {
  const { game } = fresh();
  game.feed('Модер', '!фразолов-пауза', { mod: true });
  eq(game.state, 'paused');
  game.feed('Модер', '!фразолов-раунд', { mod: true });
  eq(game.state, 'paused', 'на паузе раунд командой не кончается');
  game.feed('Модер', '!фразолов-пауза', { mod: true });
  eq(game.state, 'playing');
});

test('команды: только для стримера и модераторов, выключаются настройкой', () => {
  const { game } = fresh();
  eq(game.feed('Вася', '!фразолов-раунд'), null);
  eq(game.feed('Модер', '!раунд', { mod: true }), null);
  eq(game.state, 'playing');
  game.configure(clean({ chat_commands: false }));
  eq(game.feed('Модер', '!фразолов-раунд', { mod: true }), null);
  eq(game.state, 'playing');
});

test('настройки на ходу: подсказки и лимит времени действуют сразу, пауза — со следующего раунда', () => {
  const { game, clock } = fresh({ phrases: ['кот ест торт'], settings: { hint_every: 20, pause: 20 } });
  const start = clock.t;
  clock.t += 5;
  game.configure(clean({ hint_every: 60, round_time: 30, pause: 40 }));
  eq([hintAt(game), game.snapshot().ends], [start + 65, start + 30]);
  game.configure(clean({ hint_every: 0, round_time: 0, pause: 40 }));
  eq([hintAt(game), game.snapshot().ends], [null, null]);
  game.skip();
  eq(game.snapshot().results.next_at, clock.t + 40);
});

test('настройки на ходу: новое расписание сброса не стирает счёт задним числом', () => {
  const { game, clock } = fresh({ phrases: ['кот ест торт'], settings: { reset_mode: 'timer', reset_hours: 1 } });
  game.feed('Вася', 'кот');
  clock.t += 3000;
  game.configure(clean({ reset_mode: 'timer', reset_hours: 2 }));
  clock.t += 3000;
  game.tick();
  eq(game.snapshot().players, 1);
});

test('чат: в ленту идут все сообщения', () => {
  const { game } = makeGame({ phrases: ['кот съел рыбу вчера'] });
  game.feed('Вася', 'до игры');
  eq(game.snapshot().feed.length, 1);
  game.open(0);
  game.tick();
  blank(game);
  game.feed('Вася', 'всем привет!');
  game.feed('Петя', '   ');
  game.feed('Вася', ' РЫБУ ');
  game.feed('Петя', 'рыбу');
  game.feed('Модер', '!фразолов-сброс', { mod: true });
  const feed = game.snapshot().feed;
  eq(feed.map((m) => [m.user, m.text, m.pts, m.repeat]), [['Вася', 'до игры', 0, false],
    ['Вася', 'всем привет!', 0, false], ['Вася', 'РЫБУ', 1, false], ['Петя', 'рыбу', 0, true],
    ['Модер', '!фразолов-сброс', 0, false]]);
  const ids = feed.map((m) => m.id);
  eq(ids, Array.from(new Set(ids)).sort((a, b) => a - b));
  eq(sorted(Object.keys(feed[0])), sorted(['id', 'user', 'text', 'color', 'pts', 'repeat', 'star']));
});

test('чат: пока игра остановлена, сообщения запоминаются без перерисовки', () => {
  const { game } = makeGame();
  let changes = 0;
  game.onchange = () => { changes++; };
  game.feed('Вася', 'привет');
  eq([changes, game.snapshot().feed.length], [0, 1]);
  game.open();
  const after = changes;
  game.feed('Вася', 'ещё');
  ok(changes > after);
});

test('чат: лента ограничена, длинное сообщение обрезается', () => {
  const { game } = startRound();
  for (let i = 0; i < CHAT_KEEP + 15; i++) game.feed('Вася', 'сообщение ' + i);
  const feed = game.snapshot().feed;
  eq(feed.length, CHAT_SHOWN);
  eq(last(feed).text, 'сообщение ' + (CHAT_KEEP + 14));
  game.feed('Вася', 'я'.repeat(CHAT_TEXT_MAX + 50));
  eq(last(game.snapshot().feed).text.length, CHAT_TEXT_MAX);
});

test('чат: цвет ника', () => {
  const { game } = startRound();
  game.feed('Лиса', 'привет', { color: '#FF69B4' });
  game.feed('Вася', 'привет', { color: 'красный' });
  game.feed('Петя', 'привет');
  eq(game.snapshot().feed.map((m) => m.color), ['#ff69b4', '', '']);
});

test('чат: удалённое модератором пропадает, очки остаются', () => {
  const { game } = fresh();
  game.feed('Лиса', 'раз', { msgId: 'a1', login: 'lisa' });
  game.feed('Вася', 'два', { msgId: 'a2', login: 'vasya' });
  game.feed('Лиса', 'три', { msgId: 'a3', login: 'lisa' });
  game.feed('Петя', 'рыбу', { msgId: 'a4', login: 'petya' });
  eq(game.unsay({ msgId: 'a2' }), 1);
  eq(game.snapshot().feed.map((m) => m.text), ['раз', 'три', 'рыбу']);
  eq(game.unsay({ user: 'LISA' }), 2);
  eq(game.unsay({ user: 'никто' }), 0);
  eq(game.unsay({}), 0);
  eq(game.unsay({ everything: true }), 1);
  const state = game.snapshot();
  eq([state.feed, state.found, state.top[0].score], [[], 1, 1]);
  no(JSON.stringify(game.snapshot()).includes('a4'));
});

test('чат: смайлики Twitch доходят до ленты', () => {
  const { game } = startRound();
  game.feed('Вася', 'Kappa привет', { emotes: { Kappa: '25' } });
  game.feed('Петя', 'без смайликов');
  game.feed('Оля', 'мусор', { emotes: { 'два слова': '1', ok: 'не номер!', '': '5', LUL: 'emotesv2_a1', x: 7 } });
  game.feed('Тим', 'ещё мусор', { emotes: '25:0-4' });
  const feed = game.snapshot().feed;
  eq(feed[0].emotes, { Kappa: '25' });
  no('emotes' in feed[1]);
  eq(feed[2].emotes, { LUL: 'emotesv2_a1', x: '7' });
  no('emotes' in feed[3]);
});

test('чат: особые ники узнаются по логину — те же, что в других играх', () => {
  const { game } = startRound();
  eq(Array.from(STARS), [['sumaizu', 'rainbow'], ['sukoshissrb', 'white'], ['fra3a', 'thyme'],
    ['welovegames', 'heart'], ['higashi_vo', 'snow'], ['renozis', 'glare'], ['sulffur_', 'gem']]);
  game.feed('Sumaizu', 'привет', { login: 'sumaizu' });
  game.feed('Петя', 'привет', { login: 'petya' });
  game.feed('Ник На Кириллице', 'привет', { login: 'sumaizu' });
  game.feed('Sumaizu', 'привет', { login: 'samozvanec' });
  game.feed('SUMAIZU', 'привет');
  game.feed('constructor', 'привет');
  const state = game.snapshot();
  eq(state.feed.map((m) => m.star), ['rainbow', '', 'rainbow', '', 'rainbow', '']);
  eq(state.stars, Array.from(STARS));
});

test('сброс счёта: когда следующий — по дате', () => {
  const monday = local(2026, 9, 5, 12);
  eq(nextReset(monday, 'day', 6), local(2026, 9, 6, 6));
  eq(nextReset(local(2026, 9, 5, 5), 'day', 6), local(2026, 9, 5, 6));
  eq(nextReset(local(2026, 9, 7, 12), 'week', 6), local(2026, 9, 12, 6));
  eq(nextReset(monday, 'week', 6), local(2026, 9, 12, 6));
  eq(nextReset(monday, 'month', 6), local(2026, 10, 1, 6));
  eq(nextReset(local(2026, 11, 15, 12), 'month', 6), local(2027, 0, 1, 6));
  eq(nextReset(1000, 'timer', 6, 2), 1000 + 7200);
  eq(nextReset(1000, 'never', 6, 2), null);
  eq(nextReset(NaN, 'day', 6), null);
});

test('сброс счёта: по таймеру, даже когда игра остановлена', () => {
  const { game, clock, events } = makeGame({ settings: { reset_mode: 'timer', reset_hours: 2 } });
  game.scores.add('Вася', 5);
  clock.t += 7199;
  game.tick();
  eq(game.scores.size, 1);
  clock.t += 1;
  game.tick();
  eq([game.scores.size, last(events).type, last(events).auto], [0, 'scores_reset', true]);
});

test('сброс счёта: пропущенный сброс случается при следующем запуске', () => {
  const storage = memoryStorage();
  const settings = { reset_mode: 'day', reset_hour: 6 };
  const first = makeGame({ at: local(2026, 9, 5, 23), settings, scores: new Scores(storage, 'k') }).game;
  first.scores.add('Вася', 5);
  const later = makeGame({ at: local(2026, 9, 8, 20), settings, scores: new Scores(storage, 'k') }).game;
  eq(later.snapshot().players, 1);
  later.tick();
  eq(later.snapshot().players, 0);
});

test('счёт: хранится и переживает перезагрузку', () => {
  const storage = memoryStorage();
  const { game } = fresh({ phrases: ['кот ест торт'], scores: new Scores(storage, 'счёт') });
  game.feed('Вася', 'кот');
  game.feed('вася', 'ест');
  eq(new Scores(storage, 'счёт').top(), [{ name: 'вася', score: 2, words: 2 }]);
  eq(new Scores(storage, 'другой канал').top(), []);
  game.resetScores();
  eq(new Scores(storage, 'счёт').top(), []);
  storage.setItem('счёт', 'не json');
  eq(new Scores(storage, 'счёт').top(), []);
});

test('счёт: хранилище может отказать — игра продолжается', () => {
  const broken = { getItem: () => { throw new Error('нельзя'); }, setItem: () => { throw new Error('нельзя'); } };
  const { game } = fresh({ scores: new Scores(broken, 'счёт') });
  eq(game.feed('Вася', 'рыбу').type, 'guess');
  eq(game.snapshot().top[0].score, 1);
});

test('счёт: ники, совпадающие со словами самого языка', () => {
  const { game } = fresh({ phrases: ['рыбу кот дым лес'] });
  game.feed('constructor', 'рыбу');
  game.feed('__proto__', 'кот');
  game.feed('toString', 'дым');
  eq(game.snapshot().top.map((row) => [row.name, row.score]), [['__proto__', 1], ['constructor', 1], ['toString', 1]]);
  eq(game.snapshot().round_scores.length, 3);
});

test('события: слушатель может обращаться к игре, сломанный её не роняет', () => {
  const { game, events } = makeGame();
  game.listeners.push(() => { throw new Error('сломан'); });
  game.listeners.push((event) => {
    if (event.type === 'round_end') game.skip();
  });
  game.open(0);
  game.tick();
  game.skip();
  eq(types(events), ['countdown', 'round_start', 'round_end', 'round_start']);
  eq(game.snapshot().round, 2);
});

test('тексты: по пять коротких предложений из русских слов, первые предложения не повторяются', () => {
  ok(TEXTS.length >= 30);
  const firsts = new Set();
  for (const text of TEXTS) {
    eq(text.length, 5, text[0]);
    for (const sentence of text) {
      ok(/^[а-яё]+( [а-яё]+)+$/.test(sentence), sentence);
      ok(sentence.replace(/ /g, '').length <= 30, 'длинное предложение: ' + sentence);
    }
    no(firsts.has(text[0]), text[0]);
    firsts.add(text[0]);
  }
});

test('тексты: недавние не повторяются и помнятся между запусками', () => {
  const storage = memoryStorage();
  const phrases = new Phrases(storage, 'тексты', seeded(5));
  const seen = [];
  for (let i = 0; i < phrases.keep; i++) {
    const text = phrases.next();
    no(seen.includes(text[0]), text[0]);
    seen.push(text[0]);
  }
  const again = new Phrases(storage, 'тексты', seeded(5));
  eq(again.recent, seen);
  no(seen.includes(again.next()[0]));
  for (let i = 0; i < 500; i++) eq(again.next().length, 5);
  storage.setItem('тексты', 'не json');
  eq(new Phrases(storage, 'тексты').recent, []);
});

test('строки: буквы угаданного слова открываются только в его строке', () => {
  const { game } = fresh({ phrases: ['кот ест торт|лето в городе'] });
  game.feed('Вася', 'кот');
  eq(shown(game), ['кот', '  т', 'то т', '    ', 'в', '      ']);
  eq([known(game, 0), known(game, 1)], [['к', 'о', 'т'], ['в']]);
});

test('строки: слово из двух строк открывается в обеих, очко — одно', () => {
  const { game } = fresh({ phrases: ['кот спит|кот ест'] });
  eq(game.feed('Вася', 'кот').pts, 1);
  eq(game.snapshot().words.filter((word) => word.how === 'guess').map((word) => word.line), [0, 1]);
  eq([known(game, 0), known(game, 1)], [['к', 'о', 'т'], ['к', 'о', 'т']]);
  eq(game.snapshot().top[0].score, 1);
});

test('строки: у каждой строки свой таймер подсказки', () => {
  const { game, clock, events } = fresh({ phrases: ['кот ест торт|лето в городе'], settings: { hint_every: 20 } });
  const start = clock.t;
  clock.t = start + 10;
  game.feed('Вася', 'кот');
  eq([hintAt(game, 0), hintAt(game, 1)], [start + 30, start + 20]);
  clock.t = start + 20;
  game.tick();
  eq(last(events).line, 1);
  eq(known(game, 0), ['к', 'о', 'т']);
  eq(known(game, 1).length, 2);
  eq([hintAt(game, 0), hintAt(game, 1)], [start + 30, start + 40]);
  clock.t = start + 30;
  game.tick();
  eq(last(events).line, 0);
});

test('строки: открытая строка больше подсказок не ждёт, раунд кончается, когда открыты все', () => {
  const { game } = fresh({ phrases: ['кот ест|лето в городе'], settings: { hint_every: 20 } });
  game.feed('Вася', 'кот');
  game.feed('Вася', 'ест');
  eq(game.snapshot().lines.map((line) => line.done), [true, false]);
  eq(hintAt(game, 0), null);
  ok(game.hint(1));
  no(game.hint(0));
  game.feed('Петя', 'лето');
  game.feed('Петя', 'городе');
  eq([game.state, game.snapshot().results.reason], ['results', 'all']);
});

test('игра: много раундов подряд идут без сбоев', () => {
  const clock = fakeClock(), rng = seeded(11);
  const game = new Game(new Phrases(null, 'тексты', seeded(3)), clean({ pause: 5, hint_every: 7 }), null,
    { rng, clock });
  game.open(0);
  game.tick();
  let rounds = 0;
  for (let step = 0; step < 20000 && rounds < 120; step++) {
    if (game.state === 'playing') {
      const words = game.answers().words;
      const target = words[Math.floor(rng() * words.length)];
      if (rng() < 0.3) game.feed('Игрок' + Math.floor(rng() * 5), target.word);
    }
    const before = game.roundNo;
    clock.t += 1;
    game.tick();
    if (game.roundNo !== before) rounds++;
  }
  ok(rounds >= 120, 'раундов: ' + rounds);
  ok(game.snapshot().top.length > 0);
});
