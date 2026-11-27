/**
 * API 冒烟测试 —— 不用 Flutter，直接验证后端全流程
 * 用法：先启动 server\start.cmd，再运行 scripts\smoke.cmd
 */
const { spawn, execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SPAWN = process.argv.includes('--spawn');
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';

/**
 * 读取 server/.env 里的键值（不引入额外依赖）。
 * 仓库是公开的，所以账号密码只存在于本地 .env，不进源码。
 * 找不到 .env 时回落到环境变量，再回落到服务端 main.ts 的开发默认值。
 */
function loadServerEnv() {
  const envPath = path.join(__dirname, '..', 'server', '.env');
  const out = {};
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* 没有 .env 就用默认值 */ }
  return out;
}

const SERVER_ENV = loadServerEnv();
const USER_A = {
  username: SERVER_ENV.USER_A_USERNAME ?? process.env.USER_A_USERNAME ?? 'a',
  password: SERVER_ENV.USER_A_PASSWORD ?? process.env.USER_A_PASSWORD ?? 'a123456',
};
const USER_B = {
  username: SERVER_ENV.USER_B_USERNAME ?? process.env.USER_B_USERNAME ?? 'b',
  password: SERVER_ENV.USER_B_PASSWORD ?? process.env.USER_B_PASSWORD ?? 'b123456',
};

let serverProc = null;

// 本地 PostgreSQL 位置（仅 --spawn 模式自动拉起数据库时用）。
// 别人克隆后请用环境变量覆盖，或直接手动启动数据库后不要加 --spawn。
const PG_BIN = process.env.PG_BIN ?? 'D:\\learn\\pgsql\\pgsql\\bin';
const PG_DATA = process.env.PG_DATA ?? 'D:\\learn\\pgdata';
const PG_PORT = Number(process.env.PG_PORT ?? 5433);

/** 检查数据库是否在监听 */
function isDbUp() {
  const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoProfile', '-Command',
    'if (Get-NetTCPConnection -LocalPort ' + PG_PORT + ' -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
  ], { timeout: 20000 });
  return r.status === 0;
}

/**
 * 确保数据库在跑。
 * 用 PowerShell Start-Process 而不是 spawn —— 后者起的进程会被父进程回收。
 */
function ensureDb() {
  if (isDbUp()) return true;

  console.log('  (database not running, starting PostgreSQL...)');
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const cmd = [
    "Start-Process -FilePath '" + PG_BIN + "\\\\postgres.exe'",
    "-ArgumentList '-D','" + PG_DATA + "','-p','" + PG_PORT + "'",
    "-WindowStyle Hidden",
    "-RedirectStandardError '" + PG_DATA + "\\\\err.log'",
    "-RedirectStandardOutput '" + PG_DATA + "\\out.log'",
  ].join(' ');
  spawnSync(ps, ['-NoProfile', '-Command', cmd], { timeout: 30000 });

  // 等它起来（最多 15 秒）
  for (let i = 0; i < 30; i++) {
    if (isDbUp()) {
      console.log('  database ready');
      return true;
    }
    spawnSync(ps, ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], { timeout: 5000 });
  }
  return false;
}


/** 启动内置服务（--spawn 模式） */
async function startServer() {
  if (!ensureDb()) {
    console.log('  database failed to start');
    return false;
  }
  const serverDir = path.join(__dirname, '..', 'server');
  serverProc = spawn('node', ['dist/src/main.js'], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/love_stars?schema=public',
      PORT: '3000',
      JWT_SECRET: 'dev-secret-change-me',
    },
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => process.stderr.write(d));

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return true;
    } catch { /* retry */ }
  }
  return false;
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
    serverProc = null;
  }
}

const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

let pass = 0, fail = 0;

function ok(msg) { console.log(c.green + '  PASS ' + c.reset + msg); pass++; }
function bad(msg, detail) {
  console.log(c.red + '  FAIL ' + c.reset + msg);
  if (detail) console.log(c.dim + '       ' + detail + c.reset);
  fail++;
}
function step(msg) { console.log('\n' + c.cyan + '> ' + msg + c.reset); }
function info(msg) { console.log(c.dim + '  ' + msg + c.reset); }

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function main() {
  console.log(c.yellow + 'Love Stars - API Smoke Test' + c.reset);
  console.log(c.dim + 'Base: ' + BASE + c.reset);

  if (SPAWN) {
    console.log(c.dim + '  (starting built-in server...)' + c.reset);
    const okStart = await startServer();
    if (!okStart) {
      console.log(c.red + '  failed to start server' + c.reset);
      process.exit(1);
    }
    console.log(c.dim + '  server ready' + c.reset);
  }

  // ---------- 0. 健康检查 ----------
  step('0. Health check');
  const h = await api('/health');
  if (h.status === 200 && h.body?.data?.ledger?.ok === true) {
    ok('server up, ledger sum = 0');
    info('circulating=' + h.body.data.ledger.circulating + ' netIssued=' + h.body.data.ledger.netIssued);
  } else {
    bad('health check failed', JSON.stringify(h.body));
    console.log(c.red + '\n  Is the server running?  Run server\\start.cmd first.\n' + c.reset);
    process.exit(1);
  }

  // ---------- 1. 登录 ----------
  step('1. Login');
  const la = await api('/auth/login', { method: 'POST', body: { username: USER_A.username, password: USER_A.password } });
  const lb = await api('/auth/login', { method: 'POST', body: { username: USER_B.username, password: USER_B.password } });
  if (la.body?.data?.accessToken && lb.body?.data?.accessToken) {
    ok('both accounts logged in');
  } else {
    bad('login failed', JSON.stringify(la.body));
    process.exit(1);
  }
  const ta = la.body.data.accessToken;
  const tb = lb.body.data.accessToken;

  const wrong = await api('/auth/login', { method: 'POST', body: { username: USER_A.username, password: 'wrong' } });
  if (wrong.status === 401) ok('wrong password rejected (401)');
  else bad('wrong password should be 401, got ' + wrong.status);

  // ---------- 2. 余额 ----------
  step('2. Wallet');
  const wa = await api('/wallet', { token: ta });
  const wb = await api('/wallet', { token: tb });
  if (typeof wa.body?.data?.balance === 'number') {
    ok('A balance = ' + wa.body.data.balance + ' (escrowed ' + wa.body.data.escrowed + ')');
    ok('B balance = ' + wb.body.data.balance);
  } else bad('wallet failed');

  // ---------- 3. 签到 ----------
  step('3. Check-in');
  const ci1 = await api('/checkin', { method: 'POST', token: ta });
  if (ci1.status === 200 && ci1.body.data.gained > 0) {
    ok('checked in, +' + ci1.body.data.gained + ' star, streak=' + ci1.body.data.streak);
  } else if (ci1.status === 409) {
    info('already checked in today (normal if you ran this before)');
  } else {
    bad('checkin failed', JSON.stringify(ci1.body));
  }
  const ci2 = await api('/checkin', { method: 'POST', token: ta });
  if (ci2.status === 409) ok('duplicate check-in rejected (409)');
  else bad('duplicate check-in should be 409');

  // ---------- 4. 物品 ----------
  step('4. Items');
  const items = await api('/items', { token: ta });
  if (items.body?.data?.length > 0) {
    ok(items.body.data.length + ' items listed');
    for (const it of items.body.data.slice(0, 3)) {
      info(it.emoji + ' ' + it.name + '  ' + it.priceStars + ' stars');
    }
  } else bad('no items');

  // ---------- 5. 发布任务 ----------
  step('5. Publish task');
  const balBefore = (await api('/wallet', { token: ta })).body.data.balance;
  const pub = await api('/tasks', {
    method: 'POST', token: ta,
    body: { title: '冒烟测试任务', reward: 3 },
    idem: 'smoke-' + Date.now(),
  });
  if (pub.status === 200) {
    const balAfter = (await api('/wallet', { token: ta })).body.data.balance;
    ok('task published: ' + pub.body.data.id.slice(0, 8));
    if (balAfter === balBefore - 3) ok('stars deducted immediately (' + balBefore + ' -> ' + balAfter + ')');
    else bad('balance should drop by 3', balBefore + ' -> ' + balAfter);
  } else {
    bad('publish failed', JSON.stringify(pub.body));
  }
  const taskId = pub.body?.data?.id;

  // ---------- 6. 余额不足 ----------
  step('6. Insufficient balance');
  const poor = await api('/tasks', { method: 'POST', token: ta, body: { title: 'too expensive', reward: 99999 } });
  if (poor.status === 409 && poor.body?.error?.code === 'STARS_INSUFFICIENT') {
    ok('rejected with STARS_INSUFFICIENT');
  } else bad('should reject with STARS_INSUFFICIENT, got ' + poor.status);

  // ---------- 7. 任务流程 ----------
  if (taskId) {
    step('7. Task flow: accept -> submit -> confirm');
    const acc = await api('/tasks/' + taskId + '/accept', { method: 'POST', token: tb });
    if (acc.body?.data?.status === 'accepted') ok('B accepted');
    else bad('accept failed', JSON.stringify(acc.body));

    const sub = await api('/tasks/' + taskId + '/submit', { method: 'POST', token: tb });
    if (sub.body?.data?.status === 'submitted') ok('B submitted');
    else bad('submit failed', JSON.stringify(sub.body));

    const bBefore = (await api('/wallet', { token: tb })).body.data.balance;
    const conf = await api('/tasks/' + taskId + '/confirm', { method: 'POST', token: ta });
    if (conf.body?.data?.status === 'confirmed') ok('A confirmed');
    else bad('confirm failed', JSON.stringify(conf.body));

    const bAfter = (await api('/wallet', { token: tb })).body.data.balance;
    if (bAfter === bBefore + 3) ok('B received 3 stars (' + bBefore + ' -> ' + bAfter + ')');
    else bad('B should gain 3', bBefore + ' -> ' + bAfter);

    const twice = await api('/tasks/' + taskId + '/confirm', { method: 'POST', token: ta });
    if (twice.status === 409) ok('double confirm rejected (409)');
    else bad('double confirm should be 409');
  }

  // ---------- 8. 兑换 ----------
  step('8. Redeem item');
  const balA = (await api('/wallet', { token: ta })).body.data.balance;
  const balB = (await api('/wallet', { token: tb })).body.data.balance;
  const rd = await api('/redemptions', {
    method: 'POST', token: ta,
    body: { itemId: 'hug', quantity: 1, note: 'smoke test' },
    idem: 'smoke-rd-' + Date.now(),
  });
  if (rd.status === 200) {
    ok('redeemed ' + rd.body.data.itemName + ' for ' + rd.body.data.totalStars + ' stars');
    const a2 = (await api('/wallet', { token: ta })).body.data.balance;
    const b2 = (await api('/wallet', { token: tb })).body.data.balance;
    if (a2 === balA - rd.body.data.totalStars) ok('A paid ' + rd.body.data.totalStars + ' (' + balA + ' -> ' + a2 + ')');
    else bad('A balance wrong', balA + ' -> ' + a2);
    if (b2 === balB) ok('B unchanged (stars destroyed, not transferred)');
    else bad('B should be unchanged', balB + ' -> ' + b2);
  } else {
    bad('redeem failed', JSON.stringify(rd.body));
  }
  const rdId = rd.body?.data?.id;

  // ---------- 9. 兑换幂等 ----------
  step('9. Redeem idempotency');
  const key = 'smoke-idem-' + Date.now();
  const r1 = await api('/redemptions', { method: 'POST', token: ta, body: { itemId: 'hug', quantity: 1 }, idem: key });
  const bal1 = (await api('/wallet', { token: ta })).body.data.balance;
  const r2 = await api('/redemptions', { method: 'POST', token: ta, body: { itemId: 'hug', quantity: 1 }, idem: key });
  const bal2 = (await api('/wallet', { token: ta })).body.data.balance;
  if (r1.body?.data?.id === r2.body?.data?.id && bal1 === bal2) {
    ok('same idempotency key -> same result, no double charge');
  } else {
    bad('idempotency broken', bal1 + ' -> ' + bal2);
  }

  // ---------- 10. 待我兑现 ----------
  step('10. Inbox');
  const inbox = await api('/redemptions?scope=inbox', { token: tb });
  if (inbox.body?.data?.length > 0) {
    ok(inbox.body.data.length + ' pending redemption(s) for B');
  } else bad('inbox should not be empty');

  // ---------- 11. 兑现 ----------
  if (rdId) {
    step('11. Fulfill');

    // 照片必须是本服务上传的媒体，先真传一张 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----smoke' + Date.now();
    const head = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="photo"; filename="t.png"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    );
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const upload = await fetch(BASE + '/media', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + tb, 'content-type': 'multipart/form-data; boundary=' + boundary },
      body: Buffer.concat([head, png, tail]),
    });
    const uploaded = await upload.json();
    const photoUrl = uploaded?.data?.url;
    if (photoUrl) ok('photo uploaded: ' + photoUrl);
    else bad('upload failed', JSON.stringify(uploaded));

    const noPhoto = await api('/redemptions/' + rdId + '/fulfill', { method: 'POST', token: tb, body: {} });
    if (noPhoto.status === 400 && noPhoto.body?.error?.code === 'REDEMPTION_PHOTO_REQUIRED') {
      ok('photo required (400 REDEMPTION_PHOTO_REQUIRED)');
    } else bad('should require photo, got ' + noPhoto.status);

    // 外站 URL 必须被拒绝
    const foreign = await api('/redemptions/' + rdId + '/fulfill', {
      method: 'POST', token: tb, body: { photoUrl: 'https://example.com/test.jpg' },
    });
    if (foreign.status === 400) ok('foreign photo URL rejected');
    else bad('should reject foreign photo URL, got ' + foreign.status);

    const ff = await api('/redemptions/' + rdId + '/fulfill', {
      method: 'POST', token: tb, body: { photoUrl, note: 'done' },
    });
    if (ff.body?.data?.status === 'fulfilled') ok('fulfilled');
    else bad('fulfill failed', JSON.stringify(ff.body));

    const again = await api('/redemptions/' + rdId + '/fulfill', {
      method: 'POST', token: tb, body: { photoUrl },
    });
    if (again.body?.data?.photoUrl === photoUrl) ok('idempotent, photo not overwritten');
    else bad('fulfill not idempotent');
  }

  // ---------- 12. 催一催 ----------
  step('12. Nudge');
  const inbox2 = await api('/redemptions?scope=inbox', { token: tb });
  const pendingOne = inbox2.body?.data?.[0];
  if (pendingOne) {
    const n1 = await api('/redemptions/' + pendingOne.id + '/nudge', { method: 'POST', token: ta });
    if (n1.status === 200) ok('nudged');
    else bad('nudge failed', JSON.stringify(n1.body));
    const n2 = await api('/redemptions/' + pendingOne.id + '/nudge', { method: 'POST', token: ta });
    if (n2.status === 429) ok('second nudge within 24h rejected (429)');
    else bad('should be rate limited, got ' + n2.status);
  } else info('no pending redemption to nudge');

  // ---------- 13. 对账 ----------
  step('13. Reconcile');
  const rec = await api('/reconcile', { token: ta });
  const r = rec.body?.data;
  if (r?.ok === true && r.sum === 0) {
    ok('sum(balance) = 0');
    info('circulating=' + r.circulating + ' escrowed=' + r.escrowed);
    info('netIssued=' + r.netIssued + ' totalIssued=' + r.totalIssued + ' burned=' + r.burned);
    if (r.netIssued === r.totalIssued - r.burned) ok('netIssued = totalIssued - burned');
    else bad('accounting mismatch');
  } else {
    bad('reconcile failed', JSON.stringify(r));
  }

  // ---------- 14. 鉴权 ----------
  step('14. Auth guard');
  const noTok = await api('/wallet');
  if (noTok.status === 401) ok('no token -> 401');
  else bad('should be 401');
  const badTok = await api('/wallet', { token: 'garbage' });
  if (badTok.status === 401) ok('invalid token -> 401');
  else bad('should be 401');

  // ---------- 汇总 ----------
  console.log('\n' + '='.repeat(46));
  console.log(c.green + '  PASS: ' + pass + c.reset + '   ' + (fail ? c.red : c.dim) + 'FAIL: ' + fail + c.reset);
  console.log('='.repeat(46));
  if (fail === 0) console.log(c.green + '\n  All good! Backend works end to end.\n' + c.reset);
  else console.log(c.red + '\n  ' + fail + ' check(s) failed.\n' + c.reset);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(c.red + '\nCrashed: ' + e.message + c.reset);
    process.exitCode = 1;
  })
  .finally(() => {
    if (SPAWN) stopServer();
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });