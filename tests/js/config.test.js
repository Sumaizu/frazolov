import { DEFAULTS, clean, fromQuery, toQuery } from '../../site/js/config.js';
import { playNote, reportPlay } from '../../site/js/stats.js';
import { eq, no, ok, test } from './harness.js';

test('настройки: значения по умолчанию', () => {
  eq(clean({}), DEFAULTS);
  eq(clean(null), DEFAULTS);
  eq(clean('мусор'), DEFAULTS);
  eq(clean([1, 2]), DEFAULTS);
  eq([DEFAULTS.pause, DEFAULTS.hint_every, DEFAULTS.round_time, DEFAULTS.sound, DEFAULTS.volume],
    [20, 20, 0, true, 100]);
  eq([DEFAULTS.webcam, DEFAULTS.mini, DEFAULTS.chat_commands, DEFAULTS.reset_mode], ['cam', false, true, 'never']);
});

test('настройки: канал', () => {
  for (const raw of ['SomeOne', '#someone', '@someone', 'https://www.twitch.tv/SomeOne', 'twitch.tv/someone/',
    ' someone ', 'https://twitch.tv/someone?tab=chat']) {
    eq(clean({ channel: raw }).channel, 'someone', raw);
  }
  for (const bad of ['два слова', 'имя', 'a'.repeat(26), '', null, undefined, 42.5]) {
    eq(clean({ channel: bad }).channel, '', String(bad));
  }
});

test('настройки: числа зажаты в пределы', () => {
  const s = clean({ pause: 0, round_time: -5, hint_every: '20', volume: 250, reset_hour: 24, reset_hours: 0 });
  eq([s.pause, s.round_time, s.hint_every, s.volume, s.reset_hour, s.reset_hours], [3, 0, 20, 100, 23, 1]);
  eq(clean({ pause: 99999, round_time: 99999, hint_every: 99999 }).round_time, 7200);
});

test('настройки: подсказки — выключены нулём, иначе не чаще раза в пять секунд', () => {
  eq([0, 1, 5, 45, 9999, 'часто', null].map((value) => clean({ hint_every: value }).hint_every),
    [0, 5, 5, 45, 3600, DEFAULTS.hint_every, DEFAULTS.hint_every]);
  eq(toQuery({ hint_every: 0 }), 'hint_every=0');
  eq(fromQuery('?hint_every=60').hint_every, 60);
});

test('настройки: негодные значения заменяются обычными', () => {
  const s = clean({ pause: 'много', hint_every: true, volume: 'тихо', reset_mode: 'иногда', round_time: {} });
  for (const key of ['pause', 'hint_every', 'volume', 'reset_mode', 'round_time']) eq(s[key], DEFAULTS[key], key);
});

test('настройки: флажки', () => {
  const s = clean({ chat_commands: '', sound: '0', webcam: 'false', mini: 'off' });
  eq([s.chat_commands, s.sound, s.webcam, s.mini], [false, false, 'none', false]);
  const on = clean({ sound: '1', webcam: 'да', mini: 1 });
  eq([on.sound, on.webcam, on.mini], [true, 'cam', true]);
});

test('настройки: окошко под вебку — без вебки, с вебкой, витубер', () => {
  eq(['none', 'cam', 'vtuber', 'VTuber', '0', '1', 'false', 'true', 'да', ''].map((webcam) => clean({ webcam }).webcam),
    ['none', 'cam', 'vtuber', 'vtuber', 'none', 'cam', 'none', 'cam', 'cam', 'none']);
  eq([toQuery({ webcam: 'vtuber' }), toQuery({ webcam: 'none' }), toQuery({ webcam: 'cam' })],
    ['webcam=vtuber', 'webcam=none', '']);
});

test('настройки: расписание сброса счёта', () => {
  for (const mode of ['never', 'day', 'week', 'month', 'timer']) eq(clean({ reset_mode: mode }).reset_mode, mode);
});

test('настройки: чужие ключи отбрасываются', () => {
  eq(clean({ delay: 5, overlay: '1', accent: '#00ff7f', 'лишнее': 1 }), DEFAULTS);
});

test('ссылка: в неё попадает только то, что отличается от обычного', () => {
  eq(toQuery({}), '');
  eq(toQuery({ channel: 'SomeOne' }), 'channel=someone');
  const query = toQuery({ channel: 'someone', hint_every: 15, webcam: 'none', mini: true, pause: DEFAULTS.pause,
    reset_mode: 'week', sound: false });
  eq(query, 'channel=someone&hint_every=15&reset_mode=week&sound=0&webcam=none&mini=1');
});

test('ссылка: настройки возвращаются из неё теми же', () => {
  const settings = clean({ channel: 'someone', pause: 12, round_time: 300, hint_every: 0, chat_commands: false,
    reset_mode: 'timer', reset_hours: 3, sound: false, volume: 35, webcam: 'vtuber', mini: true });
  eq(fromQuery('?' + toQuery(settings)), settings);
  eq(fromQuery(''), DEFAULTS);
  eq(fromQuery('?pause=7&мусор=1').pause, 7);
  no('мусор' in fromQuery('?мусор=1'));
  ok(fromQuery('?mini=1').mini);
});

test('статистика: отметка о запуске — только с каналом и только с сайта gamesonstream.ru', () => {
  eq(playNote('frazolov', { channel: '', webcam: 'cam' }, false), null);
  eq(playNote('frazolov', { channel: 'some_one', webcam: 'vtuber' }, true),
    { game: 'frazolov', channel: 'some_one', mode: 'vtuber', place: 'browser' });
  eq(playNote('frazolov', { channel: 'some_one', webcam: 'none' }, false).place, 'obs');
  eq(playNote('frazolov', { channel: 'some_one', webcam: 'cam', mini: true }, false).mode, 'mini');
  eq([reportPlay({ game: 'x' }, '127.0.0.1'), reportPlay({ game: 'x' }, 'sumaizu.github.io'),
    reportPlay(null, 'gamesonstream.ru')], [false, false, false]);
});
