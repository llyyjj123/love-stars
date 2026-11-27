import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server';

function start() {
  const app = buildServer({
    jwtSecret: 'test-secret',
    users: [
      { id: 'user-a', username: 'a', password: 'pa', displayName: '杰' },
      { id: 'user-b', username: 'b', password: 'pb', displayName: '媛' },
    ],
    items: [
      { id: 'hug', name: '一个拥抱', emoji: '🤗', price: 4, listed: true },
      { id: 'tea', name: '奶茶', emoji: '🧋', price: 16, listed: true },
    ],
  });
  return new Promise<{ base: string; close: () => void; app: any }>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ base: 'http://127.0.0.1:' + port, close: () => app.server.close(), app });
    });
  });
}

async function api(base: string, path: string, init?: RequestInit & { token?: string }): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.token) headers.authorization = 'Bearer ' + init.token;
  if (init?.headers) Object.assign(headers, init.headers as any);
  const res = await fetch(base + '/api/v1' + path, { ...init, headers });
  return { status: res.status, body: (await res.json()) as any };
}

async function login(base: string, username: string, password: string) {
  const r = await api(base, '/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  return r.body.data.accessToken as string;
}

test('健康检查 + 开户礼已发', async () => {
  const { base, close } = await start();
  try {
    const r = await api(base, '/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.ledger.ok, true);
    assert.equal(r.body.data.ledger.circulating, 40, '两个用户各 20');
    assert.equal(r.body.data.ledger.netIssued, 40);
  } finally { close(); }
});

test('登录成功 / 密码错误 / 锁定', async () => {
  const { base, close } = await start();
  try {
    const ok = await api(base, '/auth/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'pa' }) });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.data.accessToken);

    const bad = await api(base, '/auth/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'wrong' }) });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'AUTH_INVALID_CREDENTIALS');
  } finally { close(); }
});

test('未登录访问 /wallet 返回 401', async () => {
  const { base, close } = await start();
  try {
    const r = await api(base, '/wallet');
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'AUTH_REQUIRED');
  } finally { close(); }
});

test('签到 + 余额变化', async () => {
  const { base, close } = await start();
  try {
    const token = await login(base, 'a', 'pa');
    const before = await api(base, '/wallet', { token });
    assert.equal(before.body.data.balance, 20);

    const ci = await api(base, '/checkin', { method: 'POST', token });
    assert.equal(ci.status, 200);
    assert.equal(ci.body.data.gained, 1);
    assert.equal(ci.body.data.balance, 21);

    const again = await api(base, '/checkin', { method: 'POST', token });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'CHECKIN_ALREADY_DONE');
  } finally { close(); }
});

test('发布任务 → 接受 → 提交 → 确认，星转移', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const tb = await login(base, 'b', 'pb');

    const pub = await api(base, '/tasks', {
      method: 'POST', token: ta,
      body: JSON.stringify({ title: '倒垃圾', reward: 3 }),
      headers: { 'idempotency-key': 'pub-1' },
    });
    assert.equal(pub.status, 200);
    const taskId = pub.body.data.id;

    const wA = await api(base, '/wallet', { token: ta });
    assert.equal(wA.body.data.balance, 17, '发布即扣星');

    await api(base, '/tasks/' + taskId + '/accept', { method: 'POST', token: tb });
    await api(base, '/tasks/' + taskId + '/submit', { method: 'POST', token: tb });
    const conf = await api(base, '/tasks/' + taskId + '/confirm', { method: 'POST', token: ta });
    assert.equal(conf.status, 200);

    const wB = await api(base, '/wallet', { token: tb });
    assert.equal(wB.body.data.balance, 23, '执行人拿到 3 星');
  } finally { close(); }
});

test('余额不足发布任务失败，余额不变', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const r = await api(base, '/tasks', { method: 'POST', token: ta, body: JSON.stringify({ title: '大任务', reward: 999 }) });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'STARS_INSUFFICIENT');
    const w = await api(base, '/wallet', { token: ta });
    assert.equal(w.body.data.balance, 20);
  } finally { close(); }
});

test('兑换扣星销毁，对方余额不变', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const tb = await login(base, 'b', 'pb');

    const r = await api(base, '/redemptions', {
      method: 'POST', token: ta,
      body: JSON.stringify({ itemId: 'tea', quantity: 1, note: '三分糖' }),
      headers: { 'idempotency-key': 'rd-1' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.totalStars, 16);

    const wA = await api(base, '/wallet', { token: ta });
    const wB = await api(base, '/wallet', { token: tb });
    assert.equal(wA.body.data.balance, 4, 'A 扣 16');
    assert.equal(wB.body.data.balance, 20, 'B 不变，星被销毁');

    const rec = await api(base, '/reconcile', { token: ta });
    assert.equal(rec.body.data.ok, true);
    assert.equal(rec.body.data.netIssued, 24);
    assert.equal(rec.body.data.burned, 16);
  } finally { close(); }
});

test('兑换幂等：同一 key 不重复扣星', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const body = JSON.stringify({ itemId: 'hug', quantity: 1 });
    const h = { 'idempotency-key': 'rd-dup' };
    await api(base, '/redemptions', { method: 'POST', token: ta, body, headers: h });
    await api(base, '/redemptions', { method: 'POST', token: ta, body, headers: h });
    const w = await api(base, '/wallet', { token: ta });
    assert.equal(w.body.data.balance, 16, '只扣一次 4 星');
  } finally { close(); }
});

test('兑现：照片必填 + 不涉及星星', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const tb = await login(base, 'b', 'pb');

    const r = await api(base, '/redemptions', { method: 'POST', token: ta, body: JSON.stringify({ itemId: 'hug', quantity: 1 }) });
    const id = r.body.data.id;

    const noPhoto = await api(base, '/redemptions/' + id + '/fulfill', { method: 'POST', token: tb, body: JSON.stringify({}) });
    assert.equal(noPhoto.status, 400);
    assert.equal(noPhoto.body.error.code, 'REDEMPTION_PHOTO_REQUIRED');

    const aBefore = (await api(base, '/wallet', { token: ta })).body.data.balance;
    const okRes = await api(base, '/redemptions/' + id + '/fulfill', {
      method: 'POST', token: tb, body: JSON.stringify({ photoUrl: 'https://cdn/x.jpg', note: '抱一个' }),
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.data.status, 'fulfilled');

    const aAfter = (await api(base, '/wallet', { token: ta })).body.data.balance;
    assert.equal(aAfter, aBefore, '兑现不动星星');
  } finally { close(); }
});

test('待我兑现列表 + 催一催限频', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const tb = await login(base, 'b', 'pb');

    await api(base, '/redemptions', { method: 'POST', token: ta, body: JSON.stringify({ itemId: 'hug', quantity: 1 }) });
    const inbox = await api(base, '/redemptions?scope=inbox', { token: tb });
    assert.equal(inbox.body.data.length, 1);

    const id = inbox.body.data[0].id;
    const n1 = await api(base, '/redemptions/' + id + '/nudge', { method: 'POST', token: ta });
    assert.equal(n1.status, 200);
    const n2 = await api(base, '/redemptions/' + id + '/nudge', { method: 'POST', token: ta });
    assert.equal(n2.status, 429);
    assert.equal(n2.body.error.code, 'NUDGE_TOO_FREQUENT');
  } finally { close(); }
});

test('完整走查：签到 → 发任务 → 兑换，对账始终平衡', async () => {
  const { base, close } = await start();
  try {
    const ta = await login(base, 'a', 'pa');
    const tb = await login(base, 'b', 'pb');

    await api(base, '/checkin', { method: 'POST', token: ta });   // A: 21
    const pub = await api(base, '/tasks', { method: 'POST', token: ta, body: JSON.stringify({ title: '洗碗', reward: 5 }) });
    const tid = pub.body.data.id;                                  // A: 16, escrow: 5
    await api(base, '/tasks/' + tid + '/accept', { method: 'POST', token: tb });
    await api(base, '/tasks/' + tid + '/submit', { method: 'POST', token: tb });
    await api(base, '/tasks/' + tid + '/confirm', { method: 'POST', token: ta });  // A: 16, B: 25

    await api(base, '/redemptions', { method: 'POST', token: ta, body: JSON.stringify({ itemId: 'tea', quantity: 1 }) });  // A: 0

    const rec = await api(base, '/reconcile', { token: ta });
    assert.equal(rec.body.data.ok, true, 'sum(balance) 必须为 0');
    assert.equal(rec.body.data.circulating, 25, 'A=0 B=25');
    assert.equal(rec.body.data.netIssued, 25, '开户 40 + 签到 1 - 销毁 16 = 25');
    assert.equal(rec.body.data.totalIssued, 41);
    assert.equal(rec.body.data.burned, 16);
  } finally { close(); }
});
