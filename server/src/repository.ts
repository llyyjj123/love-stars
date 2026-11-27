import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from './ledger';

/**
 * Prisma 存储层
 *
 * 核心：transfer() 在一个事务里完成「行锁 → 校验 → 双分录 → 更新余额」。
 * 所有星星流动都必须走这里，业务层不允许直接 update Account.balance。
 */

export type Tx = Prisma.TransactionClient;

export interface TransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  bizType: string;
  bizId: string;
  memo?: string;
}

/** 幂等键：同一 (bizType, bizId) 只成功一次 */
export async function findOp(tx: Tx | PrismaClient, bizType: string, bizId: string) {
  return tx.ledgerOp.findUnique({ where: { bizType_bizId: { bizType, bizId } } });
}

/** 借：行锁 + 校验不透支 + 写分录 + 更新余额 */
async function debit(tx: Tx, opId: string, accountId: string, amount: number) {
  const rows = await tx.$queryRaw<{ id: string; kind: string; balance: number }[]>`
    SELECT id, kind, balance FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
  const acc = rows[0];
  if (!acc) throw new AppError('ACCOUNT_NOT_FOUND', 'account ' + accountId);

  const next = acc.balance - amount;
  if (acc.kind === 'user' && next < 0) {
    throw new AppError('STARS_INSUFFICIENT', 'balance would go negative');
  }

  await tx.ledgerEntry.create({
    data: { opId, accountId, delta: -amount, balanceAfter: next },
  });
  await tx.account.update({
    where: { id: accountId },
    data: { balance: next, version: { increment: 1 } },
  });
}

/** 贷 */
async function credit(tx: Tx, opId: string, accountId: string, amount: number) {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
  const acc = rows[0];
  if (!acc) throw new AppError('ACCOUNT_NOT_FOUND', 'account ' + accountId);

  const next = acc.balance + amount;
  await tx.ledgerEntry.create({
    data: { opId, accountId, delta: amount, balanceAfter: next },
  });
  await tx.account.update({
    where: { id: accountId },
    data: { balance: next, version: { increment: 1 } },
  });
}

/** 唯一的星星流动入口 */
export async function transfer(tx: Tx, p: TransferParams) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) {
    throw new AppError('AMOUNT_INVALID', 'amount must be a positive integer');
  }
  if (p.fromAccountId === p.toAccountId) {
    throw new AppError('ACCOUNT_SAME', 'from and to must differ');
  }

  const existing = await findOp(tx, p.bizType, p.bizId);
  if (existing) return existing;

  const op = await tx.ledgerOp.create({
    data: { bizType: p.bizType, bizId: p.bizId, amount: p.amount, memo: p.memo ?? null },
  });

  await debit(tx, op.id, p.fromAccountId, p.amount);
  await credit(tx, op.id, p.toAccountId, p.amount);

  return op;
}

/** 对账：sum(balance) 必须为 0 */
export async function reconcile(client: PrismaClient) {
  const agg = await client.account.aggregate({ _sum: { balance: true } });
  const sum = agg._sum.balance ?? 0;

  const users = await client.account.aggregate({
    where: { kind: 'user' },
    _sum: { balance: true },
  });
  const escrow = await client.account.findFirst({ where: { kind: 'escrow' } });
  const issue = await client.account.findFirst({ where: { kind: 'issue' } });

  // ★ 发行/销毁直接从 issue 账户的分录方向推导，不依赖 bizType 白名单
  //    issue 分录 delta < 0  → 星从 issue 流出 → 发行
  //    issue 分录 delta > 0  → 星回到 issue   → 销毁
  let totalIssued = 0;
  let burned = 0;
  if (issue) {
    const entries = await client.ledgerEntry.findMany({
      where: { accountId: issue.id },
      select: { delta: true },
    });
    for (const e of entries) {
      if (e.delta < 0) totalIssued += -e.delta;
      else burned += e.delta;
    }
  }

  const netIssued = -(issue?.balance ?? 0);

  return {
    ok: sum === 0,
    sum,
    circulating: users._sum.balance ?? 0,
    escrowed: escrow?.balance ?? 0,
    netIssued,
    totalIssued,
    burned,
  };
}
