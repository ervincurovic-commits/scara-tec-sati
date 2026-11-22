// Drives headless Chrome over CDP: logs in per role, visits every tab in
// dark/light and bs/sl, records console errors and screenshots.
import { writeFileSync } from 'node:fs';

const SHOTS = process.env.QA_SHOTS || '/tmp/scara-qa/';
const BASE = 'http://localhost:5183/';

const tab = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(`EXC ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    errors.push(`${msg.params.type} ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(`log ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'eval error');
  return res.result?.result?.value;
};
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${SHOTS}${name}.png`, Buffer.from(res.result.data, 'base64'));
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const goto = async (url) => {
  await send('Page.navigate', { url });
  await sleep(1800);
};

const login = async (user) => {
  await evalJs(`localStorage.removeItem('scara_tec_session'); true`);
  await goto(BASE);
  await evalJs(`(() => {
    document.getElementById('loginUsername').value = ${JSON.stringify(user)};
    document.getElementById('loginPassword').value = 'test1234';
    document.getElementById('loginForm').requestSubmit();
    return true; })()`);
  await sleep(2200);
};

const setPrefs = async (theme, lang) => {
  await evalJs(`localStorage.setItem('scara_theme', ${JSON.stringify(theme)}); localStorage.setItem('scara_lang', ${JSON.stringify(lang)}); true`);
};

const clickNav = async (view) => {
  await evalJs(`document.querySelector('[data-action="nav"][data-view="${view}"]').click(); true`);
  await sleep(1300);
};

const report = [];
const check = async (label) => {
  const info = await evalJs(`(() => {
    const vis = (id) => !document.getElementById(id).classList.contains('hidden');
    const missing = [...document.querySelectorAll('[data-i18n]')].filter(e => e.offsetParent && !e.textContent.trim()).map(e => e.dataset.i18n);
    const rawKeys = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.offsetParent && /^[a-z]+\\.[a-zA-Z.]+$/.test(e.textContent.trim())).map(e => e.textContent.trim());
    return {
      login: vis('loginScreen'), app: vis('appScreen'),
      badge: document.getElementById('headerRoleBadge').innerText,
      err: document.getElementById('loginErrorMsg').innerText,
      theme: document.documentElement.dataset.theme, lang: document.documentElement.lang,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      missing: [...new Set(missing)].slice(0, 8), rawKeys: [...new Set(rawKeys)].slice(0, 8),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  })()`);
  report.push({ label, ...info });
};

for (const [theme, lang] of [['dark', 'bs'], ['light', 'sl']]) {
  await goto(BASE);
  await setPrefs(theme, lang);
  await goto(BASE);
  await evalJs(`localStorage.removeItem('scara_tec_session'); true`);
  await goto(BASE);
  await check(`${theme}-${lang} login`);
  await shot(`${theme}-${lang}-0-login`);

  await login('admin');
  await check(`${theme}-${lang} admin sites`);
  await shot(`${theme}-${lang}-1-admin-sites`);
  await clickNav('admin-db');
  await check(`${theme}-${lang} admin db`);
  await shot(`${theme}-${lang}-2-admin-db`);
  await clickNav('directory');
  await shot(`${theme}-${lang}-3-directory`);
  await evalJs(`document.querySelector('[data-action="logout"]').click(); true`);
  await sleep(800);

  await login('baulajter');
  await check(`${theme}-${lang} bau weekly`);
  await shot(`${theme}-${lang}-4-bau-weekly`);
  await clickNav('bau-my');
  await shot(`${theme}-${lang}-5-bau-my`);
  await clickNav('bau-projects');
  await check(`${theme}-${lang} bau projects`);
  await shot(`${theme}-${lang}-6-bau-projects`);
  await evalJs(`document.querySelector('[data-action="logout"]').click(); true`);
  await sleep(800);

  await login('marko');
  await check(`${theme}-${lang} radnik`);
  await shot(`${theme}-${lang}-7-radnik`);
  await evalJs(`document.querySelector('[data-action="logout"]').click(); true`);
  await sleep(800);
}

// Interaction: leader toggles 10h for travel on Thursday of first person, value persists after reload.
await goto(BASE);
await setPrefs('dark', 'bs');
await login('baulajter');
const before = await evalJs(`document.getElementById('bauTotalWeeklyHours').innerText`);
await evalJs(`document.querySelectorAll('[data-action="bau-quick"][data-type="travel"]')[3].click(); true`);
await sleep(1200);
const after = await evalJs(`document.getElementById('bauTotalWeeklyHours').innerText`);
await goto(BASE);
await sleep(800);
const afterReload = await evalJs(`document.getElementById('bauTotalWeeklyHours').innerText`);
report.push({ label: 'toggle travel persists', before, after, afterReload });
// undo
await evalJs(`document.querySelectorAll('[data-action="bau-quick"][data-type="travel"]')[3].click(); true`);
await sleep(1200);

// Theme toggle button live
await evalJs(`document.querySelector('#appScreen [data-action="toggle-theme"]').click(); true`);
await sleep(300);
report.push({ label: 'theme toggle', theme: await evalJs(`document.documentElement.dataset.theme`) });
await evalJs(`document.querySelector('#appScreen [data-action="toggle-theme"]').click(); true`);

// Mobile width
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await goto(BASE);
await shot('mobile-bau-weekly');
await check('mobile bau weekly');
await evalJs(`localStorage.removeItem('scara_tec_session'); true`);
await goto(BASE);
await shot('mobile-login');

// Bad login
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await evalJs(`(() => { document.getElementById('loginUsername').value='admin'; document.getElementById('loginPassword').value='wrong'; document.getElementById('loginForm').requestSubmit(); return true; })()`);
await sleep(1500);
await check('bad login');

console.log(JSON.stringify(report, null, 1));
console.log('ERRORS:', JSON.stringify([...new Set(errors)], null, 1));
ws.close();
