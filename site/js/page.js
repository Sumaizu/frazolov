import { clean, fromQuery, toQuery } from './config.js';

const STORAGE_KEY = 'frazolov.settings';
const NUMBERS = ['pause', 'hint_every', 'round_time', 'reset_hour', 'reset_hours', 'volume'];
const TEXTS = ['reset_mode'];
const FLAGS = ['chat_commands', 'sound', 'mini'];
const DATE_MODES = ['day', 'week', 'month'];
const SYNC_MS = 500;
const RESET_CONFIRM_MS = 4000;

const $ = (id) => document.getElementById(id);
const frame = $('game'), form = $('settings'), channelField = $('s-channel'), linkPanel = $('link-panel');

let settings = restore();
let playing = false;
let connected = false;
let notice = '';
let resetUntil = 0;

function restore() {
  if (location.search.length > 1) return fromQuery(location.search);
  try {
    return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch (error) {
    return clean({});
  }
}

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    return;
  }
}

function overlayLink(query) {
  return new URL('overlay.html', location.href).href + (query ? '?' + query : '');
}

function overlay() {
  return (frame.contentWindow && frame.contentWindow.frazolov) || null;
}

function fillForm() {
  channelField.value = settings.channel;
  for (const key of NUMBERS.concat(TEXTS)) $('s-' + key).value = settings[key];
  for (const key of FLAGS) $('s-' + key).checked = settings[key];
  showDependentFields(settings);
}

function readForm() {
  const raw = { channel: settings.channel, webcam: settings.webcam };
  for (const key of NUMBERS) raw[key] = $('s-' + key).value === '' ? null : Number($('s-' + key).value);
  for (const key of TEXTS) raw[key] = $('s-' + key).value;
  for (const key of FLAGS) raw[key] = $('s-' + key).checked;
  return clean(raw);
}

function showDependentFields(shown) {
  $('reset-hour-field').hidden = !DATE_MODES.includes(shown.reset_mode);
  $('reset-hours-field').hidden = shown.reset_mode !== 'timer';
  $('volume-text').textContent = shown.volume + '%';
  for (const button of document.querySelectorAll('[data-webcam]')) {
    button.classList.toggle('on', button.dataset.webcam === shown.webcam);
  }
  $('webcam-field').hidden = shown.mini;
  frame.parentNode.classList.toggle('mini', shown.mini);
}

function showStatus(id, kind, text) {
  const node = $(id);
  node.classList.remove('ok', 'warn');
  if (kind) node.classList.add(kind);
  node.textContent = text;
  node.title = text;
}

function showLink() {
  $('link').value = overlayLink(toQuery(settings));
  showStatus('link-status', 'warn', settings.channel ? '' : 'Впиши канал Twitch — без него оверлей не увидит чат.');
}

function adopt(candidate, refill) {
  settings = candidate;
  remember();
  if (refill) fillForm();
  else showDependentFields(settings);
  showLink();
  const api = overlay();
  if (api) api.apply(settings);
}

function commitChannel() {
  const channel = clean({ channel: channelField.value }).channel;
  if (channel !== settings.channel) adopt(clean(Object.assign({}, settings, { channel })), false);
  channelField.value = settings.channel;
}

function toggleGame() {
  const api = overlay();
  if (!api) return;
  commitChannel();
  if (playing) {
    api.stop();
    playing = false;
    resetUntil = 0;
  } else if (!settings.channel) {
    notice = 'Впиши канал Twitch — без него игра не увидит чат.';
    channelField.focus();
  } else {
    api.start();
    playing = true;
    showLinkPanel(false);
  }
  sync();
}

function withGame(action) {
  const api = overlay();
  if (!api || !playing) return;
  action(api.game);
  sync();
}

function resetScores(game) {
  if (Date.now() < resetUntil) {
    game.resetScores();
    resetUntil = 0;
  } else {
    resetUntil = Date.now() + RESET_CONFIRM_MS;
  }
}

function sync() {
  const api = overlay();
  $('play').disabled = !api;
  if (!api) return;
  if (!connected) {
    connected = true;
    api.apply(settings);
  }
  const state = playing ? api.game.state : 'stopped';
  const paused = state === 'paused', asking = playing && Date.now() < resetUntil;
  $('play').textContent = playing ? 'Остановить' : 'Начать';
  $('pause').disabled = $('reset').disabled = !playing;
  $('hint').disabled = state !== 'playing';
  $('skip').disabled = state !== 'playing' && state !== 'results';
  $('pause').textContent = paused ? 'Продолжить' : 'Пауза';
  $('reset').textContent = asking ? 'Точно?' : 'Сброс';
  $('reset').classList.toggle('armed', asking);
  $('example-note').hidden = playing;
  if (paused) {
    notice = '';
    showStatus('status', 'warn', 'Пауза');
  } else if (playing) {
    notice = '';
    const chat = api.chat.status;
    const text = chat.text.charAt(0).toUpperCase() + chat.text.slice(1);
    showStatus('status', chat.state === 'connected' ? 'ok' : 'warn', text);
  } else {
    showStatus('status', notice ? 'warn' : '', notice);
  }
}

function toggleSettings() {
  const open = form.hidden;
  form.hidden = !open;
  $('layout').classList.toggle('with-settings', open);
  $('toggle-settings').setAttribute('aria-expanded', String(open));
}

function showLinkPanel(open) {
  linkPanel.hidden = !open;
  $('toggle-link').setAttribute('aria-expanded', String(open));
}

async function copyLink() {
  const link = $('link'), button = $('copy');
  try {
    await navigator.clipboard.writeText(link.value);
  } catch (error) {
    link.select();
    document.execCommand('copy');
  }
  button.textContent = 'Скопировано';
  setTimeout(() => { button.textContent = 'Копировать'; }, 1500);
}

form.addEventListener('input', () => adopt(readForm(), false));
form.addEventListener('change', () => adopt(readForm(), true));
form.addEventListener('submit', (event) => event.preventDefault());
for (const button of document.querySelectorAll('[data-webcam]')) {
  button.addEventListener('click', () => {
    adopt(clean(Object.assign(readForm(), { webcam: button.dataset.webcam })), true);
  });
}
$('defaults').addEventListener('click', () => adopt(clean({ channel: settings.channel }), true));
$('listen').addEventListener('click', () => {
  const api = overlay();
  if (api) api.playSounds(settings.volume);
});
$('start').addEventListener('submit', (event) => {
  event.preventDefault();
  toggleGame();
});
$('pause').addEventListener('click', () => withGame((game) => {
  if (!game.resume()) game.pause();
}));
$('hint').addEventListener('click', () => withGame((game) => game.hint()));
$('skip').addEventListener('click', () => withGame((game) => game.skip()));
$('reset').addEventListener('click', () => withGame(resetScores));
channelField.addEventListener('change', commitChannel);
channelField.addEventListener('input', () => { notice = ''; });
$('toggle-settings').addEventListener('click', toggleSettings);
$('toggle-link').addEventListener('click', () => showLinkPanel(linkPanel.hidden));
$('copy').addEventListener('click', copyLink);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') showLinkPanel(false);
});
document.addEventListener('click', (event) => {
  if (!linkPanel.contains(event.target) && event.target !== $('toggle-link')) showLinkPanel(false);
});

fillForm();
showLink();
frame.src = overlayLink(['embed=1', toQuery(settings)].filter(Boolean).join('&'));
sync();
setInterval(sync, SYNC_MS);
