import 'dotenv/config';
import { prisma } from './prisma';
import { PrismaService } from './prisma-service';
import { hashPassword } from './auth';
import { SYSTEM_TASKS } from './system-tasks';

/**
 * 清空所有业务数据，只保留「开户礼」。
 *
 * 用途：手工测试/演示跑完一轮后，把两个人的星星都还原到 20，
 * 并且不留下任何任务、兑换、送礼记录。
 *
 * 用法：node dist/src/reset.js            （默认 20/20）
 *       node dist/src/reset.js --keep-items（保留物品表）
 */
const USERS = [
  { id: 'user-a', slot: 1, displayName: '杰', username: process.env.USER_A_USERNAME ?? 'a', password: process.env.USER_A_PASSWORD ?? 'change-me-a' },
  { id: 'user-b', slot: 2, displayName: '媛', username: process.env.USER_B_USERNAME ?? 'b', password: process.env.USER_B_PASSWORD ?? 'change-me-b' },
];

async function main() {
  const svc = new PrismaService(prisma);

  // 顺序很重要：先删有外键指向别人的，再删被指向的。
  await prisma.gift.deleteMany();
  await prisma.nudge.deleteMany();
  await prisma.redemption.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.outbox.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.ledgerOp.deleteMany();
  // 系统任务是「模板池」，不是业务数据：全部删掉后按原表重新灌一遍，
  // 保证每次重置后 36 条模板都在、都是 pending。
  await prisma.task.deleteMany();
  for (const u of USERS) {
    for (const t of SYSTEM_TASKS) {
      await prisma.task.create({
        data: {
          id: t.id + '-' + u.slot,
          origin: 'system',
          assigneeId: u.id,
          title: t.title,
          description: t.description,
          reward: t.reward,
          status: 'pending',
        },
      });
    }
  }
  await prisma.checkIn.deleteMany();
  await prisma.checkinStreak.deleteMany();
  await prisma.account.deleteMany();

  // bootstrap 会重建账户并重新发开户礼（bizId 幂等，删干净后会重新发）
  await svc.bootstrap(USERS.map((u) => ({
    id: u.id, slot: u.slot, username: u.username,
    passwordHash: hashPassword(u.password), displayName: u.displayName,
  })));

  // 物品表也可能被测试清空过，这里补回来（和 main.ts 的 ITEMS 保持一致）。
  const ITEMS = [
    { id: 'hug', name: '一个拥抱', emoji: '🤗', priceStars: 4, sortKey: 1, coverUrl: 'hug.jpg',
      description: '给彼此一个认真的拥抱，不敷衍、不赶时间，把今天的小疲惫先放下。' },
    { id: 'kiss', name: '一个亲亲', emoji: '😘', priceStars: 6, sortKey: 2, coverUrl: 'kiss.jpg',
      description: '送上一个温柔的亲亲，用简单的方式表达想念，具体方式以双方都自在为准。' },
    { id: 'tea', name: '奶茶', emoji: '🧋', priceStars: 15, sortKey: 3, coverUrl: 'tea.jpg',
      description: '由 TA 请你喝一杯奶茶，品牌、口味、甜度和温度由兑换人选择。' },
    { id: 'walk', name: '一起散步', emoji: '🚶', priceStars: 20, sortKey: 4, coverUrl: 'walk.jpg',
      description: '找一段双方都有空的时间，一起散步 30 分钟，不赶路线，好好聊天。' },
    { id: 'burger', name: '汉堡', emoji: '🍔', priceStars: 24, sortKey: 5, coverUrl: 'burger.jpg',
      description: '由 TA 请你吃一个汉堡，具体门店、口味和是否搭配小食由两人商量。' },
    { id: 'massage', name: '捏捏肩 15 分钟', emoji: '💆', priceStars: 32, sortKey: 6, coverUrl: 'massage.jpg',
      description: '由 TA 为你捏肩 15 分钟，力度以舒适为准，感到不适可以随时停止。' },
    { id: 'movie', name: '陪我看指定电影', emoji: '🎬', priceStars: 35, sortKey: 7, coverUrl: 'movie.jpg',
      description: '由兑换人指定一部电影，另一方陪同看完，观看时间和平台由两人商量。' },
    { id: 'meal', name: '一顿漂亮饭', emoji: '🍽️', priceStars: 80, sortKey: 8, coverUrl: 'meal.jpg',
      description: '安排一顿更有仪式感的饭，餐厅和预算提前商量，再留一张合影作纪念。' },
    { id: 'day', name: '听 TA 安排一天', emoji: '📅', priceStars: 240, sortKey: 9, coverUrl: 'day.jpg',
      description: '提前约定一天，由 TA 优先配合你的合理心愿；不涉及安全、隐私、大额消费或违背意愿的要求。' },
  ];
  for (const it of ITEMS) {
    await prisma.item.upsert({
      where: { id: it.id },
      create: { ...it, status: 'listed' },
      update: { ...it, status: 'listed' },
    });
  }

  const a = await svc.balanceOf('user-a');
  const b = await svc.balanceOf('user-b');
  const rec = await svc.reconcile();
  console.log('reset done');
  console.log('  A balance:', a);
  console.log('  B balance:', b);
  console.log('  reconcile:', JSON.stringify(rec));
  if (!rec.ok) {
    console.error('!! ledger invariant broken');
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
