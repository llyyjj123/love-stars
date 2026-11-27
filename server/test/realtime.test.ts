import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { encodeFrame, decodeFrame, RealtimeHub, OutboxConsumer } from '../src/realtime';
import { TokenService } from '../src/auth';

// ---------- 帧编解码 ----------

test('编码短文本帧：opcode + 长度 + 内容', () => {
  const buf = encodeFrame('hello');
  assert.equal(buf[0], 0x81, 'FIN + text opcode');
  assert.equal(buf[1], 5, 'payload length');
  assert.equal(buf.subarray(2).toString('utf8'), 'hello');
});

test('编码 126~65535 长度用 2 字节扩展长度', () => {
  const payload = 'x'.repeat(300);
  const buf = encodeFrame(payload);
  assert.equal(buf[1], 126);
  assert.equal(buf.readUInt16BE(2), 300);
  assert.equal(buf.length, 4 + 300);
});

test('编码超过 65535 用 8 字节扩展长度', () => {
  const payload = 'y'.repeat(70000);
  const buf = encodeFrame(payload);
  assert.equal(buf[1], 127);
  assert.equal(Number(buf.readBigUInt64BE(2)), 70000);
  assert.equal(buf.length, 10 + 70000);
});

test('解码带掩码的客户端帧', () => {
  const text = 'ping';
  const mask = Buffer.from([1, 2, 3, 4]);
  const data = Buffer.from(text, 'utf8');
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];

  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | data.length]), mask, masked]);
  const out = decodeFrame(frame);
  assert.ok(out);
  assert.equal(out!.opcode, 0x1);
  assert.equal(out!.payload, 'ping');
  assert.equal(out!.consumed, frame.length);
});

test('解码不完整帧返回 null', () => {
  assert.equal(decodeFrame(Buffer.from([0x81])), null);
  assert.equal(decodeFrame(Buffer.from([0x81, 5, 1, 2])), null);
});

test('解码后 consumed 正确，可连续解析多帧', () => {
  const f1 = encodeFrame('a');
  const f2 = encodeFrame('bb');
  const all = Buffer.concat([f1, f2]);
  const r1 = decodeFrame(all);
  assert.equal(r1!.payload, 'a');
  const r2 = decodeFrame(all.subarray(r1!.consumed));
  assert.equal(r2!.payload, 'bb');
});

// ---------- Hub ----------

function fakeSocket() {
  const written: Buffer[] = [];
  return {
    written,
    write(b: Buffer | string) { written.push(typeof b === 'string' ? Buffer.from(b) : b); return true; },
    end() {},
    destroy() {},
    on() {},
  };
}

test('Hub：按 userId 推送只发给该用户的连接', () => {
  const tokens = new TokenService('s', 3600_000);
  const hub = new RealtimeHub(tokens);

  const s1 = fakeSocket();
  const s2 = fakeSocket();
  (hub as any).clients.set('c1', { id: 'c1', userId: 'user-a', socket: s1, alive: true });
  (hub as any).clients.set('c2', { id: 'c2', userId: 'user-b', socket: s2, alive: true });

  const sent = hub.emitToUser('user-a', 'task.confirmed', { taskId: 't1' });
  assert.equal(sent, 1);
  assert.equal(s2.written.length, 0, 'B 不应收到');

  const frame = decodeFrame(s1.written[0])!;
  const msg = JSON.parse(frame.payload);
  assert.equal(msg.event, 'task.confirmed');
  assert.equal(msg.payload.taskId, 't1');
});

test('Hub：broadcast 发给所有连接', () => {
  const tokens = new TokenService('s', 3600_000);
  const hub = new RealtimeHub(tokens);
  const s1 = fakeSocket();
  const s2 = fakeSocket();
  (hub as any).clients.set('c1', { id: 'c1', userId: 'user-a', socket: s1, alive: true });
  (hub as any).clients.set('c2', { id: 'c2', userId: 'user-b', socket: s2, alive: true });

  const sent = hub.broadcast('item.updated', { itemId: 'tea' });
  assert.equal(sent, 2);
  assert.equal(s1.written.length, 1);
  assert.equal(s2.written.length, 1);
});

test('Hub：stats 返回连接数和用户数', () => {
  const hub = new RealtimeHub(new TokenService('s', 3600_000));
  (hub as any).clients.set('c1', { id: 'c1', userId: 'user-a', socket: fakeSocket(), alive: true });
  (hub as any).clients.set('c2', { id: 'c2', userId: 'user-a', socket: fakeSocket(), alive: true });
  (hub as any).clients.set('c3', { id: 'c3', userId: 'user-b', socket: fakeSocket(), alive: true });
  const s = hub.stats();
  assert.equal(s.clients, 3);
  assert.equal(s.users.length, 2);
});

// ---------- 真实 WS 握手 + 消息 ----------

async function startWs() {
  const tokens = new TokenService('test-secret', 3600_000);
  const hub = new RealtimeHub(tokens);
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { hub, tokens, server, port, close: () => { hub.closeAll(); server.close(); } };
}

/** 极简 WS 客户端（Node 24 自带全局 WebSocket） */
function connect(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws?token=' + encodeURIComponent(token));
    ws.onopen = () => resolve(ws);
    ws.onerror = (e: any) => reject(new Error('ws error: ' + (e?.message ?? 'unknown')));
  });
}

/**
 * 连接并立即挂上消息收集器。
 * 关键：必须在构造 WebSocket 后立刻 addEventListener，
 * 否则服务端在握手完成瞬间发出的 hello 帧会被漏掉。
 */
function connectWithBox(port: number, token: string): Promise<{ ws: WebSocket; box: any[] }> {
  return new Promise((resolve, reject) => {
    const box: any[] = [];
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws?token=' + encodeURIComponent(token));
    ws.addEventListener('message', (ev: any) => box.push(JSON.parse(String(ev.data))));
    ws.addEventListener('open', () => resolve({ ws, box }));
    ws.addEventListener('error', (e: any) => reject(new Error('ws error: ' + (e?.message ?? 'unknown'))));
  });
}

function waitFor(box: any[], pred: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = box.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout waiting for message'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.onmessage = (ev: any) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(ev.data)));
    };
  });
}

test('真实握手：有效 token 能连上并收到 hello', async () => {
  const ctx = await startWs();
  try {
    const token = ctx.tokens.issue('user-a');
    const ws = await connect(ctx.port, token);
    const hello = await nextMessage(ws);
    assert.equal(hello.type, 'hello');
    assert.equal(hello.userId, 'user-a');
    ws.close();
  } finally { ctx.close(); }
});

test('真实握手：无效 token 被拒绝', async () => {
  const ctx = await startWs();
  try {
    await assert.rejects(() => connect(ctx.port, 'bad-token'));
  } finally { ctx.close(); }
});

test('真实推送：emitToUser 能送达对应客户端', async () => {
  const ctx = await startWs();
  try {
    const wsA = await connect(ctx.port, ctx.tokens.issue('user-a'));
    await nextMessage(wsA);  // hello

    const pending = nextMessage(wsA);
    ctx.hub.emitToUser('user-a', 'redemption.created', { itemName: '奶茶', totalStars: 16 });
    const msg = await pending;

    assert.equal(msg.type, 'event');
    assert.equal(msg.event, 'redemption.created');
    assert.equal(msg.payload.itemName, '奶茶');
    assert.equal(msg.payload.totalStars, 16);
    wsA.close();
  } finally { ctx.close(); }
});

test('真实推送：A 的事件不会发给 B', async () => {
  const ctx = await startWs();
  try {
    const a = await connectWithBox(ctx.port, ctx.tokens.issue('user-a'));
    const b = await connectWithBox(ctx.port, ctx.tokens.issue('user-b'));

    await waitFor(a.box, (m) => m.type === 'hello');
    await waitFor(b.box, (m) => m.type === 'hello');

    a.box.length = 0;
    b.box.length = 0;

    ctx.hub.emitToUser('user-a', 'wallet.updated', { balance: 4 });

    await waitFor(a.box, (m) => m.event === 'wallet.updated');
    await new Promise((r) => setTimeout(r, 300));

    const bGot = b.box.find((m) => m.event === 'wallet.updated');
    assert.equal(bGot, undefined, 'B 不应收到 A 的事件');

    a.ws.close(); b.ws.close();
  } finally { ctx.close(); }
});

test('真实推送：客户端 ping 收到 pong', async () => {
  const ctx = await startWs();
  try {
    const ws = await connect(ctx.port, ctx.tokens.issue('user-a'));
    await nextMessage(ws);  // hello

    const pending = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping', t: 12345 }));
    const pong = await pending;
    assert.equal(pong.type, 'pong');
    assert.equal(pong.t, 12345);
    ws.close();
  } finally { ctx.close(); }
});
