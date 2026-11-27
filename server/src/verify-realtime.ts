import { createServer } from 'node:http';
import { prisma } from './prisma';
import { PrismaService } from './prisma-service';
import { hashPassword, TokenService } from './auth';
import { RealtimeHub, OutboxConsumer } from './realtime';

const tokens = new TokenService('verify-secret', 3600_000);
const hub = new RealtimeHub(tokens);
const svc = new PrismaService(prisma);
const consumer = new OutboxConsumer(prisma, hub, 200);

async function main() {
  const server = createServer((_q, s) => { s.writeHead(200); s.end('ok'); });
  server.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  console.log('ws server on', port);

  const tokenA = tokens.issue('user-a');
  const tokenB = tokens.issue('user-b');

  const boxA: any[] = [];
  const boxB: any[] = [];
  const wsA = new WebSocket('ws://127.0.0.1:' + port + '/ws?token=' + tokenA);
  const wsB = new WebSocket('ws://127.0.0.1:' + port + '/ws?token=' + tokenB);
  wsA.addEventListener('message', (e: any) => boxA.push(JSON.parse(String(e.data))));
  wsB.addEventListener('message', (e: any) => boxB.push(JSON.parse(String(e.data))));

  await new Promise((r) => setTimeout(r, 400));
  console.log('A hello:', JSON.stringify(boxA[0]));
  console.log('B hello:', JSON.stringify(boxB[0]));

  // 清空后造一笔真实兑换
  boxA.length = 0; boxB.length = 0;
  await prisma.outbox.updateMany({ where: { sentAt: null }, data: { sentAt: new Date() } });

  // 给 A 补星
  const { transfer } = await import('./repository');
  await prisma.$transaction(async (tx) => {
    const issue = await prisma.account.findFirst({ where: { kind: 'issue' } });
    const acc = await prisma.account.findFirst({ where: { kind: 'user', ownerId: 'user-a' } });
    await transfer(tx as any, {
      fromAccountId: issue!.id, toAccountId: acc!.id, amount: 50,
      bizType: 'adjust', bizId: 'verify-topup-' + Date.now(),
    });
  });

  const rd = await svc.redeem('user-a', 'tea', 1, 'user-b', '验证用');
  console.log('redeemed:', rd.id, rd.itemName, rd.totalStars);

  await consumer.tick();
  await new Promise((r) => setTimeout(r, 300));

  console.log('A 收到:', JSON.stringify(boxA));
  console.log('B 收到:', JSON.stringify(boxB));

  wsA.close(); wsB.close();
  server.close();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
