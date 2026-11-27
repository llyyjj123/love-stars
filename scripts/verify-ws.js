
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

/**
 * 读取 server/.env 里的键值。
 * 仓库是公开的，账号密码只存在本地 .env，不进源码。
 */
function loadServerEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', 'server', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 无 .env 时用默认值 */ }
  return out;
}

const SERVER_ENV = loadServerEnv();
const USER_A = {
  username: SERVER_ENV.USER_A_USERNAME ?? 'a',
  password: SERVER_ENV.USER_A_PASSWORD ?? 'a123456',
};
const USER_B = {
  username: SERVER_ENV.USER_B_USERNAME ?? 'b',
  password: SERVER_ENV.USER_B_PASSWORD ?? 'b123456',
};

const BASE = 'http://127.0.0.1:3000/api/v1';
const WS = 'ws://127.0.0.1:3000/ws?token=';
const serverDir = path.join(__dirname, 'server');

function startServer() {
  // 用 cmd 包一层，绕开 spawn ENOENT
  return spawn('cmd', ['/c', 'node', 'dist\\src\\main.js'], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: 'postgresql://postgres@127.0.0.1:5433/love_stars?schema=public', PORT: '3000' },
  });
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try { const res = await fetch(BASE + '/health'); if (res.ok) return true; } catch {}
  }
  return false;
}

async function login(u, p) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  }).then((x) => x.json());
  return r.data.accessToken;
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const box = [];
    const ws = new WebSocket(WS + encodeURIComponent(token));
    ws.addEventListener('message', (e) => box.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve({ ws, box }));
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}

async function waitFor(box, pred, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = box.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

(async () => {
  const proc = startServer();
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.stdout.on('data', () => {});

  try {
    if (!(await waitReady())) {
      console.log('server failed to start');
      console.log(stderr.slice(0, 800));
      process.exit(1);
    }
    console.log('0. server up');

    const ta = await login(USER_A.username, USER_A.password);
    const tb = await login(USER_B.username, USER_B.password);
    console.log('1. both logged in');

    const a = await connectWs(ta);
    const b = await connectWs(tb);
    await waitFor(a.box, (m) => m.type === 'hello');
    await waitFor(b.box, (m) => m.type === 'hello');
    console.log('2. both WS connected (hello received)');

    a.box.length = 0; b.box.length = 0;

    const rd = await fetch(BASE + '/redemptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ta, 'idempotency-key': 'ws-' + Date.now() },
      body: JSON.stringify({ itemId: 'hug', quantity: 1, note: 'ws test' }),
    }).then((x) => x.json());

    if (!rd.ok) { console.log('   redeem failed:', JSON.stringify(rd.error)); process.exit(1); }
    console.log('3. A redeemed:', rd.data.itemName, rd.data.totalStars, 'stars');

    const bGot = await waitFor(b.box, (m) => m.event === 'redemption.created');
    console.log('4. B received redemption.created:', bGot ? 'YES' : 'NO');
    if (bGot) console.log('   payload:', JSON.stringify(bGot.payload));

    await new Promise((r) => setTimeout(r, 600));
    const aGot = a.box.find((m) => m.event === 'redemption.created');
    console.log('5. A must NOT receive it:', aGot ? 'WRONG' : 'CORRECT');

    a.box.length = 0; b.box.length = 0;
    await fetch(BASE + '/redemptions/' + rd.data.id + '/fulfill', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tb },
      body: JSON.stringify({ photoUrl: 'https://example.com/ws.jpg', note: 'done' }),
    });
    const aFulfilled = await waitFor(a.box, (m) => m.event === 'redemption.fulfilled');
    console.log('6. A received redemption.fulfilled:', aFulfilled ? 'YES' : 'NO');

    a.box.length = 0; b.box.length = 0;
    const rd2 = await fetch(BASE + '/redemptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ta, 'idempotency-key': 'ws2-' + Date.now() },
      body: JSON.stringify({ itemId: 'hug', quantity: 1 }),
    }).then((x) => x.json());
    await waitFor(b.box, (m) => m.event === 'redemption.created');
    b.box.length = 0;

    await fetch(BASE + '/redemptions/' + rd2.data.id + '/nudge', {
      method: 'POST', headers: { authorization: 'Bearer ' + ta },
    });
    const bNudge = await waitFor(b.box, (m) => m.event === 'redemption.nudged');
    console.log('7. B received redemption.nudged:', bNudge ? 'YES' : 'NO');

    a.ws.close(); b.ws.close();
    console.log('');
    console.log('=== WebSocket 全链路验证完成 ===');
  } finally {
    proc.kill();
    setTimeout(() => process.exit(0), 300);
  }
})();