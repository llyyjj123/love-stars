import { createServer } from 'node:http';
import { prisma } from './prisma';
import { PrismaService } from './prisma-service';
import { TokenService } from './auth';
import { RealtimeHub, OutboxConsumer } from './realtime';

const tokens = new TokenService('ws-verify', 3600_000);
const hub = new RealtimeHub(tokens);
const svc = new PrismaService(prisma);
const consumer = new OutboxConsumer(prisma, hub, 150);

function json(res: any, code: number, body: any) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
  });
}

async function main() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;

    if (p === '/redeem' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const r = await svc.redeem('user-a', b.itemId ?? 'hug', b.quantity ?? 1, 'user-b', b.note);
        return json(res, 200, { ok: true, data: r });
      } catch (e: any) { return json(res, 400, { ok: false, error: { code: e.code, message: e.message } }); }
    }
    if (p === '/fulfill' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const r = await svc.fulfill(b.id, 'user-b', b.photoUrl ?? 'x.jpg', b.note);
        return json(res, 200, { ok: true, data: r });
      } catch (e: any) { return json(res, 400, { ok: false, error: { code: e.code, message: e.message } }); }
    }
    if (p === '/nudge' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const r = await svc.nudge(b.id, 'user-a');
        return json(res, 200, { ok: true, data: r });
      } catch (e: any) { return json(res, 400, { ok: false, error: { code: e.code, message: e.message } }); }
    }
    json(res, 404, { ok: false });
  });

  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const base = 'http://127.0.0.1:' + port;
  const wsBase = 'ws://127.0.0.1:' + port + '/ws?token=';
  console.log('server on', port);

  const ta = tokens.issue('user-a');
  const tb = tokens.issue('user-b');

  const boxA: any[] = [];
  const boxB: any[] = [];
  const wsA = new WebSocket(wsBase + encodeURIComponent(ta));
  const wsB = new WebSocket(wsBase + encodeURIComponent(tb));
  wsA.addEventListener('message', (e: any) => boxA.push(JSON.parse(String(e.data))));
  wsB.addEventListener('message', (e: any) => boxB.push(JSON.parse(String(e.data))));

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const find = (box: any[], pred: (m: any) => boolean, ms = 5000) =>
    new Promise<any>((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const hit = box.find(pred);
        if (hit) return resolve(hit);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(tick, 50);
      };
      tick();
    });

  await wait(500);
  console.log('1. A hello:', JSON.stringify(boxA.find((m) => m.type === 'hello')));
  console.log('   B hello:', JSON.stringify(boxB.find((m) => m.type === 'hello')));

  boxA.length = 0;
  boxB.length = 0;

  // 补星（防止余额不足）
  const { transfer } = await import('./repository');
  await prisma.$transaction(async (tx) => {
    const issue = await prisma.account.findFirst({ where: { kind: 'issue' } });
    const acc = await prisma.account.findFirst({ where: { kind: 'user', ownerId: 'user-a' } });
    await transfer(tx as any, {
      fromAccountId: issue!.id, toAccountId: acc!.id, amount: 100,
      bizType: 'adjust', bizId: 'ws-verify-' + Date.now(),
    });
  });

  // A 兑换
  const rdRes = await fetch(base + '/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: 'hug', quantity: 1, note: 'ws verify' }),
  }).then((x) => x.json() as Promise<any>);
  if (!rdRes.ok) { console.log('redeem failed:', JSON.stringify(rdRes.error)); process.exit(1); }
  console.log('2. A redeemed:', rdRes.data.itemName, rdRes.data.totalStars, 'stars');

  await consumer.tick();
  const bGot = await find(boxB, (m) => m.event === 'redemption.created');
  console.log('3. B received redemption.created:', bGot ? 'YES' : 'NO');
  if (bGot) console.log('   payload:', JSON.stringify(bGot.payload));

  await wait(500);
  const aGot = boxA.find((m) => m.event === 'redemption.created');
  console.log('4. A must NOT receive it:', aGot ? 'WRONG' : 'CORRECT');

  // B 兑现
  boxA.length = 0;
  boxB.length = 0;
  await fetch(base + '/fulfill', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: rdRes.data.id, photoUrl: 'https://example.com/x.jpg', note: 'done' }),
  });
  await consumer.tick();
  const aFulfilled = await find(boxA, (m) => m.event === 'redemption.fulfilled');
  console.log('5. A received redemption.fulfilled:', aFulfilled ? 'YES' : 'NO');

  // A 催一催
  boxA.length = 0;
  boxB.length = 0;
  const rd2 = await fetch(base + '/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: 'hug', quantity: 1 }),
  }).then((x) => x.json() as Promise<any>);
  await consumer.tick();
  await find(boxB, (m) => m.event === 'redemption.created');
  boxB.length = 0;

  await fetch(base + '/nudge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: rd2.data.id }),
  });
  await consumer.tick();
  const bNudge = await find(boxB, (m) => m.event === 'redemption.nudged');
  console.log('6. B received redemption.nudged:', bNudge ? 'YES' : 'NO');

  wsA.close();
  wsB.close();
  server.close();
  await prisma.$disconnect();
  console.log('');
  console.log('=== WebSocket 全链路验证完成 ===');
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
