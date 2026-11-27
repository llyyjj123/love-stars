import { PrismaClient } from '@prisma/client';
import { AppError } from './ledger';
import { transfer, reconcile } from './repository';

/**
 * Prisma 版业务服务
 * 与 domain.ts 的接口一致，但数据落在 PostgreSQL。
 * 每个写操作都在一个 $transaction 里完成。
 */

export const CHECKIN = { base: 1, cycleLength: 7, cycleBonus: 5 };
export const OPENING = 20;
export const REDEMPTION = { maxQuantity: 99, noteMaxLength: 100, nudgeCooldownMs: 24 * 3600_000 };

/** 送星星规则 */
export const GIFT = {
  noteMaxLength: 100,
  /** 单日累计上限，防止手滑把余额一次送空 */
  dailyLimit: 50,
};

export function dateKeyOf(d: Date, tzOffsetMinutes = 480): string {
  const ms = d.getTime() + tzOffsetMinutes * 60_000;
  const t = new Date(ms);
  return t.getUTCFullYear() + '-' +
    String(t.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(t.getUTCDate()).padStart(2, '0');
}

function prevDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return dateKeyOf(t, 0);
}

export class PrismaService {
  constructor(public prisma: PrismaClient) {}

  // ---------- 账户 ----------
  async accountId(userId: string): Promise<string> {
    const a = await this.prisma.account.findFirst({ where: { kind: 'user', ownerId: userId } });
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'user account missing');
    return a.id;
  }

  async systemAccountId(kind: 'issue' | 'escrow'): Promise<string> {
    const a = await this.prisma.account.findFirst({ where: { kind } });
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', kind + ' account missing');
    return a.id;
  }

  async balanceOf(userId: string): Promise<number> {
    const a = await this.prisma.account.findFirst({ where: { kind: 'user', ownerId: userId } });
    return a?.balance ?? 0;
  }

  /**
   * 本周获得的星星（周一 00:00 起，按服务端时区 UTC+8）。
   * 只统计正分录，不含开户礼——开户礼不是"本周赚的"。
   */
  async weekGain(userId: string, now = new Date()): Promise<number> {
    const account = await this.prisma.account.findFirst({ where: { kind: 'user', ownerId: userId } });
    if (!account) return 0;
    // 本周一 00:00（本地时区）
    const tz = 8 * 3600_000;
    const local = new Date(now.getTime() + tz);
    const dow = (local.getUTCDay() + 6) % 7;          // 周一=0
    const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
    const from = new Date(mondayLocal - tz);

    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        accountId: account.id,
        delta: { gt: 0 },
        createdAt: { gte: from },
        op: { bizType: { not: 'opening' } },
      },
      select: { delta: true },
    });
    return rows.reduce((a, r) => a + r.delta, 0);
  }

  /** 初始化：两个用户 + 三个账户 + 开户礼 */
  async bootstrap(users: { id: string; slot: number; username: string; passwordHash: string; displayName: string }[]) {
    for (const u of users) {
      await this.prisma.user.upsert({
        where: { id: u.id },
        create: u,
        // 用户名、昵称、密码都同步更新：改了 .env 重启就生效
        update: { username: u.username, displayName: u.displayName, passwordHash: u.passwordHash },
      });
      await this.prisma.account.upsert({
        where: { kind_ownerId: { kind: 'user', ownerId: u.id } },
        create: { kind: 'user', ownerId: u.id, balance: 0 },
        update: {},
      });
    }
    for (const kind of ['issue', 'escrow'] as const) {
      const existing = await this.prisma.account.findFirst({ where: { kind } });
      if (!existing) {
        await this.prisma.account.create({ data: { kind, ownerId: null, balance: 0 } });
      }
    }
    // 开户礼（幂等）
    for (const u of users) {
      await this.prisma.$transaction(async (tx) => {
        await transfer(tx, {
          fromAccountId: await this.systemAccountId('issue'),
          toAccountId: await this.accountId(u.id),
          amount: OPENING,
          bizType: 'opening',
          bizId: 'init:' + u.id,
          memo: '开户礼',
        });
      });
    }
  }

  // ---------- 签到 ----------
  async checkIn(userId: string, now = new Date()) {
    const dateKey = dateKeyOf(now);
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.checkIn.findFirst({ where: { userId, dateKey } });
      if (dup) throw new AppError('CHECKIN_ALREADY_DONE');

      const streakRow = await tx.checkinStreak.findUnique({ where: { userId } });
      const continuous = streakRow?.lastDateKey === prevDateKey(dateKey);
      const streak = continuous ? (streakRow?.currentStreak ?? 0) + 1 : 1;
      const isCycleDay = streak % CHECKIN.cycleLength === 0;
      const gained = isCycleDay ? CHECKIN.cycleBonus : CHECKIN.base;
      const bizType = isCycleDay ? 'checkin_cycle' : 'checkin';

      await transfer(tx, {
        fromAccountId: await this.systemAccountId('issue'),
        toAccountId: await this.accountId(userId),
        amount: gained,
        bizType,
        bizId: dateKey + ':' + userId,
        memo: '签到 ' + dateKey,
      });

      await tx.checkIn.create({ data: { userId, dateKey, streakDay: streak, basePoints: gained, bonusPoints: 0 } });
      await tx.checkinStreak.upsert({
        where: { userId },
        create: { userId, currentStreak: streak, lastDateKey: dateKey },
        update: { currentStreak: streak, lastDateKey: dateKey },
      });

      return { dateKey, streak, gained, isCycleDay, balance: await this.balanceOf(userId) };
    });
  }

  // ---------- 任务 ----------
  /** 当前已加入的系统任务（在「我在做」里） */
  async currentSystemTask(userId: string) {
    return this.prisma.task.findFirst({
      where: { origin: 'system', assigneeId: userId, status: 'assigned' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 抽一条系统任务预览 —— **不写库**。
   *
   * 用户看到后可以选择「加入我的任务」「换一个」「算了」。
   * exclude 是客户端已经看过、这次不想再看到的 id。
   */
  async drawSystemTask(userId: string, exclude: string[] = []) {
    const where = {
      origin: 'system',
      assigneeId: userId,
      status: 'pending',
      ...(exclude.length ? { id: { notIn: exclude } } : {}),
    };
    let pool = await this.prisma.task.findMany({ where, select: { id: true } });

    // 本轮全看完了：洗牌重来，否则用几个月就没任务可抽
    if (pool.length === 0 && exclude.length > 0) {
      pool = await this.prisma.task.findMany({
        where: { origin: 'system', assigneeId: userId, status: 'pending' },
        select: { id: true },
      });
      if (pool.length === 0) return null;
      const reshuffled = pool[Math.floor(Math.random() * pool.length)];
      return this.prisma.task.findUnique({ where: { id: reshuffled.id } });
    }
    if (pool.length === 0) return null;

    const picked = pool[Math.floor(Math.random() * pool.length)];
    return this.prisma.task.findUnique({ where: { id: picked.id } });
  }

  /** 把预览的任务真正加入「我在做」 */
  async joinSystemTask(taskId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      const t = rows[0];
      if (!t) throw new AppError('TASK_NOT_FOUND');
      if (t.assigneeId !== userId) throw new AppError('TASK_NOT_ALLOWED');
      if (t.status !== 'pending') throw new AppError('TASK_ILLEGAL_TRANSITION');
      // 重新加入 = 开新一轮：上一轮的提交内容/计时必须一起清掉，
      // 否则系统任务被放弃后再抽到，会显示上一轮的照片和附言。
      const task = await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'assigned',
          submittedAt: null,
          submitPhotoUrl: null,
          submitNote: null,
          acceptedAt: null,
          deadlineAt: null,
          confirmedAt: null,
          confirmedBy: null,
        },
      });
      await tx.outbox.create({ data: { event: 'task.assigned', toUserId: userId, payload: { taskId } } });
      return task;
    });
  }

  async publishTask(
    publisherId: string,
    assigneeId: string,
    title: string,
    reward: number,
    timeLimitHours: number | null = null,
  ) {
    if (reward <= 0) throw new AppError('TASK_REWARD_INVALID');
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: { origin: 'custom', publisherId, assigneeId, title, reward, status: 'assigned', timeLimitHours },
      });
      await transfer(tx, {
        fromAccountId: await this.accountId(publisherId),
        toAccountId: await this.systemAccountId('escrow'),
        amount: reward,
        bizType: 'task_escrow',
        bizId: task.id,
        memo: '任务托管',
      });
      return task;
    });
  }

  async taskAction(
    taskId: string,
    operatorId: string,
    action: 'accept' | 'decline' | 'submit' | 'confirm' | 'cancel',
    extra?: { photoUrl?: string; note?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      const t = rows[0];
      if (!t) throw new AppError('TASK_NOT_FOUND');
      const status: string = t.status;
      const assigneeId: string = t.assigneeId;
      const publisherId: string | null = t.publisherId;
      const reward: number = t.reward;
      const origin: string = t.origin;

      const refundIfCustom = async () => {
        if (origin !== 'custom' || !publisherId) return;
        await transfer(tx, {
          fromAccountId: await this.systemAccountId('escrow'),
          toAccountId: await this.accountId(publisherId),
          amount: reward,
          bizType: 'task_refund',
          bizId: t.id,
        });
      };

      if (action === 'accept') {
        if (status !== 'assigned') throw new AppError('TASK_ILLEGAL_TRANSITION');
        if (assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
        // 计时从接受开始
        const acceptedAt = new Date();
        const deadlineAt = t.timeLimitHours
          ? new Date(acceptedAt.getTime() + t.timeLimitHours * 3600_000)
          : null;
        const updated = await tx.task.update({
          where: { id: taskId },
          data: { status: 'accepted', acceptedAt, deadlineAt },
        });
        await tx.outbox.create({ data: { event: 'task.accepted', toUserId: publisherId ?? assigneeId, payload: { taskId } } });
        return updated;
      }
      if (action === 'decline') {
        if (status !== 'assigned') throw new AppError('TASK_ILLEGAL_TRANSITION');
        if (assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
        await refundIfCustom();
        // 系统任务拒绝后回到模板池，可以再被抽到；自定义任务标 declined 并从列表消失。
        const next = origin === 'system' ? 'pending' : 'declined';
        const updated = await tx.task.update({ where: { id: taskId }, data: { status: next } });
        await tx.outbox.create({ data: { event: 'task.declined', toUserId: publisherId ?? assigneeId, payload: { taskId } } });
        return updated;
      }
      if (action === 'submit') {
        if (status !== 'accepted') throw new AppError('TASK_ILLEGAL_TRANSITION');
        if (assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
        // 提交即停止计时：哪怕对方过几天才确认，也不算超时
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'submitted',
            submittedAt: new Date(),
            submitPhotoUrl: extra?.photoUrl ?? null,
            submitNote: extra?.note ?? null,
          },
        });
        await tx.outbox.create({ data: { event: 'task.submitted', toUserId: publisherId ?? await this.otherUserId(assigneeId), payload: { taskId } } });
        return updated;
      }
      if (action === 'confirm') {
        if (status !== 'submitted') throw new AppError('TASK_ILLEGAL_TRANSITION');
        if (assigneeId === operatorId) throw new AppError('TASK_CANNOT_CONFIRM_OWN');
        // 自定义任务的确认方必须是发布人；系统任务没有发布人，由「另一位」确认
        if (origin === 'custom' && publisherId && publisherId !== operatorId) {
          throw new AppError('TASK_NOT_ALLOWED');
        }
        if (origin === 'system') {
          await transfer(tx, {
            fromAccountId: await this.systemAccountId('issue'),
            toAccountId: await this.accountId(assigneeId),
            amount: reward,
            bizType: 'task_reward',
            bizId: t.id,
          });
        } else {
          await transfer(tx, {
            fromAccountId: await this.systemAccountId('escrow'),
            toAccountId: await this.accountId(assigneeId),
            amount: reward,
            bizType: 'task_settle',
            bizId: t.id,
          });
        }
        const updated = await tx.task.update({
          where: { id: taskId },
          data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: operatorId },
        });
        await tx.outbox.create({ data: { event: 'task.confirmed', toUserId: assigneeId, payload: { taskId } } });
        return updated;
      }
      // cancel
      if (status === 'confirmed' || status === 'cancelled') throw new AppError('TASK_ILLEGAL_TRANSITION');
      // 对方已经提交后，发布方不能再取消退款：否则等于白拿对方的劳动。
      // 此时只能确认，或等 7 天自动确认。
      if (status === 'submitted' && operatorId === publisherId) {
        throw new AppError('TASK_ALREADY_SUBMITTED');
      }
      if (operatorId !== publisherId && operatorId !== assigneeId) throw new AppError('TASK_NOT_ALLOWED');
      await refundIfCustom();
      // 系统任务被放弃/取消，回到池子而不是标记废弃，避免任务越用越少。
      const isSystem = origin === 'system';
      const next = isSystem ? 'pending' : (operatorId === assigneeId ? 'abandoned' : 'cancelled');
      const updated = await tx.task.update({ where: { id: taskId }, data: { status: next } });
      await tx.outbox.create({
        data: {
          event: operatorId === assigneeId ? 'task.abandoned' : 'task.cancelled',
          toUserId: operatorId === assigneeId ? publisherId ?? assigneeId : assigneeId,
          payload: { taskId },
        },
      });
      return updated;
    });
  }

  /** 系统任务没有 publisherId，确认方固定为关系中的另一位。 */
  private async otherUserId(userId: string): Promise<string> {
    const other = await this.prisma.user.findFirst({ where: { id: { not: userId } }, select: { id: true } });
    if (!other) throw new AppError('ACCOUNT_NOT_FOUND', 'partner missing');
    return other.id;
  }

  /**
   * 超时处理：截止时间已过但还没提交的任务。
   *
   * 自定义任务：
   *   1. 托管的 reward 退回发布方
   *   2. 执行人额外赔 reward 给发布方（余额不足就赔到 0 为止）
   * 系统任务：
   *   直接回池子，不赔偿（没有发布方，赔给"系统"没意义）
   */
  async expireOverdueTasks(now = new Date()) {
    const overdue = await this.prisma.task.findMany({
      where: {
        status: { in: ['accepted'] },
        deadlineAt: { lt: now },
      },
      take: 100,
    });

    const done: string[] = [];
    for (const t of overdue) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Task" WHERE id = ${t.id} FOR UPDATE`;
          const row = rows[0];
          if (!row || row.status !== 'accepted') return;

          if (row.origin === 'system') {
            // 系统任务：回池子
            await tx.task.update({ where: { id: row.id }, data: { status: 'pending' } });
          } else {
            // 自定义任务：先退还托管
            await transfer(tx, {
              fromAccountId: await this.systemAccountId('escrow'),
              toAccountId: await this.accountId(row.publisherId),
              amount: row.reward,
              bizType: 'task_refund',
              bizId: row.id,
            });
            // 再扣执行人的赔偿（余额不足则赔到 0）
            const assigneeAccount = await this.accountId(row.assigneeId);
            const acc = await tx.account.findUnique({ where: { id: assigneeAccount } });
            const penalty = Math.min(row.reward, Math.max(0, acc?.balance ?? 0));
            if (penalty > 0) {
              await transfer(tx, {
                fromAccountId: assigneeAccount,
                toAccountId: await this.accountId(row.publisherId),
                amount: penalty,
                bizType: 'task_penalty',
                bizId: row.id,
                memo: '超时赔偿',
              });
            }
            await tx.task.update({ where: { id: row.id }, data: { status: 'expired' } });
          }

          await tx.outbox.create({
            data: { event: 'task.expired', toUserId: row.assigneeId, payload: { taskId: row.id } },
          });
          if (row.publisherId) {
            await tx.outbox.create({
              data: { event: 'task.expired', toUserId: row.publisherId, payload: { taskId: row.id } },
            });
          }
          await tx.auditLog.create({
            data: {
              event: 'task.expired',
              actorId: 'system',
              targetId: row.id,
              payload: { origin: row.origin, reward: row.reward },
            },
          });
        });
        done.push(t.id);
      } catch (e) {
        console.warn('[scheduler] expire failed for', t.id, e);
      }
    }
    return done;
  }

  /**
   * 截止提醒：返回当前该提醒的任务（不写库，靠 Outbox 去重太麻烦）。
   *
   * 用 auditLog 记录已提醒过的 (taskId, stage)，避免重复推送。
   * stage: 50 / 75 / expired
   */
  async dueReminders(now = new Date()) {
    const candidates = await this.prisma.task.findMany({
      where: {
        status: 'accepted',
        deadlineAt: { not: null },
      },
    });

    const out: { task: typeof candidates[0]; stage: number; alsoMark: number[]; remainMin: number }[] = [];
    for (const t of candidates) {
      if (!t.deadlineAt || !t.acceptedAt) continue;
      const total = t.deadlineAt.getTime() - t.acceptedAt.getTime();
      const elapsed = now.getTime() - t.acceptedAt.getTime();
      if (total <= 0) continue;
      const pct = (elapsed / total) * 100;

      // 只提醒一次「过半」。75% 和超时都不再推送：
      //   1) Server酱 每个 key 只有 5 条/天，多一档就会把「等你确认」挤掉
      //   2) 超时那一刻任务已不是 accepted，本来就发不出去，留着是死代码
      const reached = [50].filter((s) => pct >= s);
      if (reached.length === 0) continue;

      const sent = await this.prisma.auditLog.findMany({
        where: { event: 'task.remind', targetId: t.id },
        select: { payload: true },
      });
      const sentStages = new Set(
        sent.map((x: any) => (x.payload && typeof x.payload === 'object' ? x.payload.stage : null)).filter(Boolean),
      );

      const missing = reached.filter((s) => !sentStages.has(s));
      if (missing.length === 0) continue;

      // 只发最高一档，但把错过的阶段一起记下来，避免下一轮重复
      out.push({
        task: t,
        stage: missing[missing.length - 1],
        alsoMark: missing,
        remainMin: Math.max(0, Math.round((t.deadlineAt.getTime() - now.getTime()) / 60000)),
      });
    }
    return out;
  }

  /** 记已提醒的阶段，避免重复推送 */
  async markReminded(taskId: string, stages: number[]) {
    for (const stage of stages) {
      await this.prisma.auditLog.create({
        data: { event: 'task.remind', actorId: 'system', targetId: taskId, payload: { stage } },
      });
    }
  }

  /** 7 天自动确认 */
  async autoConfirmStale(days = 7) {
    const cutoff = new Date(Date.now() - days * 24 * 3600_000);
    const stale = await this.prisma.task.findMany({
      where: { status: 'submitted', submittedAt: { lt: cutoff } },
      take: 100,
    });
    const done: string[] = [];
    for (const t of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Task" WHERE id = ${t.id} FOR UPDATE`;
          const row = rows[0];
          if (!row || row.status !== 'submitted') return;
          if (row.origin === 'system') {
            await transfer(tx, {
              fromAccountId: await this.systemAccountId('issue'),
              toAccountId: await this.accountId(row.assigneeId),
              amount: row.reward,
              bizType: 'task_reward',
              bizId: row.id,
            });
          } else {
            await transfer(tx, {
              fromAccountId: await this.systemAccountId('escrow'),
              toAccountId: await this.accountId(row.assigneeId),
              amount: row.reward,
              bizType: 'task_settle',
              bizId: row.id,
            });
          }
          await tx.task.update({
            where: { id: row.id },
            data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: 'system' },
          });
          await tx.outbox.create({
            data: { event: 'task.auto_confirmed', toUserId: row.assigneeId, payload: { taskId: row.id, afterDays: days } },
          });
          await tx.outbox.create({
            data: {
              event: 'task.auto_confirmed',
              toUserId: row.publisherId ?? await this.otherUserId(row.assigneeId),
              payload: { taskId: row.id, afterDays: days },
            },
          });
          // 自动确认是系统行为，审计与任务状态变更必须在同一事务里。
          await tx.auditLog.create({
            data: { event: 'task.auto_confirmed', actorId: 'system', targetId: row.id, payload: { afterDays: days } },
          });
        });
        done.push(t.id);
      } catch {
        // 单条失败不影响其他
      }
    }
    return done;
  }

  // ---------- 兑换 ----------
  async redeem(redeemerId: string, itemId: string, quantity: number, fulfillBy: string, note?: string) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > REDEMPTION.maxQuantity) {
      throw new AppError('REDEMPTION_QTY_INVALID');
    }
    const qty = quantity;
    if (qty > REDEMPTION.maxQuantity) throw new AppError('REDEMPTION_QTY_INVALID');
    if (note && note.length > REDEMPTION.noteMaxLength) throw new AppError('REDEMPTION_NOTE_TOO_LONG');
    if (redeemerId === fulfillBy) throw new AppError('REDEMPTION_NOT_ALLOWED');

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
      const item = rows[0];
      if (!item) throw new AppError('ITEM_NOT_FOUND');
      if (item.status !== 'listed') throw new AppError('ITEM_NOT_LISTED');
      if (!item.priceStars || item.priceStars <= 0) throw new AppError('ITEM_PRICE_INVALID');

      const total = item.priceStars * qty;
      const r = await tx.redemption.create({
        data: {
          itemId: item.id,
          itemName: item.name,
          itemEmoji: item.emoji,
          priceStars: item.priceStars,
          quantity: qty,
          totalStars: total,
          redeemerId,
          fulfillBy,
          status: 'pending',
          note: note ?? null,
        },
      });

      // 销毁：用户 → issue
      await transfer(tx, {
        fromAccountId: await this.accountId(redeemerId),
        toAccountId: await this.systemAccountId('issue'),
        amount: total,
        bizType: 'burn',
        bizId: r.id,
        memo: '兑换 ' + item.name + ' x' + qty,
      });

      await tx.outbox.create({
        data: { event: 'redemption.created', toUserId: fulfillBy, payload: { redemptionId: r.id, itemName: item.name, totalStars: total } },
      });

      return r;
    });
  }

  async fulfill(redemptionId: string, operatorId: string, photoUrl: string, note?: string) {
    if (!photoUrl) throw new AppError('REDEMPTION_PHOTO_REQUIRED');
    if (note && note.length > REDEMPTION.noteMaxLength) throw new AppError('REDEMPTION_NOTE_TOO_LONG');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Redemption" WHERE id = ${redemptionId} FOR UPDATE`;
      const r = rows[0];
      if (!r) throw new AppError('REDEMPTION_NOT_FOUND');
      if (r.status === 'fulfilled') return tx.redemption.findUnique({ where: { id: redemptionId } });
      if (r.fulfillBy !== operatorId) throw new AppError('REDEMPTION_NOT_ALLOWED');

      const updated = await tx.redemption.update({
        where: { id: redemptionId },
        data: { status: 'fulfilled', fulfilledAt: new Date(), photoUrl, fulfillNote: note ?? null },
      });
      await tx.outbox.create({
        data: { event: 'redemption.fulfilled', toUserId: r.redeemerId, payload: { redemptionId, hasPhoto: true } },
      });
      return updated;
    });
  }

  async nudge(redemptionId: string, operatorId: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id: redemptionId } });
    if (!r) throw new AppError('REDEMPTION_NOT_FOUND');
    if (r.redeemerId !== operatorId) throw new AppError('REDEMPTION_NOT_ALLOWED');
    if (r.status === 'fulfilled') throw new AppError('REDEMPTION_ALREADY_FULFILLED');

    const since = new Date(Date.now() - REDEMPTION.nudgeCooldownMs);
    const recent = await this.prisma.nudge.findFirst({
      where: { redemptionId, createdAt: { gt: since } },
    });
    if (recent) throw new AppError('NUDGE_TOO_FREQUENT');

    await this.prisma.nudge.create({ data: { redemptionId, fromId: operatorId } });
    await this.prisma.outbox.create({
      data: { event: 'redemption.nudged', toUserId: r.fulfillBy, payload: { redemptionId } },
    });
    return { nextAllowedAt: new Date(Date.now() + REDEMPTION.nudgeCooldownMs) };
  }

  // ---------- 送星星 ----------
  /**
   * 送星星：账户之间划转，不发行、不销毁。
   * 所以 SUM(balance) 仍是 0，"只有签到和任务能发星"的封闭发行口也没被打开。
   */
  async sendGift(fromId: string, toId: string, amount: number, note?: string) {
    if (fromId === toId) throw new AppError('GIFT_NOT_ALLOWED', 'cannot gift yourself');
    if (!Number.isInteger(amount) || amount <= 0) throw new AppError('GIFT_AMOUNT_INVALID');
    if (note && note.length > GIFT.noteMaxLength) throw new AppError('GIFT_NOTE_TOO_LONG');

    return this.prisma.$transaction(async (tx) => {
      // 单日上限：按服务端时区的自然日累计
      const today = dateKeyOf(new Date());
      const dayStart = new Date(new Date(today + 'T00:00:00.000Z').getTime() - 8 * 3600_000);
      const agg = await tx.gift.aggregate({
        where: { fromId, createdAt: { gte: dayStart } },
        _sum: { amount: true },
      });
      const sentToday = agg._sum.amount ?? 0;
      if (sentToday + amount > GIFT.dailyLimit) throw new AppError('GIFT_DAILY_LIMIT');

      const gift = await tx.gift.create({
        data: { fromId, toId, amount, note: note?.trim() ? note.trim() : null },
      });

      // 余额不足时这里抛 STARS_INSUFFICIENT，整笔回滚
      await transfer(tx, {
        fromAccountId: await this.accountId(fromId),
        toAccountId: await this.accountId(toId),
        amount,
        bizType: 'gift',
        bizId: gift.id,
        memo: note?.trim() ? '送星星：' + note.trim().slice(0, 40) : '送星星',
      });

      await tx.outbox.create({
        data: { event: 'gift.received', toUserId: toId, payload: { giftId: gift.id, amount } },
      });

      return { gift, balance: await this.balanceOf(fromId) };
    });
  }

  /** 小纸条：我送出的 / 我收到的 */
  async listGifts(userId: string, scope: 'sent' | 'received', limit = 50) {
    const take = Math.min(100, Math.max(1, limit));
    return this.prisma.gift.findMany({
      where: scope === 'sent' ? { fromId: userId } : { toId: userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async reconcile() {
    return reconcile(this.prisma);
  }
}
