import { createHash, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';

/**
 * 密码哈希：scrypt（Node 内置，无需 argon2 原生依赖）
 * 生产环境建议换 argon2id，接口保持一致。
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(plain, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** 极简令牌：签名 = sha256(secret + payload)，够用且无第三方依赖 */
export class TokenService {
  constructor(private secret: string, private ttlMs: number) {}

  issue(userId: string, now = Date.now()): string {
    const exp = now + this.ttlMs;
    const payload = userId + '.' + exp;
    const sig = createHash('sha256').update(this.secret + payload).digest('hex').slice(0, 32);
    return Buffer.from(payload + '.' + sig).toString('base64url');
  }

  verify(token: string, now = Date.now()): { userId: string; exp: number } | null {
    let raw: string;
    try { raw = Buffer.from(token, 'base64url').toString('utf8'); } catch { return null; }
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [userId, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < now) return null;
    const expected = createHash('sha256').update(this.secret + userId + '.' + expStr).digest('hex').slice(0, 32);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { userId, exp };
  }
}

/** 登录失败计数（防暴力破解），单机内存即可 */
export class LoginGuard {
  private fails = new Map<string, { count: number; lockedUntil?: number }>();

  constructor(private maxFails = 5, private lockMs = 15 * 60_000) {}

  check(username: string, now = Date.now()): void {
    const rec = this.fails.get(username);
    if (rec?.lockedUntil && rec.lockedUntil > now) {
      throw new AuthError('AUTH_LOCKED', 'too many failed attempts');
    }
  }

  fail(username: string, now = Date.now()): void {
    const rec = this.fails.get(username) ?? { count: 0 };
    rec.count += 1;
    if (rec.count >= this.maxFails) rec.lockedUntil = now + this.lockMs;
    this.fails.set(username, rec);
  }

  reset(username: string): void {
    this.fails.delete(username);
  }
}

export class AuthError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}

/** 幂等键存储：key -> 已产生的响应，24 小时过期 */
export class IdempotencyStore {
  private store = new Map<string, { at: number; result: unknown }>();

  constructor(private ttlMs = 24 * 3600_000) {}

  get(key: string, now = Date.now()): { hit: boolean; result?: unknown } {
    const rec = this.store.get(key);
    if (!rec) return { hit: false };
    if (now - rec.at > this.ttlMs) {
      this.store.delete(key);
      return { hit: false };
    }
    return { hit: true, result: rec.result };
  }

  set(key: string, result: unknown, now = Date.now()): void {
    this.store.set(key, { at: now, result });
  }
}
