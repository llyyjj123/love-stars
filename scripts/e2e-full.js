/**
 * 全功能端到端验收（v1.5.0）
 *
 * 覆盖：登录 / 签到 / 任务全流程（含提交内容对确认方可见）/ 系统任务确认 /
 *       提交后禁止取消 / 送星星（含上限与留言）/ 小纸条 / 兑换 / 兑现 /
 *       截止提醒只发一档 / 账本不变式。
 *
 * 用法：
 *   1) 先启动后端（server\start.cmd）
 *   2) node scripts/e2e-full.js
 *   3) 结束时自动把两人余额还原成 20 / 20
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const SERVER_DIR = path.join(__dirname, '..', 'server');

function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
  return out;
}
const ENV = loadEnv();

const c = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', dim: '\x1b[2m', yellow: '\x1b[33m' };
let pass = 0, fail = 0;
const fails = [];
function ok(msg) { console.log(c.green + '  PASS ' + c.reset + msg); pass++; }
function bad(msg, detail) {
  console.log(c.red + '  FAIL ' + c.reset + msg);
  if (detail !== undefined) console.log(c.dim + '        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + c.reset);
  fail++; fails.push(msg);
}
function step(m) { console.log('\n' + c.cyan + '> ' + m + c.reset); }
function info(m) { console.log(c.dim + '  ' + m + c.reset); }
function eq(actual, expected, msg) {
  if (actual === expected) ok(msg);
  else bad(msg, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

async function api(p, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await fetch(BASE + p, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

/** 上传一张 1x1 PNG，验证媒体链路 */
async function uploadPng(token) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const boundary = '----e2e' + Date.now();
  const head = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="photo"; filename="e2e.png"\r\n' +
    'Content-Type: image/png\r\n\r\n',
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const res = await fetch(BASE + '/media', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'multipart/form-data; boundary=' + boundary },
    body: Buffer.concat([head, png, tail]),
  });
  const j = await res.json();
  return j?.data?.url;
}

async function main() {
  console.log(c.yellow + 'Love Stars · 全功能验收 v1.5.0' + c.reset);
  console.log(c.dim + 'Base: ' + BASE + c.reset);

  // ---------- 1. 登录 ----------
  step('1. 登录');
  const la = await api('/auth/login', { method: 'POST', body: { username: ENV.USER_A_USERNAME ?? 'a', password: ENV.USER_A_PASSWORD ?? 'a123456' } });
  const lb = await api('/auth/login', { method: 'POST', body: { username: ENV.USER_B_USERNAME ?? 'b', password: ENV.USER_B_PASSWORD ?? 'b123456' } });
  const ta = la.body?.data?.accessToken;
  const tb = lb.body?.data?.accessToken;
  if (ta && tb) ok('两人都能登录');
  else { bad('登录失败', { a: la.status, b: lb.status }); return; }
  eq(la.body.data.user.id, 'user-a', 'A = user-a');
  eq(lb.body.data.user.id, 'user-b', 'B = user-b');

  // ---------- 2. 签到 ----------
  step('2. 签到');
  const st = await api('/checkin/state', { token: ta });
  const signedToday = st.body?.data?.lastDateKey === st.body?.data?.today;
  if (signedToday) {
    info('今天已签到，跳过');
  } else {
    const ci = await api('/checkin', { method: 'POST', token: ta });
    eq(ci.body?.data?.gained >= 1, true, '签到拿到星星');
  }
  const dup = await api('/checkin', { method: 'POST', token: ta });
  if (dup.status === 409) ok('重复签到被拒 (409)');
  else bad('重复签到应 409，实际 ' + dup.status);

  // ---------- 3. 自定义任务全流程 ----------
  step('3. 自定义任务：发布 → 接受 → 提交(图+文案) → 确认');
  const balA0 = (await api('/wallet', { token: ta })).body.data.balance;
  const balB0 = (await api('/wallet', { token: tb })).body.data.balance;
  const pub = await api('/tasks', { method: 'POST', token: ta, idem: 'e2e-pub-' + Date.now(), body: { title: 'E2E 洗碗', reward: 3, timeLimitHours: 2 } });
  const tid = pub.body?.data?.id;
  if (tid) ok('任务已发布'); else { bad('发布失败', pub.body); }
  eq((await api('/wallet', { token: ta })).body.data.balance, balA0 - 3, '发布即托管 3 星');
  eq((await api('/wallet', { token: tb })).body.data.balance, balB0, '执行人余额不变');

  const dl = pub.body.data.deadlineAt;
  eq(dl, null, '未接受前没有 deadline');

  await api('/tasks/' + tid + '/accept', { method: 'POST', token: tb });
  const afterAccept = (await api('/tasks/' + tid, { token: tb })).body.data;
  eq(afterAccept.status, 'accepted', 'B 接受后状态 accepted');
  eq(afterAccept.deadlineAt !== null, true, '接受后开始计时');
  eq(afterAccept.acceptedAt !== null, true, 'acceptedAt 已写入');

  const photo = await uploadPng(tb);
  if (photo) ok('照片上传成功'); else bad('照片上传失败');

  const sub = await api('/tasks/' + tid + '/submit', { method: 'POST', token: tb, body: { photoUrl: photo, note: '碗洗好了，锅也刷了' } });
  eq(sub.body?.data?.status, 'submitted', 'B 提交成功');
  eq(sub.body?.data?.submitNote, '碗洗好了，锅也刷了', '提交文案已保存');
  eq(sub.body?.data?.submitPhotoUrl, photo, '提交照片已保存');

  // ★ 关键：确认方能不能看到提交内容
  const asPublisher = await api('/tasks/' + tid, { token: ta });
  eq(asPublisher.body?.data?.submitNote, '碗洗好了，锅也刷了', '★ 发布方在详情里能看到文案');
  eq(asPublisher.body?.data?.submitPhotoUrl, photo, '★ 发布方在详情里能看到照片');

  const pend = await api('/tasks/pending-confirm', { token: ta });
  const inPending = (pend.body?.data ?? []).some((t) => t.id === tid);
  eq(inPending, true, '★ 出现在「等我确认」列表');

  // 提交后禁止取消
  const cancel = await api('/tasks/' + tid + '/cancel', { method: 'POST', token: ta });
  eq(cancel.status, 409, '★ 发布方提交后不能取消 (409)');
  eq(cancel.body?.error?.code, 'TASK_ALREADY_SUBMITTED', '错误码 TASK_ALREADY_SUBMITTED');

  const conf = await api('/tasks/' + tid + '/confirm', { method: 'POST', token: ta });
  eq(conf.body?.data?.status, 'confirmed', '确认成功');
  eq(conf.body?.data?.confirmedBy, 'user-a', 'confirmedBy = 发布人');
  eq((await api('/wallet', { token: tb })).body.data.balance, balB0 + 3, '执行人收到 3 星');
  eq((await api('/wallet', { token: ta })).body.data.balance, balA0 - 3, '发布方不重复扣星');

  const done = await api('/tasks?scope=done', { token: ta });
  const inDone = (done.body?.data ?? []).some((t) => t.id === tid);
  eq(inDone, true, '★ 归档在 scope=done 里（App 可点开）');
  const archived = await api('/tasks/' + tid, { token: ta });
  eq(archived.body?.data?.submitNote, '碗洗好了，锅也刷了', '★ 归档任务详情仍能看到提交内容');

  const assigned = await api('/tasks?scope=assigned', { token: ta });
  eq((assigned.body?.data ?? []).some((t) => t.id === tid), false, '已完成不在「我在做」里');

  // ---------- 4. 系统任务：对方确认 ----------
  step('4. 系统任务：抽 → 加入 → 提交 → 对方确认（原 bug：没有确认按钮）');
  const drawn = await api('/tasks/draw', { method: 'POST', token: tb, body: { exclude: [] } });
  const sysId = drawn.body?.data?.id;
  if (!sysId) {
    info('任务池已空，跳过系统任务用例');
  } else {
    const join = await api('/tasks/' + sysId + '/join', { method: 'POST', token: tb });
    eq(join.body?.data?.status, 'assigned', '加入后 assigned');
    await api('/tasks/' + sysId + '/accept', { method: 'POST', token: tb });
    const s2 = await api('/tasks/' + sysId + '/submit', { method: 'POST', token: tb, body: { note: '系统任务做完了' } });
    eq(s2.body?.data?.status, 'submitted', '系统任务提交成功');
    eq(s2.body?.data?.publisherId, null, '系统任务 publisherId 为 null');

    const pendA = await api('/tasks/pending-confirm', { token: ta });
    eq((pendA.body?.data ?? []).some((t) => t.id === sysId), true, '★ 系统任务出现在对方的「等我确认」');
    const detailA = await api('/tasks/' + sysId, { token: ta });
    eq(detailA.status, 200, '★ 确认方能打开系统任务详情（曾经 403/404）');
    eq(detailA.body?.data?.submitNote, '系统任务做完了', '★ 确认方能看到系统任务的提交内容');

    const balB1 = (await api('/wallet', { token: tb })).body.data.balance;
    const cf = await api('/tasks/' + sysId + '/confirm', { method: 'POST', token: ta });
    eq(cf.body?.data?.status, 'confirmed', '★ 系统任务能被对方确认（原 bug 只能等 7 天）');
    eq((await api('/wallet', { token: tb })).body.data.balance, balB1 + cf.body.data.reward, '执行人拿到系统奖励');

    const self = await api('/tasks/' + sysId + '/confirm', { method: 'POST', token: ta });
    eq(self.status, 409, '重复确认被拒 (409)');
  }

  // ---------- 5. 送星星 ----------
  step('5. 送星星 + 小纸条');
  const w1 = (await api('/wallet', { token: ta })).body.data.balance;
  const g1 = await api('/gifts', { method: 'POST', token: ta, idem: 'e2e-gift-' + Date.now(), body: { amount: 7, note: '今天辛苦啦' } });
  eq(g1.body?.data?.gift?.amount, 7, '送出 7 颗');
  eq(g1.body?.data?.gift?.note, '今天辛苦啦', '小纸条已保存');
  eq((await api('/wallet', { token: ta })).body.data.balance, w1 - 7, '送出方 -7');
  const wb = (await api('/wallet', { token: tb })).body.data.balance;

  const sentList = await api('/gifts?scope=sent', { token: ta });
  eq((sentList.body?.data ?? []).some((g) => g.note === '今天辛苦啦'), true, '出现在「我送出的」');
  const recvList = await api('/gifts?scope=received', { token: tb });
  eq((recvList.body?.data ?? []).some((g) => g.note === '今天辛苦啦'), true, '对方「我收到的」能看到');

  const zero = await api('/gifts', { method: 'POST', token: ta, body: { amount: 0 } });
  eq(zero.body?.error?.code, 'GIFT_AMOUNT_INVALID', '送 0 颗被拒');
  const neg = await api('/gifts', { method: 'POST', token: ta, body: { amount: -5 } });
  eq(neg.body?.error?.code, 'GIFT_AMOUNT_INVALID', '送负数被拒');
  const tooLong = await api('/gifts', { method: 'POST', token: ta, body: { amount: 1, note: 'x'.repeat(101) } });
  eq(tooLong.body?.error?.code, 'GIFT_NOTE_TOO_LONG', '留言超 100 字被拒');
  const overBal = await api('/gifts', { method: 'POST', token: ta, body: { amount: 999999 } });
  eq(overBal.status, 429, '超上限被拒');

  const rec1 = await api('/reconcile', { token: ta });
  eq(rec1.body?.data?.sum, 0, '送星后 sum(balance) 仍为 0');
  eq(rec1.body?.data?.netIssued, rec1.body?.data?.totalIssued - rec1.body?.data?.burned, '发行 = 发行总量 - 销毁');

  // ---------- 6. 兑换与兑现 ----------
  step('6. 兑换 → 兑现');
  const items = await api('/items', { token: ta });
  const hug = (items.body?.data ?? []).find((i) => i.id === 'hug');
  if (!hug) {
    info('没有 hug 物品，跳过');
  } else {
    const balBefore = (await api('/wallet', { token: tb })).body.data.balance;
    if (balBefore >= hug.priceStars) {
      const rd = await api('/redemptions', { method: 'POST', token: tb, idem: 'e2e-rd-' + Date.now(), body: { itemId: 'hug', quantity: 1, note: '想要一个抱抱' } });
      const rid = rd.body?.data?.id;
      eq(rd.body?.data?.totalStars, hug.priceStars, '兑换总价正确');
      eq((await api('/wallet', { token: tb })).body.data.balance, balBefore - hug.priceStars, '兑换扣星');

      const inbox = await api('/redemptions?scope=inbox', { token: ta });
      eq((inbox.body?.data ?? []).some((r) => r.id === rid), true, '出现在对方「待我兑现」');

      const noPhoto = await api('/redemptions/' + rid + '/fulfill', { method: 'POST', token: ta, body: {} });
      eq(noPhoto.body?.error?.code, 'REDEMPTION_PHOTO_REQUIRED', '兑现必须有照片');

      const fp = await uploadPng(ta);
      const ff = await api('/redemptions/' + rid + '/fulfill', { method: 'POST', token: ta, body: { photoUrl: fp, note: '抱抱送到' } });
      eq(ff.body?.data?.status, 'fulfilled', '兑现成功');
      eq(ff.body?.data?.fulfillNote, '抱抱送到', '兑现留言已保存');

      const mine = await api('/redemptions?scope=mine', { token: tb });
      const r2 = (mine.body?.data ?? []).find((r) => r.id === rid);
      eq(r2?.photoUrl, fp, '兑换方能看到兑现照片');
      eq(r2?.fulfillNote, '抱抱送到', '兑换方能看到兑现留言');
    } else {
      info('B 余额不足 ' + hug.priceStars + '，跳过兑换');
    }
  }

  // ---------- 7. 截止提醒只发一档 ----------
  step('7. 截止提醒：只提醒「过半」一次');
  const remindOut = execFileSync(process.execPath, ['-e', `
    require('dotenv/config');
    const { prisma } = require('./dist/src/prisma');
    const { PrismaService } = require('./dist/src/prisma-service');
    (async () => {
      const svc = new PrismaService(prisma);
      // 造一个 2 小时时限、已经过了 80% 的任务
      const t = await svc.publishTask('user-a', 'user-b', '提醒测试', 1, 2);
      await svc.taskAction(t.id, 'user-b', 'accept');
      const accepted = new Date(Date.now() - 96 * 60 * 1000);   // 已过 96 分钟 / 120
      await prisma.task.update({ where: { id: t.id }, data: { acceptedAt: accepted, deadlineAt: new Date(accepted.getTime() + 120 * 60 * 1000) } });
      const due1 = await svc.dueReminders();
      const mine = due1.find((d) => d.task.id === t.id);
      await svc.markReminded(t.id, mine ? mine.alsoMark : [50]);
      const due2 = await svc.dueReminders();
      const again = due2.find((d) => d.task.id === t.id);
      // 直接超时，确认不再有 100% 那一档
      await prisma.task.update({ where: { id: t.id }, data: { deadlineAt: new Date(Date.now() - 60 * 1000) } });
      const due3 = await svc.dueReminders();
      const expiredStage = due3.find((d) => d.task.id === t.id);
      // 收尾：发布方取消 → 托管原路退回，不留脏数据
      await svc.taskAction(t.id, 'user-a', 'cancel').catch(() => {});
      console.log(JSON.stringify({
        stage: mine ? mine.stage : null,
        marks: mine ? mine.alsoMark : null,
        repeats: !!again,
        expiredPushes: !!expiredStage,
      }));
      await prisma.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: SERVER_DIR, encoding: 'utf8' });
  let rr = null;
  try { rr = JSON.parse(remindOut.trim().split('\n').pop()); } catch { /* ignore */ }
  if (rr) {
    eq(rr.stage, 50, '只提醒 50% 这一档');
    eq(JSON.stringify(rr.marks), '[50]', '只记录 50%');
    eq(rr.repeats, false, '同一档不会重复提醒');
    eq(rr.expiredPushes, false, '超时不再额外推送');
  } else {
    bad('提醒检查脚本没有输出', remindOut);
  }

  // ---------- 8. 账本 ----------
  step('8. 账本');
  const ledger = await api('/ledger?limit=20', { token: ta });
  const types = new Set((ledger.body?.data?.items ?? []).map((e) => e.type));
  eq(types.has('gift'), true, '账本里有 gift 分录');
  eq((ledger.body?.data?.items ?? []).every((e) => typeof e.balanceAfter === 'number'), true, '每条都有 balanceAfter');

  const rec = await api('/reconcile', { token: ta });
  eq(rec.body?.data?.ok, true, '全局不变式成立');

  // ---------- 9. 鉴权 ----------
  step('9. 鉴权');
  eq((await api('/wallet')).status, 401, '无 token 401');
  eq((await api('/wallet', { token: 'garbage' })).status, 401, '坏 token 401');
  eq((await api('/tasks/' + tid, { token: 'garbage' })).status, 401, '详情页也要鉴权');

  // ---------- 10. 还原 20/20 ----------
  step('10. 还原到 20 / 20');
  const isLocal = /127\.0\.0\.1|localhost/.test(BASE);
  if (!isLocal) {
    // 远端跑时不能在本机执行 reset.js（那会重置本地库，跟被测库不是同一个）。
    info('检测到远端 API，跳过自动还原。请在服务器上执行：cd /opt/love-stars/server && node dist/src/reset.js');
    console.log('\n' + '='.repeat(50));
    console.log(c.green + '  PASS: ' + pass + c.reset + '   ' + (fail ? c.red : c.dim) + 'FAIL: ' + fail + c.reset);
    console.log('='.repeat(50));
    if (fail) console.log(c.red + '\n失败项：\n  - ' + fails.join('\n  - ') + '\n' + c.reset);
    process.exitCode = fail === 0 ? 0 : 1;
    return;
  }
  const resetOut = execFileSync(process.execPath, ['dist/src/reset.js'], { cwd: SERVER_DIR, encoding: 'utf8' });
  const m = /A balance:\s*(\d+)[\s\S]*B balance:\s*(\d+)/.exec(resetOut);
  if (m) {
    eq(Number(m[1]), 20, 'A 还原为 20');
    eq(Number(m[2]), 20, 'B 还原为 20');
  } else bad('reset 输出异常', resetOut);
  const finalA = (await api('/wallet', { token: ta })).body.data.balance;
  const finalB = (await api('/wallet', { token: tb })).body.data.balance;
  eq(finalA, 20, '接口确认 A = 20');
  eq(finalB, 20, '接口确认 B = 20');
  const finalRec = await api('/reconcile', { token: ta });
  eq(finalRec.body?.data?.sum, 0, '还原后 sum = 0');
  eq(finalRec.body?.data?.circulating, 40, '流通总量 40');

  // ---------- 汇总 ----------
  console.log('\n' + '='.repeat(50));
  console.log(c.green + '  PASS: ' + pass + c.reset + '   ' + (fail ? c.red : c.dim) + 'FAIL: ' + fail + c.reset);
  console.log('='.repeat(50));
  if (fail) {
    console.log(c.red + '\n失败项：\n  - ' + fails.join('\n  - ') + '\n' + c.reset);
  } else {
    console.log(c.green + '\n全部通过。两人余额已还原为 20 / 20。\n' + c.reset);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(c.red + '\nCrashed: ' + (e && e.stack ? e.stack : e) + c.reset);
  process.exitCode = 1;
});
