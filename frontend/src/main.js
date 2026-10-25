import './style.css';
import './app.css';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { Quit } from '../wailsjs/runtime/runtime';

const root = document.querySelector('#app');
const previewMode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('preview')
  : null;

const DISPLAY_DEFAULTS = Object.freeze({
  speed: 120,
  fontSize: 13,
  area: 70,
  fontHue: 174,
  fontSaturation: 58,
  fontLightness: 92,
  themeHue: 168,
});
const DISPLAY_STORAGE_KEY = 'qq-danmaku-display-settings';

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeHexColor(value, fallback = '#000000') {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function hslToRgb(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = s * Math.min(l, 1 - l);

  const channel = (offset) => {
    const k = (offset + h / 30) % 12;
    const value = l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255);
  };

  return { r: channel(0), g: channel(8), b: channel(4) };
}

function hslToHex(hue, saturation, lightness) {
  const { r, g, b } = hslToRgb(hue, saturation, lightness);
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToHsl(value) {
  const hex = normalizeHexColor(value);
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  const lightness = (max + min) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

function normalizeDisplaySettings(settings = {}) {
  if (!settings || typeof settings !== 'object') settings = {};

  const hasLegacyColor = /^#[0-9a-f]{6}$/i.test(String(settings.color || ''));
  const legacyColor = hasLegacyColor
    ? hexToHsl(settings.color)
    : {
        h: DISPLAY_DEFAULTS.fontHue,
        s: DISPLAY_DEFAULTS.fontSaturation,
        l: DISPLAY_DEFAULTS.fontLightness,
      };

  return {
    speed: clampNumber(settings.speed, 60, 260, DISPLAY_DEFAULTS.speed),
    fontSize: clampNumber(settings.fontSize, 12, 24, DISPLAY_DEFAULTS.fontSize),
    area: clampNumber(settings.area, 30, 100, DISPLAY_DEFAULTS.area),
    fontHue: clampNumber(settings.fontHue, 0, 360, legacyColor.h),
    fontSaturation: clampNumber(
      settings.fontSaturation,
      0,
      100,
      legacyColor.s,
    ),
    fontLightness: clampNumber(
      settings.fontLightness,
      42,
      100,
      legacyColor.l,
    ),
    themeHue: clampNumber(settings.themeHue, 0, 360, DISPLAY_DEFAULTS.themeHue),
  };
}

function danmakuColor() {
  return hslToHex(
    state.display.fontHue,
    state.display.fontSaturation,
    state.display.fontLightness,
  );
}

function themePalette() {
  const hue = state.display.themeHue;
  const accentRgb = hslToRgb(hue, 58, 63);
  return {
    hue,
    accent: hslToHex(hue, 58, 63),
    accentStrong: hslToHex(hue, 74, 73),
    accentInk: hslToHex(hue, 48, 9),
    accentRgb: `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`,
    panel: `hsla(${hue}, 20%, 9%, 0.95)`,
    danmakuPanel: `hsla(${hue}, 18%, 9%, 0.94)`,
  };
}

function loadDisplaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) || '{}');
    return normalizeDisplaySettings(saved);
  } catch {
    return { ...DISPLAY_DEFAULTS };
  }
}

const state = {
  user: null,
  authMode: 'login',
  form: {
    username: '',
    password: '',
    confirmPassword: '',
  },
  loading: false,
  authError: '',
  monitorError: '',
  backgroundMode: false,
  collapsed: false,
  messages: [],
  receivedCount: 0,
  display: loadDisplaySettings(),
};

const iconPaths = {
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  panelClose: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>',
  panelOpen: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || ''}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hasBackend() {
  return Boolean(window.go?.main?.App?.Login);
}

function callBackend(method, ...args) {
  const fn = window.go?.main?.App?.[method];
  if (typeof fn !== 'function') {
    return Promise.reject(new Error('未连接到应用后端'));
  }
  return fn(...args);
}

function createPreviewBridge() {
  return {
    login: async (username) => ({
      success: true,
      message: '登录成功!',
      user: { id: 1, user: username || '演示用户' },
    }),
    register: async (username) => ({
      success: true,
      message: '注册成功!',
      user: { id: 1, user: username || '演示用户' },
    }),
    logout: async () => ({ success: true, message: '已退出登录' }),
    setInteractiveArea: () => Promise.resolve(),
    setBackgroundMode: () => Promise.resolve(),
  };
}

const bridge = previewMode
  ? createPreviewBridge()
  : {
      login: (username, password) => callBackend('Login', username, password),
      register: (username, password) => callBackend('Register', username, password),
      logout: () => callBackend('Logout'),
      setInteractiveArea: (x, y, width, height, visible) =>
        callBackend('SetOverlayInteractiveArea', x, y, width, height, visible),
      setBackgroundMode: (enabled) => callBackend('SetOverlayBackgroundMode', enabled),
    };

function timeLabel(value) {
  const match = String(value || '').match(/(\d{1,2}:\d{2})/);
  return match ? match[1] : '--:--';
}

function fullTimeLabel(value) {
  return String(value || '').trim() || '暂无时间';
}

function speedLabel(speed) {
  if (speed < 90) return '慢速';
  if (speed < 160) return '标准';
  if (speed < 220) return '快速';
  return '极速';
}

function rangeProgress(value, min, max) {
  return `${((value - min) / (max - min)) * 100}%`;
}

function initialOf(name) {
  return Array.from(String(name || 'Q').trim())[0]?.toUpperCase() || 'Q';
}

function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? raw.Title ?? 'QQ 消息').trim();
  const body = String(raw.body ?? raw.Body ?? '').trim();
  if (!title && !body) return null;
  return {
    key: `${raw.notification_id ?? raw.NotificationID ?? raw.ID ?? Date.now()}-${Math.random()}`,
    notificationId: raw.notification_id ?? raw.NotificationID ?? '',
    time: raw.time ?? raw.Time ?? '',
    title: title || 'QQ 消息',
    body,
  };
}

function addIncomingMessage(raw) {
  const message = normalizeMessage(raw);
  if (!message) return;

  if (
    message.notificationId &&
    state.messages.some((item) => item.notificationId === message.notificationId)
  ) {
    return;
  }

  state.messages.unshift(message);
  state.messages = state.messages.slice(0, 60);
  state.receivedCount += 1;
  state.monitorError = '';
  appendIncomingMessage(message);
  launchDanmaku(message);
}

function syncMessageCounters() {
  root.querySelectorAll('[data-message-count]').forEach((element) => {
    element.textContent = String(state.receivedCount);
  });

  const clearButton = root.querySelector('[data-action="clear-messages"]');
  if (clearButton) clearButton.disabled = state.messages.length === 0;
}

function appendIncomingMessage(message) {
  root.querySelector('.dashboard-panel > .alert-bar')?.remove();

  const list = root.querySelector('.message-list');
  if (list) {
    list.querySelector('.empty-state')?.remove();
    const template = document.createElement('template');
    template.innerHTML = messageItemMarkup(message).trim();
    const item = template.content.firstElementChild;
    if (item) {
      list.prepend(item);
      while (list.children.length > 60) {
        list.lastElementChild?.remove();
      }
    }
  }

  syncMessageCounters();
}

const DANMAKU_GAP = 76;
const DANMAKU_TOP = 78;
const DANMAKU_MIN_LANE_HEIGHT = 46;
const DANMAKU_MAX_LANES = 10;
let danmakuLanes = [];

function danmakuLayout() {
  const laneHeight = Math.max(
    DANMAKU_MIN_LANE_HEIGHT,
    state.display.fontSize + 30,
  );
  const availableHeight = Math.max(1, window.innerHeight - DANMAKU_TOP - 24);
  const areaHeight = availableHeight * (state.display.area / 100);
  const laneCount = Math.max(
    1,
    Math.min(DANMAKU_MAX_LANES, Math.floor(areaHeight / laneHeight)),
  );
  return { laneCount, laneHeight };
}

function refreshDanmakuLayout() {
  const layer = document.querySelector('#danmaku-layer');
  if (!layer) return;

  const { laneCount, laneHeight } = danmakuLayout();
  danmakuLanes = Array.from(
    { length: laneCount },
    (_, index) => danmakuLanes[index] || 0,
  );

  layer.querySelectorAll('.danmaku-item').forEach((item) => {
    const lane = Number(item.dataset.lane || 0);
    if (lane >= laneCount) {
      item.remove();
      return;
    }

    item.style.top = `${DANMAKU_TOP + lane * laneHeight}px`;
    const distance = window.innerWidth + item.getBoundingClientRect().width;
    item.style.animationDuration = `${Math.max(
      4,
      distance / state.display.speed,
    )}s`;
  });
}

function launchDanmaku(message) {
  const layer = document.querySelector('#danmaku-layer');
  if (!layer || !state.user) return;

  const item = document.createElement('div');
  const source = document.createElement('span');
  const text = document.createElement('span');

  item.className = 'danmaku-item';
  source.className = 'danmaku-source';
  text.className = 'danmaku-text';
  source.textContent = message.title;
  text.textContent = message.body || '收到一条新通知';
  item.append(source, text);
  item.style.animationName = 'none';
  layer.append(item);

  const { laneCount, laneHeight } = danmakuLayout();
  if (danmakuLanes.length !== laneCount) {
    danmakuLanes = Array.from(
      { length: laneCount },
      (_, index) => danmakuLanes[index] || 0,
    );
  }

  const width = item.getBoundingClientRect().width;
  const now = performance.now();
  let lane = danmakuLanes.findIndex((availableAt) => availableAt <= now);
  if (lane === -1) {
    lane = danmakuLanes.indexOf(Math.min(...danmakuLanes));
  }

  const startAt = Math.max(now, danmakuLanes[lane]);
  const delay = startAt - now;
  const duration = Math.max(4, (window.innerWidth + width) / state.display.speed);

  item.dataset.lane = String(lane);
  item.style.top = `${DANMAKU_TOP + lane * laneHeight}px`;
  item.style.animationDelay = `${delay}ms`;
  item.style.animationDuration = `${duration}s`;

  danmakuLanes[lane] =
    startAt + ((width + DANMAKU_GAP) / state.display.speed) * 1000;

  item.addEventListener(
    'animationstart',
    () => {
      item.classList.add('is-running');
    },
    { once: true },
  );
  item.addEventListener('animationend', () => item.remove(), { once: true });

  void item.offsetWidth;
  item.style.animationName = 'danmaku-run';

  window.setTimeout(
    () => item.remove(),
    delay + duration * 1000 + 1000,
  );
}

function clearDanmaku() {
  document.querySelector('#danmaku-layer')?.replaceChildren();
  danmakuLanes = [];
}

let displayLayoutFrame = 0;
function scheduleDanmakuLayout() {
  window.cancelAnimationFrame(displayLayoutFrame);
  displayLayoutFrame = window.requestAnimationFrame(refreshDanmakuLayout);
}

function applyDisplaySettings({ refreshLayout = true } = {}) {
  const palette = themePalette();
  const color = danmakuColor();
  const styles = {
    '--danmaku-font-size': `${state.display.fontSize}px`,
    '--danmaku-color': color,
    '--theme-hue': String(palette.hue),
    '--accent': palette.accent,
    '--accent-strong': palette.accentStrong,
    '--accent-ink': palette.accentInk,
    '--accent-rgb': palette.accentRgb,
    '--panel-bg': palette.panel,
    '--danmaku-panel-bg': palette.danmakuPanel,
  };

  Object.entries(styles).forEach(([property, value]) => {
    document.documentElement.style.setProperty(property, value);
  });
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', palette.accent);

  if (refreshLayout) scheduleDanmakuLayout();
}

function updateRangeControl(name, value, min, max) {
  const input = root.querySelector(`[data-setting="${name}"]`);
  if (!input) return;

  input.value = String(value);
  input.style.setProperty(
    '--range-progress',
    rangeProgress(value, min, max),
  );
}

function updateDisplaySettingControls() {
  updateRangeControl('speed', state.display.speed, 60, 260);
  updateRangeControl('fontSize', state.display.fontSize, 12, 24);
  updateRangeControl('area', state.display.area, 30, 100);
  updateRangeControl('fontHue', state.display.fontHue, 0, 360);
  updateRangeControl('fontLightness', state.display.fontLightness, 42, 100);
  updateRangeControl('themeHue', state.display.themeHue, 0, 360);

  const color = danmakuColor();
  const theme = themePalette();
  root
    .querySelector('[data-setting="fontHue"]')
    ?.style.setProperty('--thumb-color', color);
  root
    .querySelector('[data-setting="fontLightness"]')
    ?.style.setProperty('--thumb-color', color);
  root
    .querySelector('[data-setting="themeHue"]')
    ?.style.setProperty('--thumb-color', theme.accent);

  const outputs = {
    speed: speedLabel(state.display.speed),
    fontSize: `${state.display.fontSize}px`,
    area: `${state.display.area}%`,
    fontColor: color.toUpperCase(),
    fontLightness: `${state.display.fontLightness}%`,
    themeColor: theme.accent.toUpperCase(),
  };
  Object.entries(outputs).forEach(([name, value]) => {
    const output = root.querySelector(
      `[data-setting-output="${name}"]`,
    );
    if (output) output.textContent = value;
  });
}

let displaySaveTimer = 0;
function persistDisplaySettings() {
  window.clearTimeout(displaySaveTimer);
  displaySaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(state.display));
    } catch {
      // Settings remain available for this session when storage is unavailable.
    }
  }, 120);
}

function setDisplaySetting(key, value) {
  if (key === 'speed') {
    state.display.speed = clampNumber(value, 60, 260, state.display.speed);
  } else if (key === 'fontSize') {
    state.display.fontSize = clampNumber(value, 12, 24, state.display.fontSize);
  } else if (key === 'area') {
    state.display.area = clampNumber(value, 30, 100, state.display.area);
  } else if (key === 'fontHue') {
    state.display.fontHue = clampNumber(value, 0, 360, state.display.fontHue);
  } else if (key === 'fontLightness') {
    state.display.fontLightness = clampNumber(
      value,
      42,
      100,
      state.display.fontLightness,
    );
  } else if (key === 'themeHue') {
    state.display.themeHue = clampNumber(
      value,
      0,
      360,
      state.display.themeHue,
    );
  } else {
    return;
  }

  applyDisplaySettings({
    refreshLayout: ['speed', 'fontSize', 'area'].includes(key),
  });
  updateDisplaySettingControls();
  persistDisplaySettings();
}

function resetDisplaySettings() {
  state.display = { ...DISPLAY_DEFAULTS };
  applyDisplaySettings();
  updateDisplaySettingControls();
  persistDisplaySettings();
}

function installBackendEvents() {
  if (previewMode || !window.runtime?.EventsOn) return;

  try {
    EventsOn('qq:new-message', (payload) => addIncomingMessage(payload));
    EventsOn('qq:monitor-error', (message) => {
      state.monitorError = String(message || 'QQ 通知监听暂时不可用');
      render();
    });
  } catch (error) {
    state.monitorError = error?.message || '事件监听初始化失败';
    render();
  }
}

function brandMarkup(compact = false) {
  return `
    <div class="brand ${compact ? 'brand--compact' : ''}">
      <span class="brand-glyph" aria-hidden="true">Q</span>
      ${compact ? '' : '<span class="brand-copy"><strong>QQ 弹幕</strong><small>桌面通知</small></span>'}
    </div>
  `;
}

function errorBannerMarkup(message, action = 'dismiss-error') {
  if (!message) return '';
  return `
    <div class="alert-bar" role="alert">
      ${icon('alert')}
      <span>${escapeHtml(message)}</span>
      <button class="icon-button icon-button--small" type="button" data-action="${action}" title="关闭提示" aria-label="关闭提示">
        ${icon('x')}
      </button>
    </div>
  `;
}

function authView() {
  const isRegister = state.authMode === 'register';
  const backendMissing = !previewMode && !hasBackend();

  return `
    <main class="overlay-layer auth-layer">
      <section class="control-panel auth-panel" id="control-panel" aria-label="登录面板">
        <header class="panel-header">
          ${brandMarkup()}
          <button class="icon-button" type="button" data-action="quit" title="退出程序" aria-label="退出程序">
            ${icon('power')}
          </button>
        </header>

        <div class="auth-heading">
          <span class="eyebrow">${isRegister ? '创建账户' : '欢迎回来'}</span>
          <h1>${isRegister ? '创建新账户' : '登录 QQ 弹幕'}</h1>
        </div>

        <div class="segmented-control" role="tablist" aria-label="账户操作">
          <button class="${!isRegister ? 'is-active' : ''}" type="button" role="tab" aria-selected="${!isRegister}" data-action="auth-mode" data-mode="login">登录</button>
          <button class="${isRegister ? 'is-active' : ''}" type="button" role="tab" aria-selected="${isRegister}" data-action="auth-mode" data-mode="register">注册</button>
        </div>

        ${errorBannerMarkup(state.authError)}
        ${backendMissing ? errorBannerMarkup('正在等待应用后端连接，请通过桌面应用启动。') : ''}

        <form class="auth-form" data-form="auth" novalidate>
          <label class="field">
            <span class="field-label">用户名</span>
            <span class="input-shell">
              ${icon('user')}
              <input
                name="username"
                type="text"
                value="${escapeHtml(state.form.username)}"
                autocomplete="username"
                placeholder="输入用户名"
                ${state.loading ? 'disabled' : ''}
              />
            </span>
          </label>

          <label class="field">
            <span class="field-label">密码</span>
            <span class="input-shell">
              ${icon('lock')}
              <input
                name="password"
                type="password"
                value="${escapeHtml(state.form.password)}"
                autocomplete="${isRegister ? 'new-password' : 'current-password'}"
                placeholder="${isRegister ? '8-20 位密码' : '输入密码'}"
                ${state.loading ? 'disabled' : ''}
              />
              <button class="reveal-button" type="button" data-action="toggle-password" data-target="password" title="显示密码" aria-label="显示密码">
                ${icon('eye')}
              </button>
            </span>
          </label>

          ${
            isRegister
              ? `
                <label class="field">
                  <span class="field-label">确认密码</span>
                  <span class="input-shell">
                    ${icon('lock')}
                    <input
                      name="confirmPassword"
                      type="password"
                      value="${escapeHtml(state.form.confirmPassword)}"
                      autocomplete="new-password"
                      placeholder="再次输入密码"
                      ${state.loading ? 'disabled' : ''}
                    />
                    <button class="reveal-button" type="button" data-action="toggle-password" data-target="confirmPassword" title="显示密码" aria-label="显示密码">
                      ${icon('eye')}
                    </button>
                  </span>
                </label>
                <p class="field-note">包含大写、小写字母、数字和特殊字符，长度 8-20 位。</p>
              `
              : ''
          }

          <button class="primary-button" type="submit" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? '<span class="spinner" aria-hidden="true"></span>' : icon(isRegister ? 'user' : 'check')}
            <span>${state.loading ? '正在处理' : isRegister ? '创建账户' : '进入弹幕'}</span>
          </button>
        </form>

      </section>
    </main>
  `;
}

function messageItemMarkup(message) {
  return `
    <article class="message-item">
      <div class="message-meta">
        <span class="message-source">${escapeHtml(message.title)}</span>
        <time title="${escapeHtml(fullTimeLabel(message.time))}">${escapeHtml(timeLabel(message.time))}</time>
      </div>
      <p>${escapeHtml(message.body || '收到一条新通知')}</p>
    </article>
  `;
}

function miniPanelMarkup() {
  return `
    <section class="mini-panel" id="control-panel" aria-label="QQ 弹幕控制台">
      <span class="brand-glyph brand-glyph--mini" aria-hidden="true">Q</span>
      <span class="mini-status"><span class="status-dot"></span>监听中</span>
      <span class="mini-count" data-message-count>${state.receivedCount}</span>
      <button class="icon-button icon-button--small" type="button" data-action="toggle-collapse" title="展开控制台" aria-label="展开控制台">
        ${icon('panelOpen')}
      </button>
    </section>
  `;
}

function displaySettingsMarkup() {
  const fontColor = danmakuColor();
  const themeColor = themePalette().accent;

  return `
    <section class="display-settings" aria-labelledby="display-settings-title">
      <div class="settings-heading">
        <span class="settings-title" id="display-settings-title">
          ${icon('sliders')}
          <span>弹幕设置</span>
        </span>
        <button class="reset-settings-button" type="button" data-action="reset-display" title="恢复默认设置" aria-label="恢复默认设置">
          重置
        </button>
      </div>

      <div class="settings-list">
        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">速度</span>
            <output class="setting-value" data-setting-output="speed">${speedLabel(state.display.speed)}</output>
          </span>
          <input
            class="setting-slider"
            type="range"
            min="60"
            max="260"
            step="10"
            value="${state.display.speed}"
            data-setting="speed"
            style="--range-progress: ${rangeProgress(state.display.speed, 60, 260)}"
            aria-label="弹幕滚动速度"
          />
        </label>

        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">字号</span>
            <output class="setting-value" data-setting-output="fontSize">${state.display.fontSize}px</output>
          </span>
          <input
            class="setting-slider"
            type="range"
            min="12"
            max="24"
            step="1"
            value="${state.display.fontSize}"
            data-setting="fontSize"
            style="--range-progress: ${rangeProgress(state.display.fontSize, 12, 24)}"
            aria-label="弹幕字体大小"
          />
        </label>

        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">展示范围</span>
            <output class="setting-value" data-setting-output="area">${state.display.area}%</output>
          </span>
          <input
            class="setting-slider"
            type="range"
            min="30"
            max="100"
            step="5"
            value="${state.display.area}"
            data-setting="area"
            style="--range-progress: ${rangeProgress(state.display.area, 30, 100)}"
            aria-label="弹幕垂直展示范围"
          />
        </label>

        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">字体颜色</span>
            <output class="setting-value" data-setting-output="fontColor">${fontColor.toUpperCase()}</output>
          </span>
          <input
            class="setting-slider setting-slider--hue"
            type="range"
            min="0"
            max="360"
            step="1"
            value="${state.display.fontHue}"
            data-setting="fontHue"
            style="--range-progress: ${rangeProgress(state.display.fontHue, 0, 360)}; --thumb-color: ${fontColor}"
            aria-label="弹幕字体颜色色相"
          />
        </label>

        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">字体亮度</span>
            <output class="setting-value" data-setting-output="fontLightness">${state.display.fontLightness}%</output>
          </span>
          <input
            class="setting-slider"
            type="range"
            min="42"
            max="100"
            step="1"
            value="${state.display.fontLightness}"
            data-setting="fontLightness"
            style="--range-progress: ${rangeProgress(state.display.fontLightness, 42, 100)}; --thumb-color: ${fontColor}"
            aria-label="弹幕字体亮度"
          />
        </label>

        <label class="setting-row">
          <span class="setting-meta">
            <span class="setting-label">主题颜色</span>
            <output class="setting-value" data-setting-output="themeColor">${themeColor.toUpperCase()}</output>
          </span>
          <input
            class="setting-slider setting-slider--hue"
            type="range"
            min="0"
            max="360"
            step="1"
            value="${state.display.themeHue}"
            data-setting="themeHue"
            style="--range-progress: ${rangeProgress(state.display.themeHue, 0, 360)}; --thumb-color: ${themeColor}"
            aria-label="界面主题颜色色相"
          />
        </label>
      </div>
    </section>
  `;
}

function dashboardView() {
  const userName = state.user?.name || state.form.username || '用户';
  const hasMessages = state.messages.length > 0;

  return `
    <main class="overlay-layer dashboard-layer">
      ${
        state.collapsed
          ? miniPanelMarkup()
          : `
            <section class="control-panel dashboard-panel" id="control-panel" aria-label="QQ 弹幕控制台">
              <header class="panel-header">
                ${brandMarkup()}
                <div class="header-actions">
                  <button class="icon-button" type="button" data-action="toggle-collapse" title="收起控制台" aria-label="收起控制台">
                    ${icon('panelClose')}
                  </button>
                  <button class="icon-button" type="button" data-action="quit" title="退出程序" aria-label="退出程序">
                    ${icon('power')}
                  </button>
                </div>
              </header>

              <section class="account-row">
                <span class="avatar" aria-hidden="true">${escapeHtml(initialOf(userName))}</span>
                <span class="account-copy">
                  <strong>${escapeHtml(userName)}</strong>
                  <small><span class="status-dot"></span>正在接收 QQ 通知</small>
                </span>
                <span class="live-badge"><span class="live-pulse"></span>LIVE</span>
              </section>

              ${errorBannerMarkup(state.monitorError, 'dismiss-monitor-error')}

              <section class="metrics-row" aria-label="本次会话统计">
                <div class="metric">
                  <span class="metric-label">本次消息</span>
                  <strong data-message-count>${state.receivedCount}</strong>
                </div>
                <div class="metric">
                  <span class="metric-label">当前状态</span>
                  <strong class="metric-status">监听中</strong>
                </div>
              </section>

              ${displaySettingsMarkup()}

              <div class="feed-heading">
                <div>
                  <span class="eyebrow">消息流</span>
                  <h2>实时通知</h2>
                </div>
                <button class="icon-button" type="button" data-action="clear-messages" title="清空本次消息" aria-label="清空本次消息" ${hasMessages ? '' : 'disabled'}>
                  ${icon('trash')}
                </button>
              </div>

              <section class="message-list" aria-live="polite">
                ${
                  hasMessages
                    ? state.messages.map(messageItemMarkup).join('')
                    : `
                      <div class="empty-state">
                        <span class="empty-icon">${icon('radio')}</span>
                        <strong>等待新消息</strong>
                      </div>
                    `
                }
              </section>

              <footer class="dashboard-footer">
                <button class="setting-toggle" type="button" role="switch" aria-checked="${state.backgroundMode}" data-action="toggle-background">
                  <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
                  <span>
                    <strong>后台悬浮</strong>
                    <small>${state.backgroundMode ? '已隐藏任务栏入口' : '显示在任务栏中'}</small>
                  </span>
                </button>
                <button class="text-button" type="button" data-action="logout">
                  ${icon('logout')}
                  <span>退出登录</span>
                </button>
              </footer>
            </section>
          `
      }

    </main>
  `;
}

function render() {
  overlayInteractionLocked = false;
  root.innerHTML = state.user ? dashboardView() : authView();
  observeOverlayPanel();
  syncOverlayArea({ retry: true });
}

let areaFrame = 0;
let panelResizeObserver = null;
let overlayInteractionLocked = false;
let overlayAreaHeartbeat = 0;
const areaRetryTimers = new Set();

function viewportOverlayArea() {
  const screenWidth = Math.max(
    window.innerWidth,
    window.screen?.width || 0,
    window.screen?.availWidth || 0,
  );
  const screenHeight = Math.max(
    window.innerHeight,
    window.screen?.height || 0,
    window.screen?.availHeight || 0,
  );

  // Wails 后端使用 DPI 虚拟化后的窗口坐标，这里不要再乘 devicePixelRatio。
  return {
    left: 0,
    top: 0,
    width: Math.ceil(screenWidth) + 200,
    height: Math.ceil(screenHeight) + 200,
    visible: true,
  };
}

function sendOverlayArea(area) {
  try {
    const request = bridge.setInteractiveArea(
      area.left,
      area.top,
      area.width,
      area.height,
      area.visible,
    );
    Promise.resolve(request).catch(() => {
      scheduleOverlayAreaReport(180);
    });
  } catch {
    scheduleOverlayAreaReport(180);
  }
}

function reportOverlayArea() {
  if (overlayInteractionLocked) return;

  // 平时只开放控制面板区域，其余透明区域继续让鼠标穿透到桌面。
  // 只有按下并拖动控制项时，才由 setOverlayInteractionLock 临时锁定整窗。
  const panel = document.querySelector('#control-panel');
  if (!panel) {
    sendOverlayArea({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      visible: false,
    });
    return;
  }

  const rect = panel.getBoundingClientRect();
  const padding = 14;
  const left = Math.max(0, Math.round(rect.left - padding));
  const top = Math.max(0, Math.round(rect.top - padding));
  const right = Math.min(
    Math.max(window.innerWidth, window.screen?.width || 0),
    Math.round(rect.right + padding),
  );
  const bottom = Math.min(
    Math.max(window.innerHeight, window.screen?.height || 0),
    Math.round(rect.bottom + padding),
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  sendOverlayArea({
    left,
    top,
    width,
    height,
    visible: width > 0 && height > 0,
  });
}

function scheduleOverlayAreaReport(delay) {
  const timer = window.setTimeout(() => {
    areaRetryTimers.delete(timer);
    reportOverlayArea();
  }, delay);
  areaRetryTimers.add(timer);
}

function syncOverlayArea({ retry = false } = {}) {
  window.cancelAnimationFrame(areaFrame);
  areaFrame = window.requestAnimationFrame(reportOverlayArea);
  if (retry) {
    areaRetryTimers.forEach((timer) => window.clearTimeout(timer));
    areaRetryTimers.clear();
    [90, 280, 650, 1200].forEach(scheduleOverlayAreaReport);
  }
}

function observeOverlayPanel() {
  panelResizeObserver?.disconnect();
  const panel = document.querySelector('#control-panel');
  if (!panel || typeof ResizeObserver !== 'function') return;

  panelResizeObserver = new ResizeObserver(() => syncOverlayArea());
  panelResizeObserver.observe(panel);
}

function startOverlayAreaHeartbeat() {
  window.clearInterval(overlayAreaHeartbeat);
  overlayAreaHeartbeat = window.setInterval(() => {
    if (!overlayInteractionLocked) reportOverlayArea();
  }, 700);
}

function setOverlayInteractionLock(enabled) {
  if (overlayInteractionLocked === enabled) return;
  overlayInteractionLocked = enabled;

  if (enabled) {
    // 拖动或点击期间临时扩大为整窗交互。
    sendOverlayArea(viewportOverlayArea());
    return;
  }

  syncOverlayArea({ retry: true });
}

function releaseOverlayInteractionLock() {
  setOverlayInteractionLock(false);
}

function setAuthMode(mode) {
  state.authMode = mode;
  state.authError = '';
  state.form.password = '';
  state.form.confirmPassword = '';
  render();
  window.requestAnimationFrame(() => {
    root.querySelector('input[name="username"]')?.focus();
  });
}

function validateAuth() {
  const username = state.form.username.trim();
  const password = state.form.password;

  if (!username) return '请输入用户名';
  if (!password) return '请输入密码';

  if (state.authMode === 'register') {
    if (password.length < 8 || password.length > 20) {
      return '密码长度必须在 8-20 位之间';
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      return '密码必须包含大写字母、小写字母和数字';
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      return '密码必须包含至少一个特殊字符';
    }
    if (password !== state.form.confirmPassword) {
      return '两次输入的密码不一致';
    }
  }

  return '';
}

async function submitAuth() {
  if (state.loading) return;

  const validationError = validateAuth();
  if (validationError) {
    state.authError = validationError;
    render();
    return;
  }

  state.loading = true;
  state.authError = '';
  render();

  try {
    const username = state.form.username.trim();
    const result =
      state.authMode === 'register'
        ? await bridge.register(username, state.form.password)
        : await bridge.login(username, state.form.password);

    if (!result?.success) {
      state.authError = result?.message || '操作未完成，请重试';
      return;
    }

    state.user = {
      id: result.user?.id ?? null,
      name: result.user?.user || username,
    };
    state.messages = [];
    state.receivedCount = 0;
    state.monitorError = '';
    state.collapsed = false;
    state.form.password = '';
    state.form.confirmPassword = '';
  } catch (error) {
    state.authError = error?.message || '无法连接应用后端';
  } finally {
    state.loading = false;
    render();
  }
}

async function logout() {
  try {
    await bridge.logout();
  } catch {
    // Local session cleanup still matters when the monitor has already stopped.
  }

  state.user = null;
  state.messages = [];
  clearDanmaku();
  state.receivedCount = 0;
  state.monitorError = '';
  state.collapsed = false;
  state.authMode = 'login';
  state.authError = '';
  state.form.username = '';
  state.form.password = '';
  state.form.confirmPassword = '';
  render();
}

async function toggleBackgroundMode() {
  const nextValue = !state.backgroundMode;
  try {
    await bridge.setBackgroundMode(nextValue);
    state.backgroundMode = nextValue;
    state.monitorError = '';
  } catch (error) {
    state.monitorError = error?.message || '无法切换后台模式';
  }
  render();
}

root.addEventListener('input', (event) => {
  const setting = event.target.closest('[data-setting]');
  if (setting) {
    setDisplaySetting(setting.dataset.setting, setting.value);
    return;
  }

  const field = event.target.closest('input[name]');
  if (!field) return;
  state.form[field.name] = field.value;
});

root.addEventListener(
  'pointerdown',
  () => setOverlayInteractionLock(true),
  true,
);
root.addEventListener('focusin', () => syncOverlayArea(), true);

root.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-form="auth"]')) return;
  event.preventDefault();
  submitAuth();
});

root.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  if (action === 'reset-display') {
    resetDisplaySettings();
    return;
  }

  if (action === 'auth-mode') {
    setAuthMode(target.dataset.mode);
    return;
  }

  if (action === 'toggle-password') {
    const input = root.querySelector(`input[name="${target.dataset.target}"]`);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    target.innerHTML = icon(showing ? 'eye' : 'eyeOff');
    target.title = showing ? '显示密码' : '隐藏密码';
    target.setAttribute('aria-label', target.title);
    return;
  }

  if (action === 'dismiss-error') {
    state.authError = '';
    render();
    return;
  }

  if (action === 'dismiss-monitor-error') {
    state.monitorError = '';
    render();
    return;
  }

  if (action === 'clear-messages') {
    state.messages = [];
    state.receivedCount = 0;
    clearDanmaku();
    render();
    return;
  }

  if (action === 'toggle-collapse') {
    state.collapsed = !state.collapsed;
    render();
    return;
  }

  if (action === 'toggle-background') {
    toggleBackgroundMode();
    return;
  }

  if (action === 'logout') {
    logout();
    return;
  }

  if (action === 'quit') {
    if (previewMode) {
      state.user = null;
      render();
      return;
    }
    try {
      Quit();
    } catch (error) {
      console.error(error);
    }
  }
});

function handleViewportChange() {
  syncOverlayArea({ retry: true });
  refreshDanmakuLayout();
}

window.addEventListener('resize', handleViewportChange);
window.addEventListener('focus', () => syncOverlayArea({ retry: true }));
window.addEventListener('blur', releaseOverlayInteractionLock);
window.addEventListener('pointerup', releaseOverlayInteractionLock, true);
window.addEventListener('pointercancel', releaseOverlayInteractionLock, true);
window.addEventListener('mouseup', releaseOverlayInteractionLock, true);
window.visualViewport?.addEventListener('resize', handleViewportChange);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    syncOverlayArea({ retry: true });
  } else {
    releaseOverlayInteractionLock();
  }
});
document.fonts?.ready.then(handleViewportChange);

if (previewMode) {
  document.body.classList.add('preview-surface');
  if (previewMode === 'dashboard') {
    state.user = { id: 1, name: '林知夏' };
    state.receivedCount = 18;
    state.messages = [
      {
        key: 'preview-1',
        notificationId: 'preview-1',
        title: '产品设计组',
        time: '2026-10-21 18:42:18',
        body: '新版弹幕样式已经更新，今晚一起看下实际效果。',
      },
      {
        key: 'preview-2',
        notificationId: 'preview-2',
        title: '陈默',
        time: '2026-10-21 18:39:06',
        body: '收到，我把演示视频放到共享盘了。',
      },
      {
        key: 'preview-3',
        notificationId: 'preview-3',
        title: '项目协作群',
        time: '2026-10-21 18:31:44',
        body: '本周评审改到周四下午三点，请提前准备材料。',
      },
    ];
  }
}

installBackendEvents();
applyDisplaySettings();
render();
startOverlayAreaHeartbeat();
if (previewMode === 'dashboard') {
  state.messages.slice(0, 3).forEach((message, index) => {
    window.setTimeout(() => launchDanmaku(message), index * 240);
  });
}
