import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from './ledger';
import { AuthError, hashPassword, verifyPassword, TokenService, LoginGuard, IdempotencyStore } from './auth';
import { CheckinService, TaskService, RedemptionService, OPENING, dateKeyOf, Item } from './domain';
import { createWorld, LedgerStore, Ledger } from './ledger';

/** 统一响应：{ ok, data } 或 { ok:false, error:{code,message}, traceId } */
function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}
function ok(res: ServerResponse, data: unknown) {
  send(res, 200, { ok: true, data });
}
function fail(res: ServerResponse, status: number, code: string, message: string, traceId: string) {
  send(res, status, { ok: false, error: { code, message }, traceId });
}

const CODE_TO_STATUS: Record<string, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_LOCKED: 423,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_REQUIRED: 401,
  STARS_INSUFFICIENT: 409,
  CHECKIN_ALREADY_DONE: 409,
  TASK_NOT_FOUND: 404,
  TASK_ILLEGAL_TRANSITION: 409,
  TASK_NOT_ALLOWED: 403,
  TASK_CANNOT_CONFIRM_OWN: 403,
  TASK_REWARD_INVALID: 400,
  ITEM_NOT_FOUND: 404,
  ITEM_NOT_LISTED: 409,
  ITEM_PRICE_INVALID: 409,
  REDEMPTION_NOT_FOUND: 404,
  REDEMPTION_NOT_ALLOWED: 403,
  REDEMPTION_QTY_INVALID: 400,
  REDEMPTION_PHOTO_REQUIRED: 400,
  REDEMPTION_ALREADY_FULFILLED: 409,
  REDEMPTION_NOTE_TOO_LONG: 400,
  NUDGE_TOO_FREQUENT: 429,
  AMOUNT_INVALID: 400,
  ACCOUNT_NOT_FOUND: 500,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
};

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new AppError('BODY_TOO_LARGE')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AppError('BODY_INVALID')); }
    });
    req.on('error', reject);
  });
}

export interface ServerOptions {
  jwtSecret: string;
  users: { id: string; username: string; password: string; displayName: string }[];
  items: Item[];
  port?: number;
}

export function buildServer(opts: ServerOptions) {
  const { store, ledger } = createWorld(opts.users.map((u) => u.id));
  const checkin = new CheckinService(ledger);
  const tasks = new TaskService(ledger);
  const itemsMap = new Map(opts.items.map((i) => [i.id, i]));
  const redemptions = new RedemptionService(ledger, itemsMap);

  const tokens = new TokenService(opts.jwtSecret, 2 * 3600_000);
  const guard = new LoginGuard();
  const idem = new IdempotencyStore();

  const passwords = new Map<string, string>();
  const byId = new Map<string, { id: string; username: string; displayName: string }>();
  for (const u of opts.users) {
    passwords.set(u.username, hashPassword(u.password));
    byId.set(u.id, { id: u.id, username: u.username, displayName: u.displayName });
  }
  const partnerOf = (id: string) => opts.users.find((u) => u.id !== id)!.id;

  // 开户礼：每个用户一次性（幂等键含 userId）
  for (const u of opts.users) {
    ledger.mint(u.id, OPENING, 'opening', 'init:' + u.id, '开户礼');
  }

  function auth(req: IncomingMessage): { id: string } {
    const h = req.headers.authorization ?? '';
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) throw new AuthError('AUTH_REQUIRED', 'missing token');
    const v = tokens.verify(m[1]);
    if (!v) throw new AuthError('AUTH_TOKEN_EXPIRED', 'invalid or expired token');
    return { id: v.userId };
  }

  const server = createServer(async (req, res) => {
    const traceId = Math.random().toString(36).slice(2, 10);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method ?? 'GET';

    try {
      // ---------- 公开 ----------
      if (path === '/auth/login' && method === 'POST') {
        const body = await readBody(req);
        const username = String(body.username ?? '');
        guard.check(username);
        const stored = passwords.get(username);
        if (!stored || !verifyPassword(String(body.password ?? ''), stored)) {
          guard.fail(username);
          throw new AuthError('AUTH_INVALID_CREDENTIALS', 'wrong username or password');
        }
        guard.reset(username);
        const user = opts.users.find((u) => u.username === username)!;
        return ok(res, {
          accessToken: tokens.issue(user.id),
          user: byId.get(user.id),
          partner: byId.get(partnerOf(user.id)),
        });
      }

      if (path === '/health' && method === 'GET') {
        return ok(res, { status: 'up', ledger: ledger.reconcile() });
      }

      // ---------- 需要登录 ----------
      const me = auth(req);

      if (path === '/me' && method === 'GET') {
        return ok(res, {
          user: byId.get(me.id),
          partner: byId.get(partnerOf(me.id)),
          balance: store.userAccount(me.id).balance,
          partnerBalance: store.userAccount(partnerOf(me.id)).balance,
        });
      }

      if (path === '/wallet' && method === 'GET') {
        return ok(res, {
          balance: store.userAccount(me.id).balance,
          escrowed: store.escrowAccount().balance,
        });
      }

      if (path === '/wallets' && method === 'GET') {
        return ok(res, {
          mine: store.userAccount(me.id).balance,
          partner: store.userAccount(partnerOf(me.id)).balance,
        });
      }

      // ---------- 签到 ----------
      if (path === '/checkin' && method === 'POST') {
        const r = checkin.checkIn(me.id, new Date());
        return ok(res, { ...r, balance: store.userAccount(me.id).balance });
      }
      if (path === '/checkin/state' && method === 'GET') {
        return ok(res, { ...checkin.stateOf(me.id), today: dateKeyOf(new Date()) });
      }

      // ---------- 任务 ----------
      if (path === '/tasks' && method === 'GET') {
        const scope = url.searchParams.get('scope') ?? 'all';
        const all = [...tasks.tasks.values()];
        const list = scope === 'assigned'
          ? all.filter((t) => t.assigneeId === me.id)
          : scope === 'published'
            ? all.filter((t) => t.publisherId === me.id)
            : all.filter((t) => t.assigneeId === me.id || t.publisherId === me.id);
        return ok(res, list);
      }
      if (path === '/tasks' && method === 'POST') {
        const key = req.headers['idempotency-key'] as string | undefined;
        if (key) {
          const hit = idem.get(key);
          if (hit.hit) return ok(res, hit.result);
        }
        const body = await readBody(req);
        const t = tasks.publishCustom(me.id, partnerOf(me.id), String(body.title ?? ''), Number(body.reward ?? 0));
        if (key) idem.set(key, t);
        return ok(res, t);
      }
      const taskAction = /^\/tasks\/([^/]+)\/(accept|decline|submit|confirm|cancel)$/.exec(path);
      if (taskAction && method === 'POST') {
        const [, id, action] = taskAction;
        let t;
        if (action === 'accept') t = tasks.accept(id, me.id);
        else if (action === 'decline') t = tasks.decline(id, me.id);
        else if (action === 'submit') t = tasks.submit(id, me.id);
        else if (action === 'confirm') t = tasks.confirm(id, me.id);
        else t = tasks.cancel(id, me.id);
        return ok(res, t);
      }
      if (path === '/tasks/pending-confirm' && method === 'GET') {
        const list = [...tasks.tasks.values()].filter(
          (t) => t.status === 'submitted' && t.assigneeId !== me.id,
        );
        return ok(res, list);
      }

      // ---------- 物品 ----------
      if (path === '/items' && method === 'GET') {
        return ok(res, [...itemsMap.values()].filter((i) => i.listed));
      }
      const itemOne = /^\/items\/([^/]+)$/.exec(path);
      if (itemOne && method === 'GET') {
        const it = itemsMap.get(itemOne[1]);
        if (!it) throw new AppError('ITEM_NOT_FOUND');
        return ok(res, it);
      }

      // ---------- 兑换 ----------
      if (path === '/redemptions' && method === 'POST') {
        const key = req.headers['idempotency-key'] as string | undefined;
        if (key) {
          const hit = idem.get(key);
          if (hit.hit) return ok(res, hit.result);
        }
        const body = await readBody(req);
        const r = redemptions.redeem(
          me.id,
          String(body.itemId ?? ''),
          Number(body.quantity ?? 1),
          partnerOf(me.id),
          body.note ? String(body.note) : undefined,
        );
        if (key) idem.set(key, r);
        return ok(res, r);
      }
      if (path === '/redemptions' && method === 'GET') {
        const scope = url.searchParams.get('scope') ?? 'mine';
        const list = scope === 'inbox' ? redemptions.pendingFor(me.id) : redemptions.mineFor(me.id);
        return ok(res, list);
      }
      const rdAction = /^\/redemptions\/([^/]+)\/(fulfill|nudge)$/.exec(path);
      if (rdAction && method === 'POST') {
        const [, id, action] = rdAction;
        if (action === 'fulfill') {
          const body = await readBody(req);
          const r = redemptions.fulfill(id, me.id, String(body.photoUrl ?? ''), body.note ? String(body.note) : undefined);
          return ok(res, r);
        }
        return ok(res, redemptions.nudge(id, me.id));
      }

      // ---------- 对账 ----------
      if (path === '/reconcile' && method === 'GET') {
        return ok(res, ledger.reconcile());
      }

      throw new AppError('NOT_FOUND', 'no route for ' + method + ' ' + path);
    } catch (e: any) {
      const code = e?.code ?? 'INTERNAL';
      const status = CODE_TO_STATUS[code] ?? 500;
      return fail(res, status, code, e?.message ?? 'internal error', traceId);
    }
  });

  return { server, store, ledger, checkin, tasks, redemptions, itemsMap, tokens };
}
