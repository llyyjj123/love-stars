import { AppError, Ledger, LedgerStore } from './ledger';

/** 签到规则（P-06 / P-23 / P-24） */
export const CHECKIN = {
  base: 1,          // 每日 1 星
  cycleLength: 7,   // 每 7 天一个周期
  cycleBonus: 5,    // 第 7/14/21... 天给 5 星（替代当日 1 星）
  day7Mode: 'replace' as const,
};

/** 开户礼（P-41） */
export const OPENING = 20;

export interface CheckinState {
  lastDateKey: string | null;
  currentStreak: number;
}

export interface CheckinResult {
  dateKey: string;
  streak: number;
  gained: number;
  isCycleDay: boolean;
}

/** 用服务端时区算 dateKey，客户端改时间无效 */
export function dateKeyOf(d: Date, tzOffsetMinutes = 480): string {
  // 默认 Asia/Shanghai = UTC+8
  const ms = d.getTime() + tzOffsetMinutes * 60_000;
  const t = new Date(ms);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function prevDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return dateKeyOf(t, 0);
}

export class CheckinService {
  private states = new Map<string, CheckinState>();
  private done = new Set<string>();  // dateKey:userId

  constructor(private ledger: Ledger) {}

  /** 幂等：同一天重复签到返回已有结果，不重复发星 */
  checkIn(userId: string, now: Date): CheckinResult {
    const dateKey = dateKeyOf(now);
    const key = dateKey + ':' + userId;

    if (this.done.has(key)) {
      const st = this.states.get(userId);
      throw new AppError('CHECKIN_ALREADY_DONE', 'already checked in today');
    }

    const state = this.states.get(userId) ?? { lastDateKey: null, currentStreak: 0 };
    const continuous = state.lastDateKey === prevDateKey(dateKey);
    const streak = continuous ? state.currentStreak + 1 : 1;
    const isCycleDay = streak % CHECKIN.cycleLength === 0;

    const gained = isCycleDay && CHECKIN.day7Mode === 'replace' ? CHECKIN.cycleBonus : CHECKIN.base;
    const bizType = isCycleDay && CHECKIN.day7Mode === 'replace' ? 'checkin_cycle' : 'checkin';

    this.ledger.mint(userId, gained, bizType, key, 'checkin ' + dateKey);

    this.done.add(key);
    this.states.set(userId, { lastDateKey: dateKey, currentStreak: streak });

    return { dateKey, streak, gained, isCycleDay };
  }

  stateOf(userId: string): CheckinState {
    return this.states.get(userId) ?? { lastDateKey: null, currentStreak: 0 };
  }
}

/** 任务状态机（v1.2 §5.1） */
export type TaskStatus =
  | 'assigned'
  | 'accepted'
  | 'submitted'
  | 'confirmed'
  | 'rejected'
  | 'declined'
  | 'abandoned'
  | 'cancelled'
  | 'expired';

export interface Task {
  id: string;
  origin: 'system' | 'custom';
  publisherId: string | null;
  assigneeId: string;
  title: string;
  reward: number;
  status: TaskStatus;
  submittedAt?: Date;
  confirmedBy?: string;
  createdAt: Date;
}

export class TaskService {
  tasks = new Map<string, Task>();
  private seq = 0;

  constructor(private ledger: Ledger) {}

  private nextId(): string {
    this.seq += 1;
    return 'task-' + String(this.seq).padStart(6, '0');
  }

  /** 发布自定义任务：立即扣星进托管（不是确认时才扣） */
  publishCustom(publisherId: string, assigneeId: string, title: string, reward: number, now = new Date()): Task {
    if (reward <= 0) throw new AppError('TASK_REWARD_INVALID');
    const id = this.nextId();

    // 余额不足时这里抛 STARS_INSUFFICIENT，整个操作不落库
    this.ledger.escrow(publisherId, reward, id);

    const task: Task = {
      id,
      origin: 'custom',
      publisherId,
      assigneeId,
      title,
      reward,
      status: 'assigned',
      createdAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  /** 接受 */
  accept(taskId: string, operatorId: string): Task {
    const t = this.get(taskId);
    if (t.status !== 'assigned') throw new AppError('TASK_ILLEGAL_TRANSITION');
    if (t.assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
    t.status = 'accepted';
    return t;
  }

  /** 拒绝（只有 assigned 能拒绝，全额退款） */
  decline(taskId: string, operatorId: string): Task {
    const t = this.get(taskId);
    if (t.status !== 'assigned') throw new AppError('TASK_ILLEGAL_TRANSITION');
    if (t.assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
    this.refundIfCustom(t);
    t.status = 'declined';
    return t;
  }

  /** 提交 */
  submit(taskId: string, operatorId: string, now = new Date()): Task {
    const t = this.get(taskId);
    if (t.status !== 'accepted') throw new AppError('TASK_ILLEGAL_TRANSITION');
    if (t.assigneeId !== operatorId) throw new AppError('TASK_NOT_ALLOWED');
    t.status = 'submitted';
    t.submittedAt = now;
    return t;
  }

  /** 确认发星：确认人必须是执行人的对方 */
  confirm(taskId: string, confirmerId: string, now = new Date()): Task {
    const t = this.get(taskId);
    if (t.status !== 'submitted') throw new AppError('TASK_ILLEGAL_TRANSITION');
    if (t.assigneeId === confirmerId) throw new AppError('TASK_CANNOT_CONFIRM_OWN');

    if (t.origin === 'system') {
      this.ledger.mint(t.assigneeId, t.reward, 'task_reward', t.id, 'system task reward');
    } else {
      this.ledger.settle(t.assigneeId, t.reward, t.id);
    }
    t.status = 'confirmed';
    t.confirmedBy = confirmerId;
    return t;
  }

  /** 7 天自动确认 */
  autoConfirmStale(now: Date, days = 7): Task[] {
    const cutoff = now.getTime() - days * 24 * 3600 * 1000;
    const out: Task[] = [];
    for (const t of this.tasks.values()) {
      if (t.status === 'submitted' && t.submittedAt && t.submittedAt.getTime() < cutoff) {
        this.confirm(t.id, 'system', now);
        out.push(t);
      }
    }
    return out;
  }

  /** 放弃 / 取消（退款） */
  cancel(taskId: string, operatorId: string): Task {
    const t = this.get(taskId);
    if (t.status === 'confirmed' || t.status === 'cancelled') {
      throw new AppError('TASK_ILLEGAL_TRANSITION');
    }
    const allowed = operatorId === t.publisherId || operatorId === t.assigneeId;
    if (!allowed) throw new AppError('TASK_NOT_ALLOWED');
    this.refundIfCustom(t);
    t.status = operatorId === t.assigneeId ? 'abandoned' : 'cancelled';
    return t;
  }

  private refundIfCustom(t: Task) {
    if (t.origin !== 'custom' || !t.publisherId) return;
    this.ledger.refund(t.publisherId, t.reward, t.id);
  }

  get(taskId: string): Task {
    const t = this.tasks.get(taskId);
    if (!t) throw new AppError('TASK_NOT_FOUND');
    return t;
  }
}

/** 物品兑换（v1.2 §2） */
export type RedemptionStatus = 'pending' | 'fulfilled';

export interface Item {
  id: string;
  name: string;
  emoji: string;
  price: number;
  listed: boolean;
}

export interface Redemption {
  id: string;
  itemId: string;
  itemName: string;   // 快照
  itemEmoji: string;  // 快照
  priceStars: number; // 单价快照
  quantity: number;
  totalStars: number;
  redeemerId: string;
  fulfillBy: string;
  status: RedemptionStatus;
  note?: string;
  photoUrl?: string;
  fulfillNote?: string;
  fulfilledAt?: Date;
  createdAt: Date;
}

export const REDEMPTION = {
  maxQuantity: 99,     // P-48
  noteMaxLength: 100,  // P-45
  nudgeCooldownMs: 24 * 3600 * 1000,
};

export class RedemptionService {
  redemptions = new Map<string, Redemption>();
  private nudges = new Map<string, number>();  // redemptionId -> last nudge at
  private seq = 0;

  constructor(private ledger: Ledger, private items: Map<string, Item>) {}

  private nextId(): string {
    this.seq += 1;
    return 'rd-' + String(this.seq).padStart(6, '0');
  }

  /** 兑换：扣星销毁 + 落单，一个事务 */
  redeem(redeemerId: string, itemId: string, quantity: number, fulfillBy: string, note: string | undefined, now = new Date()): Redemption {
    const item = this.items.get(itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND');
    if (!item.listed) throw new AppError('ITEM_NOT_LISTED');
    if (!item.price || item.price <= 0) throw new AppError('ITEM_PRICE_INVALID');

    const qty = Math.max(1, Math.floor(quantity));
    if (qty > REDEMPTION.maxQuantity) throw new AppError('REDEMPTION_QTY_INVALID');
    if (note && note.length > REDEMPTION.noteMaxLength) throw new AppError('REDEMPTION_NOTE_TOO_LONG');
    if (redeemerId === fulfillBy) throw new AppError('REDEMPTION_NOT_ALLOWED');

    const id = this.nextId();
    const total = item.price * qty;

    // 余额不足时抛 STARS_INSUFFICIENT，兑换单不落库
    this.ledger.burn(redeemerId, total, id, 'redeem ' + item.name + ' x' + qty);

    const r: Redemption = {
      id,
      itemId,
      itemName: item.name,
      itemEmoji: item.emoji,
      priceStars: item.price,
      quantity: qty,
      totalStars: total,
      redeemerId,
      fulfillBy,
      status: 'pending',
      note,
      createdAt: now,
    };
    this.redemptions.set(id, r);
    return r;
  }

  /** 兑现：只改状态，不涉及任何星星流动 */
  fulfill(redemptionId: string, operatorId: string, photoUrl: string, note: string | undefined, now = new Date()): Redemption {
    const r = this.get(redemptionId);
    if (r.status === 'fulfilled') return r;   // 幂等
    if (r.fulfillBy !== operatorId) throw new AppError('REDEMPTION_NOT_ALLOWED');
    if (!photoUrl) throw new AppError('REDEMPTION_PHOTO_REQUIRED');  // P-46
    if (note && note.length > REDEMPTION.noteMaxLength) throw new AppError('REDEMPTION_NOTE_TOO_LONG');

    r.status = 'fulfilled';
    r.photoUrl = photoUrl;
    r.fulfillNote = note;
    r.fulfilledAt = now;
    return r;
  }

  /** 催一催：24 小时一次，不涉及星星 */
  nudge(redemptionId: string, operatorId: string, now = new Date()): { nextAllowedAt: Date } {
    const r = this.get(redemptionId);
    if (r.redeemerId !== operatorId) throw new AppError('REDEMPTION_NOT_ALLOWED');
    if (r.status === 'fulfilled') throw new AppError('REDEMPTION_ALREADY_FULFILLED');

    const last = this.nudges.get(redemptionId);
    if (last && now.getTime() - last < REDEMPTION.nudgeCooldownMs) {
      throw new AppError('NUDGE_TOO_FREQUENT');
    }
    this.nudges.set(redemptionId, now.getTime());
    return { nextAllowedAt: new Date(now.getTime() + REDEMPTION.nudgeCooldownMs) };
  }

  get(redemptionId: string): Redemption {
    const r = this.redemptions.get(redemptionId);
    if (!r) throw new AppError('REDEMPTION_NOT_FOUND');
    return r;
  }

  pendingFor(userId: string): Redemption[] {
    return [...this.redemptions.values()].filter((r) => r.fulfillBy === userId && r.status === 'pending');
  }

  mineFor(userId: string): Redemption[] {
    return [...this.redemptions.values()].filter((r) => r.redeemerId === userId);
  }
}
