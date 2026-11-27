import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/prisma';
import { PrismaService, dateKeyOf, OPENING, REDEMPTION, GIFT } from '../src/prisma-service';
import { hashPassword } from '../src/auth';

const svc = new PrismaService(prisma);

const USERS = [
  { id: 'user-a', slot: 1, username: 'a', passwordHash: hashPassword('pa'), displayName: '杰' },
  { id: 'user-b', slot: 2, username: 'b', passwordHash: hashPassword('pb'), displayName: '媛' },
];

/**
 * 危险操作保护：db.test.ts 会清空所有表。
 * 只有在 ALLOW_DB_TEST_RESET=1 时才允许跑，避免误清开发数据。
 */
function guardReset() {
  if (process.env.ALLOW_DB_TEST_RESET !== '1') {
    throw new Error(
      'db.test.ts clears the whole database. Set ALLOW_DB_TEST_RESET=1 to run it.',
    );
  }
}

async function clean() {
  await prisma.auditLog.deleteMany();
  await prisma.nudge.deleteMany();
  await prisma.outbox.deleteMany();
  await prisma.gift.deleteMany();
  await prisma.redemption.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.ledgerOp.deleteMany();
  await prisma.task.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.checkinStreak.deleteMany();
  await prisma.item.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
}

async function seed() {
  await clean();
  await svc.bootstrap(USERS);
  for (const it of [
    { id: 'hug', name: '一个拥抱', emoji: '🤗', priceStars: 4 },
    { id: 'tea', name: '奶茶', emoji: '🧋', priceStars: 16 },
    { id: 'movie', name: '看一场电影', emoji: '🎬', priceStars: 60 },
  ]) {
    await prisma.item.create({ data: { ...it, status: 'listed' } });
  }
}

before(async () => { guardReset(); await seed(); });
after(async () => { await clean(); await prisma.$disconnect(); });

test('数据库连接正常，12 张表已建', async () => {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`;
  const names = rows.map((r) => r.tablename);
  for (const t of ['Account', 'LedgerOp', 'LedgerEntry', 'CheckIn', 'Task', 'Item', 'Redemption', 'Nudge', 'Outbox', 'User', 'Gift']) {
    assert.ok(names.includes(t), 'missing table ' + t);
  }
});

test('开户礼：两个用户各 20，sum = 0', async () => {
  const r = await svc.reconcile();
  assert.equal(r.ok, true);
  assert.equal(r.circulating, 40);
  assert.equal(r.netIssued, 40);
  assert.equal(r.totalIssued, 40);
  assert.equal(r.burned, 0);
});

test('开户礼幂等：重复 bootstrap 不再加星', async () => {
  await svc.bootstrap(USERS);
  const r = await svc.reconcile();
  assert.equal(r.totalIssued, 40, '仍是 40，没有重复发行');
});

test('签到：+1 星，落 checkIn 记录', async () => {
  const before = await svc.balanceOf('user-a');
  const r = await svc.checkIn('user-a');
  assert.equal(r.gained, 1);
  assert.equal(await svc.balanceOf('user-a'), before + 1);
  const rec = await prisma.checkIn.findFirst({ where: { userId: 'user-a' } });
  assert.ok(rec, 'checkIn 记录已落库');
});

test('签到幂等：同一天第二次抛错', async () => {
  await assert.rejects(
    () => svc.checkIn('user-a'),
    (e: any) => e.code === 'CHECKIN_ALREADY_DONE',
  );
});

test('发布任务：扣星进托管，任务落库', async () => {
  const before = await svc.balanceOf('user-a');
  const t = await svc.publishTask('user-a', 'user-b', '倒垃圾', 3);
  assert.equal(t.status, 'assigned');
  assert.equal(await svc.balanceOf('user-a'), before - 3);
  const escrow = await prisma.account.findFirst({ where: { kind: 'escrow' } });
  assert.equal(escrow?.balance, 3);
  const saved = await prisma.task.findUnique({ where: { id: t.id } });
  assert.ok(saved, '任务已落库');
});

test('发布任务余额不足：事务回滚，任务不落库', async () => {
  const before = await prisma.task.count();
  await assert.rejects(
    () => svc.publishTask('user-a', 'user-b', '大任务', 9999),
    (e: any) => e.code === 'STARS_INSUFFICIENT',
  );
  assert.equal(await prisma.task.count(), before, '没有多出任务');
});

test('任务全流程：接受 → 提交 → 确认，星到执行人', async () => {
  const t = await svc.publishTask('user-a', 'user-b', '洗碗', 5);
  const bBefore = await svc.balanceOf('user-b');

  await svc.taskAction(t.id, 'user-b', 'accept');
  await svc.taskAction(t.id, 'user-b', 'submit');
  await svc.taskAction(t.id, 'user-a', 'confirm');

  assert.equal(await svc.balanceOf('user-b'), bBefore + 5);
  const saved = await prisma.task.findUnique({ where: { id: t.id } });
  assert.equal(saved?.status, 'confirmed');
  const r = await svc.reconcile();
  assert.equal(r.ok, true);
});

test('拒绝任务：全额退款', async () => {
  const before = await svc.balanceOf('user-a');
  const escrowBefore = (await prisma.account.findFirst({ where: { kind: 'escrow' } }))?.balance ?? 0;
  const t = await svc.publishTask('user-a', 'user-b', '取快递', 4);
  await svc.taskAction(t.id, 'user-b', 'decline');
  assert.equal(await svc.balanceOf('user-a'), before, '星退回');
  const escrowAfter = (await prisma.account.findFirst({ where: { kind: 'escrow' } }))?.balance ?? 0;
  assert.equal(escrowAfter, escrowBefore, '托管余额回到原值');
});

test('7 天自动确认', async () => {
  const t = await svc.publishTask('user-a', 'user-b', '擦桌子', 2);
  await svc.taskAction(t.id, 'user-b', 'accept');
  await svc.taskAction(t.id, 'user-b', 'submit');
  // 把 submittedAt 改到 8 天前
  await prisma.task.update({
    where: { id: t.id },
    data: { submittedAt: new Date(Date.now() - 8 * 24 * 3600_000) },
  });
  const done = await svc.autoConfirmStale(7);
  assert.ok(done.includes(t.id), '被自动确认');
  const saved = await prisma.task.findUnique({ where: { id: t.id } });
  assert.equal(saved?.status, 'confirmed');
  assert.equal(saved?.confirmedBy, 'system');
});

test('任务状态变化都写 outbox，自动确认写审计并通知双方', async () => {
  const t = await svc.publishTask('user-a', 'user-b', '拖地', 2);
  await svc.taskAction(t.id, 'user-b', 'accept');
  await svc.taskAction(t.id, 'user-b', 'submit');
  const events = (await prisma.outbox.findMany({ where: { payload: { path: ['taskId'], equals: t.id } } }))
    .map((o) => o.event).sort();
  assert.deepEqual(events, ['task.accepted', 'task.submitted']);

  await prisma.task.update({ where: { id: t.id }, data: { submittedAt: new Date(Date.now() - 8 * 86400_000) } });
  const done = await svc.autoConfirmStale(7);
  assert.ok(done.includes(t.id));
  const saved = await prisma.task.findUnique({ where: { id: t.id } });
  assert.equal(saved?.confirmedBy, 'system');

  const audit = await prisma.auditLog.findFirst({ where: { event: 'task.auto_confirmed', targetId: t.id } });
  assert.ok(audit, '系统行为必须可追溯');
  assert.equal(audit?.actorId, 'system');

  const auto = await prisma.outbox.findMany({ where: { event: 'task.auto_confirmed', payload: { path: ['taskId'], equals: t.id } } });
  assert.deepEqual(auto.map((o) => o.toUserId).sort(), ['user-a', 'user-b'], '双方各收到一条');
});

test('系统任务：激活一条后未完成前不再换题', async () => {
  await clean();
  await svc.bootstrap(USERS);
  const before = await svc.balanceOf('user-b');
  for (let i = 0; i < 3; i++) {
    await prisma.task.create({
      data: { id: `sys-b-${i}`, origin: 'system', assigneeId: 'user-b', title: `模板${i}`, reward: 1, status: 'pending' },
    });
  }
  assert.equal(await svc.currentSystemTask('user-b'), null, '还没抽过');

  // 预览：不写库，状态仍是 pending
  const preview = await svc.drawSystemTask('user-b');
  assert.ok(preview, '抽到一条');
  assert.equal(preview?.status, 'pending', '预览不能改状态');
  assert.equal(await svc.currentSystemTask('user-b'), null, '预览不加入「我在做」');
  assert.equal(await prisma.task.count({ where: { origin: 'system', status: 'pending', assigneeId: 'user-b' } }), 3, '模板没被消耗');

  // 换一个：排除看过的
  const preview2 = await svc.drawSystemTask('user-b', [preview!.id]);
  assert.ok(preview2);
  assert.notEqual(preview2?.id, preview?.id, '换一个不能重复');

  // 加入
  const joined = await svc.joinSystemTask(preview!.id, 'user-b');
  assert.equal(joined.status, 'assigned');
  assert.equal((await svc.currentSystemTask('user-b'))?.id, preview!.id);
  assert.equal(await prisma.task.count({ where: { origin: 'system', status: 'pending', assigneeId: 'user-b' } }), 2, '只消耗一条');

  // 拒绝后回到池子
  await svc.taskAction(preview!.id, 'user-b', 'decline');
  const back = await prisma.task.findUnique({ where: { id: preview!.id } });
  assert.equal(back?.status, 'pending', '系统任务拒绝后回池子');
  assert.equal(await svc.currentSystemTask('user-b'), null, '拒绝后从「我在做」消失');
  assert.equal(await svc.balanceOf('user-b'), before, '系统任务不扣星');
  await seed();
});

test('系统任务模板不能出现在用户的任务列表里', async () => {
  await clean();
  await svc.bootstrap(USERS);
  for (let i = 0; i < 3; i++) {
    await prisma.task.create({
      data: { id: `tpl2-${i}`, origin: 'system', assigneeId: 'user-b', title: `模板${i}`, reward: 1, status: 'pending' },
    });
  }
  // 与 main.ts 的 /tasks 过滤条件保持一致：pending 和已拒绝都不显示
  const hidden = ['pending', 'declined', 'abandoned', 'cancelled', 'expired'];
  const live = { status: { notIn: hidden } };
  assert.equal((await prisma.task.findMany({ where: { assigneeId: 'user-b', ...live } })).length, 0, '模板不能出现在"我正在做"');
  assert.equal((await prisma.task.findMany({ where: { ...live, OR: [{ assigneeId: 'user-b' }, { publisherId: 'user-b' }] } })).length, 0, '模板不能出现在"全部任务"');

  // 预览仍然不可见
  const preview = await svc.drawSystemTask('user-b');
  assert.equal((await prisma.task.findMany({ where: { assigneeId: 'user-b', ...live } })).length, 0, '预览也不显示');

  // 加入之后才可见
  await svc.joinSystemTask(preview!.id, 'user-b');
  const after = await prisma.task.findMany({ where: { assigneeId: 'user-b', ...live } });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, preview?.id);

  // 拒绝后再次消失
  await svc.taskAction(preview!.id, 'user-b', 'decline');
  assert.equal((await prisma.task.findMany({ where: { assigneeId: 'user-b', ...live } })).length, 0, '拒绝后从列表消失');
  await seed();
});

test('时限：接受后开始计时，提交即停止', async () => {
  await clean();
  await svc.bootstrap(USERS);
  const t = await svc.publishTask('user-a', 'user-b', '限时任务', 5, 24);
  assert.equal(t.timeLimitHours, 24);
  assert.equal(t.acceptedAt, null, '接受前不计时');

  const accepted = await svc.taskAction(t.id, 'user-b', 'accept');
  assert.ok(accepted.acceptedAt, '接受后记录起点');
  assert.ok(accepted.deadlineAt, '接受后算出截止');
  const diffH = (accepted.deadlineAt!.getTime() - accepted.acceptedAt!.getTime()) / 3600_000;
  assert.ok(Math.abs(diffH - 24) < 0.01, '截止 = 接受 + 24h');

  const submitted = await svc.taskAction(t.id, 'user-b', 'submit', { note: '做完了', photoUrl: 'http://127.0.0.1:3000/media/0123456789abcdef.jpg' });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submitNote, '做完了');
  assert.ok(submitted.submitPhotoUrl, '照片存下来了');
  await seed();
});

test('超时未提交：退还托管并赔偿，余额不足赔到 0', async () => {
  await clean();
  await svc.bootstrap(USERS);
  // B 只有 20 星，发 5 星任务，A 接受后超时
  const t = await svc.publishTask('user-b', 'user-a', '会超时的任务', 5, 1);
  await svc.taskAction(t.id, 'user-a', 'accept');
  // 把截止时间改到过去
  await prisma.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 60_000) } });

  const aBefore = await svc.balanceOf('user-a');
  const bBefore = await svc.balanceOf('user-b');
  const done = await svc.expireOverdueTasks();
  assert.ok(done.includes(t.id));

  const after = await prisma.task.findUnique({ where: { id: t.id } });
  assert.equal(after?.status, 'expired');
  // A 扣 5（赔偿），B 收回 5（托管退还）+ 5（赔偿）= 净 +5
  assert.equal(await svc.balanceOf('user-a'), aBefore - 5, '执行人被扣赔偿');
  // B 发布时扣了 5（进托管），超时后收回托管 5 + 赔偿 5，净 +10
  assert.equal(await svc.balanceOf('user-b'), bBefore + 10, '发布方收回托管+赔偿');
  const rec = await svc.reconcile();
  assert.equal(rec.ok, true, '对账仍平衡');
  await seed();
});

test('超时赔偿：余额不足时赔到 0，不会变负', async () => {
  await clean();
  await svc.bootstrap(USERS);
  // A 只有 20 星，发 50 星任务不可能（余额不足），所以先让 A 花掉一些
  await prisma.item.upsert({ where: { id: 'hug' }, create: { id: 'hug', name: '拥抱', priceStars: 4, status: 'listed' }, update: {} });
  await svc.redeem('user-a', 'hug', 1, 'user-b');   // A: 20 -> 16
  const aBal = await svc.balanceOf('user-a');   // 16
  // B 发 50 星任务给 A（B 有 20 星不够，所以用 20）
  const t = await svc.publishTask('user-b', 'user-a', '大任务', 20, 1);
  await svc.taskAction(t.id, 'user-a', 'accept');
  await prisma.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 60_000) } });

  await svc.expireOverdueTasks();
  const afterA = await svc.balanceOf('user-a');
  assert.equal(afterA, 0, '赔到 0 为止');
  assert.ok(afterA >= 0, '不会变负');
  const rec = await svc.reconcile();
  assert.equal(rec.ok, true);
  await seed();
});

test('系统任务超时：回池子，不赔偿', async () => {
  await clean();
  await svc.bootstrap(USERS);
  const tpl = await prisma.task.create({
    data: { id: 'sys-x-1', origin: 'system', assigneeId: 'user-a', title: '系统任务', reward: 2, status: 'pending', timeLimitHours: 1 },
  });
  await svc.joinSystemTask(tpl.id, 'user-a');
  await svc.taskAction(tpl.id, 'user-a', 'accept');
  await prisma.task.update({ where: { id: tpl.id }, data: { deadlineAt: new Date(Date.now() - 60_000) } });

  const before = await svc.balanceOf('user-a');
  await svc.expireOverdueTasks();
  const after = await prisma.task.findUnique({ where: { id: tpl.id } });
  assert.equal(after?.status, 'pending', '回池子');
  assert.equal(await svc.balanceOf('user-a'), before, '系统任务不扣星');
  await seed();
});

test('兑换数量：非整数或超限被拒绝，不再静默取整', async () => {
  await clean();
  await svc.bootstrap(USERS);
  await prisma.item.create({ data: { id: 'hug', name: '拥抱', priceStars: 4, status: 'listed' } });
  const before = await svc.balanceOf('user-a');
  for (const q of [1.9, 0, -1, 100, NaN]) {
    await assert.rejects(() => svc.redeem('user-a', 'hug', q, 'user-b'), (e: any) => e.code === 'REDEMPTION_QTY_INVALID', 'q=' + q);
  }
  assert.equal(await svc.balanceOf('user-a'), before, '余额不变');
  assert.equal(await prisma.redemption.count(), 0, '没有兑换单');
  await seed();
});

test('兑现：服务层拒绝空照片；非兑现人不能操作', async () => {
  await clean();
  await svc.bootstrap(USERS);
  await prisma.item.create({ data: { id: 'hug', name: '拥抱', priceStars: 4, status: 'listed' } });
  const r = await svc.redeem('user-a', 'hug', 1, 'user-b');   // A 兑换，B 兑现
  await assert.rejects(() => svc.fulfill(r.id, 'user-b', ''), (e: any) => e.code === 'REDEMPTION_PHOTO_REQUIRED');
  await assert.rejects(
    () => svc.fulfill(r.id, 'user-a', 'http://127.0.0.1:3000/media/0123456789abcdef.jpg'),
    (e: any) => e.code === 'REDEMPTION_NOT_ALLOWED',
    '兑换人自己不能兑现',
  );
  await svc.fulfill(r.id, 'user-b', 'http://127.0.0.1:3000/media/0123456789abcdef.jpg');
  const saved = await prisma.redemption.findUnique({ where: { id: r.id } });
  assert.equal(saved?.status, 'fulfilled');
  assert.equal(saved?.photoUrl, 'http://127.0.0.1:3000/media/0123456789abcdef.jpg');
  await seed();
});

test('兑换：扣星销毁，对方余额不变', async () => {
  // 给 A 补星到够兑奶茶
  await prisma.$transaction(async (tx) => {
    const { transfer } = await import('../src/repository');
    const issue = await prisma.account.findFirst({ where: { kind: 'issue' } });
    const acc = await prisma.account.findFirst({ where: { kind: 'user', ownerId: 'user-a' } });
    await transfer(tx as any, {
      fromAccountId: issue!.id, toAccountId: acc!.id, amount: 100,
      bizType: 'adjust', bizId: 'test-topup-1',
    });
  });

  const aBefore = await svc.balanceOf('user-a');
  const bBefore = await svc.balanceOf('user-b');

  const r = await svc.redeem('user-a', 'tea', 1, 'user-b', '三分糖');
  assert.equal(r.totalStars, 16);
  assert.equal(r.status, 'pending');

  assert.equal(await svc.balanceOf('user-a'), aBefore - 16);
  assert.equal(await svc.balanceOf('user-b'), bBefore, 'B 不变，星被销毁');

  const rec = await svc.reconcile();
  assert.equal(rec.ok, true);
  assert.ok(rec.burned >= 16);
});

test('兑换支持数量：总价 = 单价 × 数量', async () => {
  const before = await svc.balanceOf('user-a');
  const r = await svc.redeem('user-a', 'hug', 3, 'user-b');
  assert.equal(r.quantity, 3);
  assert.equal(r.totalStars, 12);
  assert.equal(await svc.balanceOf('user-a'), before - 12);
});

test('兑换余额不足：无兑换单', async () => {
  const count = await prisma.redemption.count();
  await assert.rejects(
    () => svc.redeem('user-b', 'movie', 1, 'user-a'),
    (e: any) => e.code === 'STARS_INSUFFICIENT',
  );
  assert.equal(await prisma.redemption.count(), count);
});

test('兑现：照片必填，不涉及星星', async () => {
  const rd = await prisma.redemption.findFirst({ where: { redeemerId: 'user-a', status: 'pending' } });
  assert.ok(rd);

  await assert.rejects(
    () => svc.fulfill(rd!.id, 'user-b', ''),
    (e: any) => e.code === 'REDEMPTION_PHOTO_REQUIRED',
  );

  const aBefore = await svc.balanceOf('user-a');
  const bBefore = await svc.balanceOf('user-b');
  const done = await svc.fulfill(rd!.id, 'user-b', 'https://cdn/tea.jpg', '买好啦');
  assert.equal(done?.status, 'fulfilled');
  assert.equal(await svc.balanceOf('user-a'), aBefore, '兑现不动星星');
  assert.equal(await svc.balanceOf('user-b'), bBefore);
});

test('兑现幂等：已兑现再调不覆盖照片', async () => {
  await clean();
  await svc.bootstrap(USERS);
  await prisma.item.create({ data: { id: 'tea', name: '奶茶', priceStars: 16, status: 'listed' } });
  const rd = await svc.redeem('user-a', 'tea', 1, 'user-b');
  const first = 'http://127.0.0.1:3000/media/aaaaaaaaaaaaaaaa.jpg';
  await svc.fulfill(rd.id, 'user-b', first);
  const again = await svc.fulfill(rd.id, 'user-b', 'http://127.0.0.1:3000/media/bbbbbbbbbbbbbbbb.jpg');
  assert.equal(again?.photoUrl, first, '第二次调用不覆盖');
  await seed();
});

test('催一催：24 小时限一次', async () => {
  await clean();
  await svc.bootstrap(USERS);
  await prisma.item.create({ data: { id: 'hug', name: '拥抱', priceStars: 4, status: 'listed' } });
  const rd = await svc.redeem('user-a', 'hug', 1, 'user-b');
  const ok = await svc.nudge(rd.id, 'user-a');
  assert.ok(ok.nextAllowedAt);
  await assert.rejects(
    () => svc.nudge(rd.id, 'user-a'),
    (e: any) => e.code === 'NUDGE_TOO_FREQUENT',
  );
  // 兑现方不能催
  await assert.rejects(() => svc.nudge(rd.id, 'user-b'), (e: any) => e.code === 'REDEMPTION_NOT_ALLOWED');
});

test('outbox：兑换和兑现都写入，且各发给正确的人', async () => {
  const r = await svc.redeem('user-a', 'hug', 1, 'user-b');
  const created = await prisma.outbox.findMany({ where: { event: 'redemption.created', payload: { path: ['redemptionId'], equals: r.id } } });
  assert.equal(created.length, 1);
  assert.equal(created[0].toUserId, 'user-b', '兑换通知发给兑现方');
  assert.equal(created[0].sentAt, null);

  await svc.fulfill(r.id, 'user-b', 'http://127.0.0.1:3000/media/0123456789abcdef.jpg');
  const fulfilled = await prisma.outbox.findMany({ where: { event: 'redemption.fulfilled', payload: { path: ['redemptionId'], equals: r.id } } });
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].toUserId, 'user-a', '兑现通知发给兑换方');
});

// ---------- 送星星 ----------
const code = (c: string) => (e: any) => e.code === c;

test('送星星：账户间划转，双方余额一减一增，sum 仍为 0', async () => {
  await seed();
  const before = { a: await svc.balanceOf('user-a'), b: await svc.balanceOf('user-b') };
  const r = await svc.sendGift('user-a', 'user-b', 5, '买杯奶茶');
  assert.equal(r.gift.amount, 5);
  assert.equal(r.gift.note, '买杯奶茶');
  assert.equal(await svc.balanceOf('user-a'), before.a - 5);
  assert.equal(await svc.balanceOf('user-b'), before.b + 5);
  const rec = await svc.reconcile();
  assert.equal(rec.ok, true);
  assert.equal(rec.sum, 0);
});

test('送星星：不发行不销毁，净发行量不变', async () => {
  const before = await svc.reconcile();
  await svc.sendGift('user-b', 'user-a', 3);
  const after = await svc.reconcile();
  assert.equal(after.netIssued, before.netIssued);
  assert.equal(after.totalIssued, before.totalIssued);
  assert.equal(after.burned, before.burned);
});

test('送星星：不能送给自己 / 金额非法被拒', async () => {
  await assert.rejects(() => svc.sendGift('user-a', 'user-a', 1), code('GIFT_NOT_ALLOWED'));
  await assert.rejects(() => svc.sendGift('user-a', 'user-b', 0), code('GIFT_AMOUNT_INVALID'));
  await assert.rejects(() => svc.sendGift('user-a', 'user-b', -3), code('GIFT_AMOUNT_INVALID'));
  await assert.rejects(() => svc.sendGift('user-a', 'user-b', 1.5), code('GIFT_AMOUNT_INVALID'));
});

test('送星星：余额不足整笔回滚，不留 Gift 记录', async () => {
  await prisma.gift.deleteMany();
  const before = await prisma.gift.count();
  const balance = await svc.balanceOf('user-a');
  // 金额超过余额但仍在单日上限内，才能走到余额校验
  await assert.rejects(() => svc.sendGift('user-a', 'user-b', balance + 1), code('STARS_INSUFFICIENT'));
  assert.equal(await prisma.gift.count(), before);
});

test('送星星：单日累计超过上限被拒', async () => {
  await prisma.gift.deleteMany();
  const original = GIFT.dailyLimit;
  // 余额只有 20，把上限临时压到 5 才能验证累计逻辑
  (GIFT as any).dailyLimit = 5;
  try {
    await svc.sendGift('user-a', 'user-b', 4);
    await assert.rejects(() => svc.sendGift('user-a', 'user-b', 2), code('GIFT_DAILY_LIMIT'));
    // 正好到上限可以
    await svc.sendGift('user-a', 'user-b', 1);
  } finally {
    (GIFT as any).dailyLimit = original;
  }
});

test('送星星：留言超长被拒，写 outbox 给收礼人', async () => {
  await assert.rejects(() => svc.sendGift('user-b', 'user-a', 1, 'x'.repeat(101)), code('GIFT_NOTE_TOO_LONG'));
  const before = await prisma.outbox.count({ where: { toUserId: 'user-a', event: 'gift.received' } });
  await svc.sendGift('user-b', 'user-a', 1, '晚安');
  const after = await prisma.outbox.count({ where: { toUserId: 'user-a', event: 'gift.received' } });
  assert.equal(after, before + 1);
});

test('小纸条：送出和收到的列表都按时间倒序', async () => {
  const sent = await svc.listGifts('user-a', 'sent');
  const received = await svc.listGifts('user-a', 'received');
  assert.ok(sent.length > 0);
  assert.ok(received.length > 0);
  for (let i = 1; i < sent.length; i++) {
    assert.ok(sent[i - 1].createdAt >= sent[i].createdAt, 'sent 未倒序');
  }
  assert.ok(sent.every((g) => g.fromId === 'user-a'));
  assert.ok(received.every((g) => g.toId === 'user-a'));
});

// ---------- 提交后禁止取消 ----------
test('对方已提交后，发布方不能再取消退款', async () => {
  const t = await svc.publishTask('user-a', 'user-b', '不许白嫖', 2, null);
  await svc.taskAction(t.id, 'user-b', 'accept');
  await svc.taskAction(t.id, 'user-b', 'submit', { note: '做完了' });
  await assert.rejects(() => svc.taskAction(t.id, 'user-a', 'cancel'), code('TASK_ALREADY_SUBMITTED'));
  const row = await prisma.task.findUnique({ where: { id: t.id } });
  assert.equal(row?.status, 'submitted');
});

test('系统任务重新加入时清空上一轮的提交内容', async () => {
  // 模板池不在 seed 里，这里手动造一条，避免依赖外部数据
  const tpl = await prisma.task.create({
    data: {
      id: 'sys-test-' + Date.now(),
      origin: 'system',
      assigneeId: 'user-a',
      title: '测试模板',
      reward: 1,
      status: 'pending',
    },
  });
  await svc.joinSystemTask(tpl.id, 'user-a');
  await svc.taskAction(tpl.id, 'user-a', 'accept');
  await svc.taskAction(tpl.id, 'user-a', 'submit', { note: '第一轮', photoUrl: 'http://x/media/aaaaaaaaaaaaaaaa.jpg' });
  // 放弃 → 系统任务回池子
  await svc.taskAction(tpl.id, 'user-a', 'cancel');
  const back = await prisma.task.findUnique({ where: { id: tpl.id } });
  assert.equal(back?.status, 'pending');
  await svc.joinSystemTask(tpl.id, 'user-a');
  const again = await prisma.task.findUnique({ where: { id: tpl.id } });
  assert.equal(again?.submitNote, null);
  assert.equal(again?.submitPhotoUrl, null);
  assert.equal(again?.acceptedAt, null);
  assert.equal(again?.deadlineAt, null);
});

test('最终对账：sum(balance) = 0，数字自洽', async () => {
  const r = await svc.reconcile();
  assert.equal(r.ok, true, 'sum 必须为 0');
  assert.equal(r.sum, 0);
  assert.equal(r.netIssued, r.totalIssued - r.burned);
  assert.equal(r.circulating + r.escrowed, r.netIssued);
});
