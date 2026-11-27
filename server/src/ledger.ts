/**
 * 账本内核 —— 星星流动的唯一入口
 *
 * 三条不可违反的约定：
 *   1. 星星只能通过 transfer() 变动，任何地方直接改 balance 都会破坏 sum=0
 *   2. 涉及星星的写操作必须在同一个事务内
 *   3. 状态变更与记账在同一事务
 */

export type AccountKind = 'user' | 'issue' | 'escrow';

export type BizType =
  | 'opening'
  | 'checkin'
  | 'checkin_cycle'
  | 'task_reward'
  | 'task_escrow'
  | 'task_settle'
  | 'task_refund'
  | 'task_penalty'
  | 'gift'
  | 'burn'
  | 'adjust';

export interface Account {
  id: string;
  kind: AccountKind;
  ownerId: string | null;
  balance: number;
  version: number;
}

export interface LedgerOp {
  id: string;
  bizType: BizType;
  bizId: string;
  amount: number;
  memo?: string;
  createdAt: Date;
}

export interface LedgerEntry {
  opId: string;
  accountId: string;
  delta: number;
  balanceAfter: number;
}

/** 业务错误，带错误码，与文档 §6.3 对齐 */
export class AppError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

/** 内存存储，后续换 Prisma 时只需替换 Repository */
export class LedgerStore {
  accounts = new Map<string, Account>();
  ops: LedgerOp[] = [];
  entries: LedgerEntry[] = [];
  private opKey = new Set<string>();

  createAccount(kind: AccountKind, ownerId: string | null, balance = 0): Account {
    const acc: Account = {
      id: ownerId ? ownerId + ':' + kind : kind,
      kind,
      ownerId,
      balance,
      version: 0,
    };
    this.accounts.set(acc.id, acc);
    return acc;
  }

  userAccount(userId: string): Account {
    const a = this.accounts.get(userId + ':user');
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'user account missing: ' + userId);
    return a;
  }

  issueAccount(): Account {
    const a = this.accounts.get('issue');
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'issue account missing');
    return a;
  }

  escrowAccount(): Account {
    const a = this.accounts.get('escrow');
    if (!a) throw new AppError('ACCOUNT_NOT_FOUND', 'escrow account missing');
    return a;
  }

  hasOp(bizType: BizType, bizId: string): boolean {
    return this.opKey.has(bizType + '|' + bizId);
  }

  recordOp(op: LedgerOp) {
    this.opKey.add(op.bizType + '|' + op.bizId);
    this.ops.push(op);
  }

  /** 全局不变式：必须恒为 0 */
  sumBalance(): number {
    let s = 0;
    for (const a of this.accounts.values()) s += a.balance;
    return s;
  }

  /** 净发行量 = 发行 - 销毁 */
  netIssued(): number {
    return -this.issueAccount().balance;
  }

  /** 累计发行量（只增不减，不因销毁而减少） */
  totalIssued(): number {
    const mint: BizType[] = ['opening', 'checkin', 'checkin_cycle', 'task_reward'];
    return this.ops
      .filter((o) => mint.includes(o.bizType))
      .reduce((sum, o) => sum + o.amount, 0);
  }

  /** 已销毁量 = 累计发行 - 净发行 */
  burned(): number {
    return this.totalIssued() - this.netIssued();
  }
}

let seq = 0;
function uuidv7(): string {
  // 测试用的单调递增 ID，生产环境换真正的 uuidv7
  seq += 1;
  return 'op-' + String(seq).padStart(8, '0');
}

export class Ledger {
  constructor(private store: LedgerStore) {}

  /**
   * 唯一的星星流动入口。
   * 幂等键 = (bizType, bizId)，同一业务重复调用只记一次。
   */
  transfer(p: {
    from: string;
    to: string;
    amount: number;
    bizType: BizType;
    bizId: string;
    memo?: string;
  }): LedgerOp {
    if (!Number.isInteger(p.amount) || p.amount <= 0) {
      throw new AppError('AMOUNT_INVALID', 'amount must be a positive integer');
    }
    if (p.from === p.to) {
      throw new AppError('ACCOUNT_SAME', 'from and to must differ');
    }

    // 1) 幂等：同一业务已做过 → 直接返回
    if (this.store.hasOp(p.bizType, p.bizId)) {
      const existing = this.store.ops.find(
        (o) => o.bizType === p.bizType && o.bizId === p.bizId,
      );
      if (existing) return existing;
    }

    const from = this.store.accounts.get(p.from);
    const to = this.store.accounts.get(p.to);
    if (!from) throw new AppError('ACCOUNT_NOT_FOUND', 'from account missing');
    if (!to) throw new AppError('ACCOUNT_NOT_FOUND', 'to account missing');

    // 2) 借：from（用户账户不许透支）
    const fromNext = from.balance - p.amount;
    if (from.kind === 'user' && fromNext < 0) {
      throw new AppError('STARS_INSUFFICIENT', 'balance would go negative');
    }

    // 3) 贷：to
    const toNext = to.balance + p.amount;

    const op: LedgerOp = {
      id: uuidv7(),
      bizType: p.bizType,
      bizId: p.bizId,
      amount: p.amount,
      memo: p.memo,
      createdAt: new Date(),
    };

    from.balance = fromNext;
    from.version += 1;
    to.balance = toNext;
    to.version += 1;

    this.store.recordOp(op);
    this.store.entries.push(
      { opId: op.id, accountId: from.id, delta: -p.amount, balanceAfter: fromNext },
      { opId: op.id, accountId: to.id, delta: p.amount, balanceAfter: toNext },
    );

    return op;
  }

  /** 发行：issue → 用户 */
  mint(userId: string, amount: number, bizType: BizType, bizId: string, memo?: string) {
    return this.transfer({
      from: this.store.issueAccount().id,
      to: this.store.userAccount(userId).id,
      amount,
      bizType,
      bizId,
      memo,
    });
  }

  /** 销毁：用户 → issue（兑换物品） */
  burn(userId: string, amount: number, redemptionId: string, memo?: string) {
    return this.transfer({
      from: this.store.userAccount(userId).id,
      to: this.store.issueAccount().id,
      amount,
      bizType: 'burn',
      bizId: redemptionId,
      memo,
    });
  }

  /** 转移：用户 → 用户（当前无此场景，保留接口以防未来） */
  userToUser(fromId: string, toId: string, amount: number, bizType: BizType, bizId: string) {
    return this.transfer({
      from: this.store.userAccount(fromId).id,
      to: this.store.userAccount(toId).id,
      amount,
      bizType,
      bizId,
    });
  }

  /** 托管：用户 → escrow（发布任务） */
  escrow(userId: string, amount: number, taskId: string) {
    return this.transfer({
      from: this.store.userAccount(userId).id,
      to: this.store.escrowAccount().id,
      amount,
      bizType: 'task_escrow',
      bizId: taskId,
    });
  }

  /** 结算：escrow → 用户（确认任务） */
  settle(userId: string, amount: number, taskId: string) {
    return this.transfer({
      from: this.store.escrowAccount().id,
      to: this.store.userAccount(userId).id,
      amount,
      bizType: 'task_settle',
      bizId: taskId,
    });
  }

  /** 退款：escrow → 用户（拒绝 / 放弃 / 取消） */
  refund(userId: string, amount: number, taskId: string) {
    return this.transfer({
      from: this.store.escrowAccount().id,
      to: this.store.userAccount(userId).id,
      amount,
      bizType: 'task_refund',
      bizId: taskId,
    });
  }

  /** 对账：sum(balance) 必须为 0 */
  reconcile() {
    const sum = this.store.sumBalance();
    return {
      ok: sum === 0,
      sum,
      circulating: [...this.store.accounts.values()]
        .filter((a) => a.kind === 'user')
        .reduce((s, a) => s + a.balance, 0),
      escrowed: this.store.escrowAccount().balance,
      netIssued: this.store.netIssued(),
      totalIssued: this.store.totalIssued(),
      burned: this.store.burned(),
    };
  }
}

/** 建一个空的世界：两个用户 + issue + escrow */
export function createWorld(users: string[]) {
  const store = new LedgerStore();
  store.createAccount('issue', null, 0);
  store.createAccount('escrow', null, 0);
  for (const u of users) store.createAccount('user', u, 0);
  const ledger = new Ledger(store);
  return { store, ledger };
}
