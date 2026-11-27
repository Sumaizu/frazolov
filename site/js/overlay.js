import { TwitchChat } from './chat.js';
import { clean, fromQuery } from './config.js';
import { demoState } from './demo.js';
import { Game, Scores } from './engine.js';
import { Phrases } from './phrases.js';
import { playAll } from './sound.js';
import { playNote, reportPlay } from './stats.js';
import { View } from './view.js';

const CODE_FILES = ['overlay.html', 'css/overlay.css', 'js/overlay.js', 'js/view.js', 'js/engine.js',
  'js/phrases.js', 'js/chat.js', 'js/config.js', 'js/demo.js', 'js/emotes.js', 'js/sound.js', 'js/stats.js'];
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const UPDATE_CHECK_SECONDS = LOCAL ? 5 : 300;
const RELOAD_PAUSE_SECONDS = LOCAL ? 0 : 600;
const STATS_EVERY_SECONDS = 600;
const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1';

const fileUrl = (name) => new URL(name, location.href).href;

function browserStorage() {
  try {
    localStorage.getItem('frazolov');
    return localStorage;
  } catch (error) {
    return null;
  }
}

function watchVisibility(onShow, onHide) {
  const pageShown = () => document.visibilityState !== 'hidden';
  const report = (shown) => (shown ? onShow() : onHide());
  document.addEventListener('visibilitychange', () => report(pageShown()));
  window.addEventListener('obsSourceVisibleChanged', (event) => report(Boolean(event.detail && event.detail.visible)));
  if (pageShown()) onShow();
}

async function filesFingerprint() {
  const marks = await Promise.all(CODE_FILES.map(async (name) => {
    const response = await fetch(fileUrl(name), { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) throw new Error(name);
    return response.headers.get('etag') || response.headers.get('last-modified') || '';
  }));
  return marks.join('|');
}

function refreshCache() {
  return Promise.all(CODE_FILES.map((name) => fetch(fileUrl(name), { cache: 'reload' })));
}

function watchUpdates(canReload) {
  let fingerprint = null, outdated = false, reloading = false;
  const reload = () => {
    const storage = browserStorage();
    const last = storage ? Number(storage.getItem('frazolov.reloaded')) || 0 : 0;
    if (reloading || Date.now() - last < RELOAD_PAUSE_SECONDS * 1000) return;
    reloading = true;
    if (storage) storage.setItem('frazolov.reloaded', String(Date.now()));
    const restart = () => location.reload();
    refreshCache().then(restart, restart);
  };
  const check = async () => {
    try {
      const current = await filesFingerprint();
      if (fingerprint === null) fingerprint = current;
      outdated = outdated || current !== fingerprint;
    } catch (error) {
      return;
    }
    if (outdated && canReload()) reload();
  };
  check();
  setInterval(check, UPDATE_CHECK_SECONDS * 1000);
}

function run(view) {
  let settings = fromQuery(location.search);
  let live = !EMBEDDED;
  const showExample = () => view.render(demoState(settings));
  view.use(settings);
  view.setStill(!live);
  if (!live) showExample();

  const storage = browserStorage();
  const scoresFor = (channel) => new Scores(storage, 'frazolov.scores.' + (channel || '_'));
  const game = new Game(new Phrases(storage), settings, scoresFor(settings.channel));
  const chat = new TwitchChat({
    channel: settings.channel,
    onMessage: (name, text, mod, details) => game.feed(name, text, Object.assign({ mod }, details)),
    onClear: (removed) => game.unsay(removed),
    onStatus: () => refresh(),
  });
  let queued = false;
  function refresh() {
    if (queued || !live) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (live) view.render(Object.assign(game.snapshot(), { room_id: chat.status.roomId }));
    }, 0);
  }
  const restart = () => {
    game.stop();
    game.open();
    notePlay();
  };
  game.onchange = refresh;
  setInterval(() => game.tick(), 250);

  const notePlay = () => {
    if (live && game.state !== 'stopped') reportPlay(playNote('frazolov', settings, EMBEDDED));
  };
  setInterval(notePlay, STATS_EVERY_SECONDS * 1000);

  window.frazolov = {
    game,
    chat,
    view,
    playSounds: playAll,
    apply(next) {
      next = clean(next);
      if (next.channel !== settings.channel) {
        chat.setChannel(next.channel);
        game.scores = scoresFor(next.channel);
      }
      settings = next;
      game.configure(settings);
      view.use(settings);
      if (live) refresh();
      else showExample();
    },
    start() {
      live = true;
      view.setStill(false);
      chat.start();
      restart();
    },
    stop() {
      live = false;
      game.stop();
      chat.stop();
      view.setStill(true);
      showExample();
    },
  };
  if (EMBEDDED) return;
  chat.start();
  watchVisibility(restart, () => game.stop());
  watchUpdates(() => game.state !== 'playing' && game.state !== 'paused');
}

run(new View());
