import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, AppError } from '../src/ledger';
import { CheckinService, TaskService, RedemptionService, OPENING, dateKeyOf, REDEMPTION } from '../src/domain';

function setup() {
  const { store, ledger } = createWorld(['A', 'B']);
  const checkin = new CheckinService(ledger);
  const tasks = new TaskService(ledger);
  const items = new Map([
    ['hug', { id: 'hug', name: '一个拥抱', emoji: '🤗', price: 4, listed: true }],
    ['tea', { id: 'tea', name: '奶茶', emoji: '🧋', price: 16, listed: true }],
    ['movie', { id: 'movie', name: '看一场电影', emoji: '🎬', price: 60, listed: true }],
    ['off', { id: 'off', name: '下架物品', emoji: '🚫', price: 10, listed: false }],
  ]);
  const redemptions = new RedemptionService(ledger, items);
  return { store, ledger, checkin, tasks, redemptions, items };
}

function giveOpening(ledger: any, userId: string) {
  ledger.mint(userId, OPENING, 'opening', 'init:' + userId, '开户礼');
}

// ---------- 账本内核 ----------

test('开户礼幂等：调两次余额只 +20', () => {
  const { ledger, store } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'A');
  assert.equal(store.userAccount('A').balance, 20);
  assert.equal(ledger.reconcile().sum, 0);
});

test('sum(balance) 恒为 0', () => {
  const { ledger, store } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'B');
  ledger.escrow('A', 5, 'task-x');
  ledger.settle('B', 5, 'task-x');
  assert.equal(ledger.reconcile().sum, 0);
  assert.equal(store.userAccount('A').balance, 15);
  assert.equal(store.userAccount('B').balance, 25);
});

test('余额不足时转移失败且不产生分录', () => {
  const { ledger, store } = setup();
  giveOpening(ledger, 'A');
  const before = store.entries.length;
  assert.throws(() => ledger.escrow('A', 999, 'task-y'), (e: any) => e.code === 'STARS_INSUFFICIENT');
  assert.equal(store.entries.length, before);
  assert.equal(store.userAccount('A').balance, 20);
});

// ---------- 签到 ----------

test('签到每日 1 星，第 7 天给 5 星（替代）', () => {
  const { ledger, store, checkin } = setup();
  let total = 0;
  const base = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));  // 11-01 09:00 CST
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000);
    const r = checkin.checkIn('A', d);
    total += r.gained;
    if (i === 6) {
      assert.equal(r.gained, 5, '第 7 天应给 5 星');
      assert.equal(r.isCycleDay, true);
    } else {
      assert.equal(r.gained, 1);
    }
  }
  assert.equal(total, 11, '7 天累计 1*6+5 = 11');
  assert.equal(store.userAccount('A').balance, 11);
});

test('签到幂等：同一天第二次抛 CHECKIN_ALREADY_DONE', () => {
  const { checkin } = setup();
  const d = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));
  checkin.checkIn('A', d);
  assert.throws(() => checkin.checkIn('A', d), (e: any) => e.code === 'CHECKIN_ALREADY_DONE');
});

test('断签后连续数归 1', () => {
  const { checkin } = setup();
  const d1 = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));
  const d3 = new Date(Date.UTC(2026, 10, 3, 1, 0, 0));
  checkin.checkIn('A', d1);
  const r = checkin.checkIn('A', d3);
  assert.equal(r.streak, 1);
});

test('30 天满勤 46 星（4 个周期日）', () => {
  const { ledger, store, checkin } = setup();
  const base = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));
  for (let i = 0; i < 30; i++) {
    checkin.checkIn('A', new Date(base.getTime() + i * 24 * 3600 * 1000));
  }
  assert.equal(store.userAccount('A').balance, 46, '4*5 + 26*1 = 46');
});

// ---------- 任务 ----------

test('发布任务立即扣星进托管', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  const t = tasks.publishCustom('A', 'B', '倒垃圾', 3);
  assert.equal(store.userAccount('A').balance, 17);
  assert.equal(store.escrowAccount().balance, 3);
  assert.equal(t.status, 'assigned');
});

test('发布任务余额不足时整体失败，任务不存在', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  assert.throws(() => tasks.publishCustom('A', 'B', '大任务', 999), (e: any) => e.code === 'STARS_INSUFFICIENT');
  assert.equal(tasks.tasks.size, 0);
  assert.equal(store.userAccount('A').balance, 20);
});

test('完整流程：发布 → 接受 → 提交 → 确认，星到执行人', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'B');
  const t = tasks.publishCustom('A', 'B', '洗碗', 5);
  tasks.accept(t.id, 'B');
  tasks.submit(t.id, 'B');
  tasks.confirm(t.id, 'A');
  assert.equal(store.userAccount('A').balance, 15);
  assert.equal(store.userAccount('B').balance, 25);
  assert.equal(store.escrowAccount().balance, 0);
  assert.equal(t.status, 'confirmed');
});

test('确认幂等：双击只发一次星', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  const t = tasks.publishCustom('A', 'B', '洗碗', 5);
  tasks.accept(t.id, 'B');
  tasks.submit(t.id, 'B');
  tasks.confirm(t.id, 'A');
  assert.throws(() => tasks.confirm(t.id, 'A'), (e: any) => e.code === 'TASK_ILLEGAL_TRANSITION');
  assert.equal(store.userAccount('B').balance, 5);
});

test('拒绝任务全额退款', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  const t = tasks.publishCustom('A', 'B', '取快递', 3);
  tasks.decline(t.id, 'B');
  assert.equal(store.userAccount('A').balance, 20);
  assert.equal(store.escrowAccount().balance, 0);
  assert.equal(t.status, 'declined');
});

test('只有 assigned 能拒绝，accepted 之后不行', () => {
  const { ledger, tasks } = setup();
  giveOpening(ledger, 'A');
  const t = tasks.publishCustom('A', 'B', '取快递', 3);
  tasks.accept(t.id, 'B');
  assert.throws(() => tasks.decline(t.id, 'B'), (e: any) => e.code === 'TASK_ILLEGAL_TRANSITION');
});

test('7 天自动确认', () => {
  const { ledger, store, tasks } = setup();
  giveOpening(ledger, 'A');
  const t = tasks.publishCustom('A', 'B', '洗碗', 5);
  tasks.accept(t.id, 'B');
  const submittedAt = new Date(Date.UTC(2026, 10, 1));
  tasks.submit(t.id, 'B', submittedAt);
  const stale = tasks.autoConfirmStale(new Date(Date.UTC(2026, 10, 9)), 7);
  assert.equal(stale.length, 1);
  assert.equal(t.confirmedBy, 'system');
  assert.equal(store.userAccount('B').balance, 5);
});

// ---------- 兑换 ----------

test('兑换扣星并销毁，不转给对方', () => {
  const { ledger, store, redemptions } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'B');
  const r = redemptions.redeem('A', 'tea', 1, 'B', '想喝三分糖');
  assert.equal(store.userAccount('A').balance, 4);
  assert.equal(store.userAccount('B').balance, 20, 'B 的余额不变，星被销毁');
  assert.equal(r.totalStars, 16);
  assert.equal(r.status, 'pending');
  assert.equal(ledger.reconcile().sum, 0);
});

test('兑换后净发行量下降，累计发行量不变', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'B');
  const before = ledger.reconcile();
  assert.equal(before.netIssued, 40);
  assert.equal(before.totalIssued, 40);
  assert.equal(before.burned, 0);

  redemptions.redeem('A', 'tea', 1, 'B', undefined);

  const after = ledger.reconcile();
  assert.equal(after.netIssued, 24, '净发行 40 - 16 = 24');
  assert.equal(after.totalIssued, 40, '累计发行不变');
  assert.equal(after.burned, 16, '已销毁 16');
});

test('兑换支持数量，总价 = 单价 × 数量', () => {
  const { ledger, store, redemptions } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'A');
  // 两次开户礼幂等，只 +20；手动补到 60
  ledger.mint('A', 40, 'adjust', 'topup-1', 'test topup');
  const r = redemptions.redeem('A', 'tea', 3, 'B', undefined);
  assert.equal(r.quantity, 3);
  assert.equal(r.totalStars, 48);
  assert.equal(store.userAccount('A').balance, 12);
});

test('兑换余额不足时整体失败，无兑换单', () => {
  const { ledger, redemptions, store } = setup();
  giveOpening(ledger, 'A');
  assert.throws(() => redemptions.redeem('A', 'movie', 1, 'B', undefined), (e: any) => e.code === 'STARS_INSUFFICIENT');
  assert.equal(redemptions.redemptions.size, 0);
  assert.equal(store.userAccount('A').balance, 20);
});

test('兑换幂等：同一兑换单不重复扣星', () => {
  const { ledger, store, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r1 = redemptions.redeem('A', 'hug', 1, 'B', undefined);
  // 直接调 ledger.burn 用同一个 id，模拟客户端重试
  const balanceBefore = store.userAccount('A').balance;
  ledger.burn('A', 4, r1.id, 'retry');
  assert.equal(store.userAccount('A').balance, balanceBefore, '幂等键命中，不再扣');
});

test('数量超上限抛 REDEMPTION_QTY_INVALID', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  ledger.mint('A', 10000, 'adjust', 'topup-2');
  assert.throws(
    () => redemptions.redeem('A', 'hug', REDEMPTION.maxQuantity + 1, 'B', undefined),
    (e: any) => e.code === 'REDEMPTION_QTY_INVALID',
  );
});

test('下架物品不能兑换', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  assert.throws(() => redemptions.redeem('A', 'off', 1, 'B', undefined), (e: any) => e.code === 'ITEM_NOT_LISTED');
});

test('兑现不涉及星星，只改状态', () => {
  const { ledger, store, redemptions } = setup();
  giveOpening(ledger, 'A');
  giveOpening(ledger, 'B');
  const r = redemptions.redeem('A', 'tea', 1, 'B', undefined);
  const aBefore = store.userAccount('A').balance;
  const bBefore = store.userAccount('B').balance;

  redemptions.fulfill(r.id, 'B', 'https://cdn/x.jpg', '买好啦');

  assert.equal(store.userAccount('A').balance, aBefore);
  assert.equal(store.userAccount('B').balance, bBefore);
  assert.equal(r.status, 'fulfilled');
});

test('兑现照片必填', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r = redemptions.redeem('A', 'hug', 1, 'B', undefined);
  assert.throws(
    () => redemptions.fulfill(r.id, 'B', '', undefined),
    (e: any) => e.code === 'REDEMPTION_PHOTO_REQUIRED',
  );
});

test('兑现幂等：已兑现再调直接返回', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r = redemptions.redeem('A', 'hug', 1, 'B', undefined);
  redemptions.fulfill(r.id, 'B', 'p1.jpg', undefined);
  const again = redemptions.fulfill(r.id, 'B', 'p2.jpg', undefined);
  assert.equal(again.photoUrl, 'p1.jpg', '第二次不覆盖');
});

test('非兑现人不能兑现', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r = redemptions.redeem('A', 'hug', 1, 'B', undefined);
  assert.throws(
    () => redemptions.fulfill(r.id, 'A', 'x.jpg', undefined),
    (e: any) => e.code === 'REDEMPTION_NOT_ALLOWED',
  );
});

test('催一催 24 小时限一次', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r = redemptions.redeem('A', 'tea', 1, 'B', undefined);
  const t0 = new Date(Date.UTC(2026, 10, 24, 1, 0, 0));
  redemptions.nudge(r.id, 'A', t0);
  assert.throws(
    () => redemptions.nudge(r.id, 'A', new Date(t0.getTime() + 3600_000)),
    (e: any) => e.code === 'NUDGE_TOO_FREQUENT',
  );
  // 25 小时后可以再催
  const ok = redemptions.nudge(r.id, 'A', new Date(t0.getTime() + 25 * 3600_000));
  assert.ok(ok.nextAllowedAt);
});

test('待我兑现列表只含 pending', () => {
  const { ledger, redemptions } = setup();
  giveOpening(ledger, 'A');
  const r1 = redemptions.redeem('A', 'hug', 1, 'B', undefined);
  redemptions.redeem('A', 'hug', 1, 'B', undefined);
  assert.equal(redemptions.pendingFor('B').length, 2);
  redemptions.fulfill(r1.id, 'B', 'p.jpg', undefined);
  assert.equal(redemptions.pendingFor('B').length, 1);
});

// ---------- 综合 ----------

test('混合场景：签到 + 发任务 + 兑换，sum 始终为 0', () => {
  const { ledger, store, checkin, tasks, redemptions } = setup();
  const base = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));

  for (let i = 0; i < 7; i++) {
    checkin.checkIn('A', new Date(base.getTime() + i * 24 * 3600 * 1000));
    assert.equal(ledger.reconcile().sum, 0);
  }
  assert.equal(store.userAccount('A').balance, 11);

  const t = tasks.publishCustom('A', 'B', '倒垃圾', 3);
  assert.equal(ledger.reconcile().sum, 0);
  tasks.accept(t.id, 'B');
  tasks.submit(t.id, 'B');
  tasks.confirm(t.id, 'A');
  assert.equal(ledger.reconcile().sum, 0);
  assert.equal(store.userAccount('A').balance, 8);
  assert.equal(store.userAccount('B').balance, 3);

  // A 只有 8 星，兑 4 星拥抱
  redemptions.redeem('A', 'hug', 1, 'B', undefined);
  assert.equal(store.userAccount('A').balance, 4);
  assert.equal(ledger.reconcile().sum, 0);

  const r = ledger.reconcile();
  assert.equal(r.netIssued, 7, '净发行 = 11 - 4 = 7');
  assert.equal(r.totalIssued, 11);
  assert.equal(r.burned, 4);
});
