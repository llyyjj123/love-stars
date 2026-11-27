import 'dotenv/config';
import { prisma } from './prisma';
import { PrismaService } from './prisma-service';
import { hashPassword } from './auth';

// 账号密码不再写进源码（仓库是公开的），改从 server/.env 读取。
// .env 已在 .gitignore 里，本地照常 node dist/src/seed.js 即可。
const USERS = [
  {
    id: 'user-a', slot: 1, displayName: '杰',
    username: process.env.USER_A_USERNAME ?? 'a',
    password: process.env.USER_A_PASSWORD ?? 'change-me-a',
  },
  {
    id: 'user-b', slot: 2, displayName: '媛',
    username: process.env.USER_B_USERNAME ?? 'b',
    password: process.env.USER_B_PASSWORD ?? 'change-me-b',
  },
];

const ITEMS = [
  { id: 'hug', name: '一个拥抱', emoji: '🤗', priceStars: 4, sortKey: 1 },
  { id: 'tea', name: '奶茶', emoji: '🧋', priceStars: 16, sortKey: 2 },
  { id: 'burger', name: '汉堡', emoji: '🍔', priceStars: 24, sortKey: 3 },
  { id: 'movie', name: '看一场电影', emoji: '🎬', priceStars: 60, sortKey: 4 },
  { id: 'meal', name: '一顿饭', emoji: '🍜', priceStars: 80, sortKey: 5 },
  { id: 'gift', name: '礼物', emoji: '🎁', priceStars: 120, sortKey: 6 },
];

async function main() {
  const svc = new PrismaService(prisma);

  await svc.bootstrap(USERS.map((u) => ({
    id: u.id, slot: u.slot, username: u.username,
    passwordHash: hashPassword(u.password), displayName: u.displayName,
  })));

  for (const it of ITEMS) {
    await prisma.item.upsert({
      where: { id: it.id },
      create: { ...it, status: 'listed' },
      update: { name: it.name, priceStars: it.priceStars, emoji: it.emoji, status: 'listed' },
    });
  }

  // 演示数据：A 发一个任务、B 兑换一杯奶茶
  const t = await svc.publishTask('user-a', 'user-b', '倒垃圾', 3);
  await svc.taskAction(t.id, 'user-b', 'accept');

  const r = await svc.redeem('user-b', 'tea', 1, 'user-a', '想喝三分糖');

  const rec = await svc.reconcile();
  console.log('seed done');
  console.log('  A balance:', await svc.balanceOf('user-a'));
  console.log('  B balance:', await svc.balanceOf('user-b'));
  console.log('  task:', t.id, t.status);
  console.log('  redemption:', r.id, r.itemName, r.totalStars);
  console.log('  reconcile:', JSON.stringify(rec));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});