import { createServer, IncomingMessage, ServerResponse } from 'node:http';
// 生产环境与本地开发统一读取 .env；显式环境变量仍具有更高优先级。
import 'dotenv/config';
import { prisma } from './prisma';
import { PrismaService, dateKeyOf } from './prisma-service';
import { hashPassword, verifyPassword, TokenService, LoginGuard, IdempotencyStore } from './auth';
import { RealtimeHub, OutboxConsumer } from './realtime';
import { MediaStore, MEDIA } from './media';
import { WeChatNotifier } from './notify';
// 任务库单独放一个模块：reset.ts 也要用它把模板池灌回去
import { SYSTEM_TASKS } from './system-tasks';

/** CORS —— Flutter Web 调试时浏览器会做预检，必须放行 */
function cors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization,idempotency-key');
  res.setHeader('access-control-max-age', '86400');
}

function send(res: ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
const ok = (res: ServerResponse, data: unknown) => send(res, 200, { ok: true, data });
const fail = (res: ServerResponse, s: number, code: string, msg: string, traceId: string) =>
  send(res, s, { ok: false, error: { code, message: msg }, traceId });

const STATUS: Record<string, number> = {
  AUTH_INVALID_CREDENTIALS: 401, AUTH_LOCKED: 423, AUTH_TOKEN_EXPIRED: 401, AUTH_REQUIRED: 401,
  STARS_INSUFFICIENT: 409, CHECKIN_ALREADY_DONE: 409,
  TASK_NOT_FOUND: 404, TASK_ILLEGAL_TRANSITION: 409, TASK_NOT_ALLOWED: 403, TASK_CANNOT_CONFIRM_OWN: 403, TASK_REWARD_INVALID: 400,
  TASK_ALREADY_SUBMITTED: 409, GIFT_AMOUNT_INVALID: 400, GIFT_DAILY_LIMIT: 429, GIFT_NOT_ALLOWED: 403, GIFT_NOTE_TOO_LONG: 400,
  ITEM_NOT_FOUND: 404, ITEM_NOT_LISTED: 409, ITEM_PRICE_INVALID: 409,
  REDEMPTION_NOT_FOUND: 404, REDEMPTION_NOT_ALLOWED: 403, REDEMPTION_QTY_INVALID: 400,
  REDEMPTION_PHOTO_REQUIRED: 400, REDEMPTION_ALREADY_FULFILLED: 409, REDEMPTION_NOTE_TOO_LONG: 400,
  NUDGE_TOO_FREQUENT: 429, AMOUNT_INVALID: 400, ACCOUNT_NOT_FOUND: 500, NOT_FOUND: 404,
  UPLOAD_EMPTY: 400, UPLOAD_TOO_LARGE: 413, UPLOAD_BAD_TYPE: 415, UPLOAD_BAD_REQUEST: 400,
};

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) return reject(new Error('BODY_TOO_LARGE'));
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('BODY_INVALID')); }
    });
    req.on('error', reject);
  });
}

/** 读原始 body（multipart 需要原始字节，不能当 JSON 解析） */
function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) return reject(Object.assign(new Error('body too large'), { code: 'UPLOAD_TOO_LARGE' }));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const svc = new PrismaService(prisma);
const tokens = new TokenService(SECRET, 2 * 3600_000);
const guard = new LoginGuard();
const idem = new IdempotencyStore();
const hub = new RealtimeHub(tokens);
const consumer = new OutboxConsumer(prisma, hub, 500);
const notifier = new WeChatNotifier({
  'user-a': process.env.SERVERCHAN_KEY_A ?? '',
  'user-b': process.env.SERVERCHAN_KEY_B ?? '',
});
const mediaStore = new MediaStore(
  process.env.MEDIA_ROOT ?? './data/media',
  process.env.MEDIA_PUBLIC_BASE ?? 'http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/media',
);
/** 兑现照片必须是本服务已上传的媒体，不能由客户端填任意 URL。 */
function ownPhotoUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const root = (process.env.MEDIA_PUBLIC_BASE ?? 'http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/media').replace(/\/$/, '');
  const name = raw.startsWith(root + '/') ? raw.slice(root.length + 1) : '';
  if (!/^[a-f0-9]{16}\.(jpg|png|webp|gif)$/.test(name)) {
    throw Object.assign(new Error('photo must be uploaded through /media'), { code: 'REDEMPTION_PHOTO_REQUIRED' });
  }
  return root + '/' + name;
}

const USERS = [
  { id: 'user-a', slot: 1, username: process.env.USER_A_USERNAME ?? 'a', password: process.env.USER_A_PASSWORD ?? 'a123456', displayName: '杰' },
  { id: 'user-b', slot: 2, username: process.env.USER_B_USERNAME ?? 'b', password: process.env.USER_B_PASSWORD ?? 'b123456', displayName: '媛' },
];
const partnerOf = (id: string) => (USERS.find((u) => u.id !== id) ?? USERS[0]).id;
const byId = new Map(USERS.map((u) => [u.id, { id: u.id, username: u.username, displayName: u.displayName }]));

const ITEMS = [
  {
    id: 'hug', name: '一个拥抱', emoji: '🤗', priceStars: 4, sortKey: 1, asset: 'hug.jpg',
    description: '给彼此一个认真的拥抱，不敷衍、不赶时间，把今天的小疲惫先放下。',
  },
  {
    id: 'kiss', name: '一个亲亲', emoji: '😘', priceStars: 6, sortKey: 2, asset: 'kiss.jpg',
    description: '送上一个温柔的亲亲，用简单的方式表达想念，具体方式以双方都自在为准。',
  },
  {
    id: 'tea', name: '奶茶', emoji: '🧋', priceStars: 15, sortKey: 3, asset: 'tea.jpg',
    description: '由 TA 请你喝一杯奶茶，品牌、口味、甜度和温度由兑换人选择。',
  },
  {
    id: 'walk', name: '一起散步', emoji: '🚶', priceStars: 20, sortKey: 4, asset: 'walk.jpg',
    description: '找一段双方都有空的时间，一起散步 30 分钟，不赶路线，好好聊天。',
  },
  {
    id: 'burger', name: '汉堡', emoji: '🍔', priceStars: 24, sortKey: 5, asset: 'burger.jpg',
    description: '由 TA 请你吃一个汉堡，具体门店、口味和是否搭配小食由两人商量。',
  },
  {
    id: 'massage', name: '捏捏肩 15 分钟', emoji: '💆', priceStars: 32, sortKey: 6, asset: 'massage.jpg',
    description: '由 TA 为你捏肩 15 分钟，力度以舒适为准，感到不适可以随时停止。',
  },
  {
    id: 'movie', name: '陪我看指定电影', emoji: '🎬', priceStars: 35, sortKey: 7, asset: 'movie.jpg',
    description: '由兑换人指定一部电影，另一方陪同看完，观看时间和平台由两人商量。',
  },
  {
    id: 'meal', name: '一顿漂亮饭', emoji: '🍽️', priceStars: 80, sortKey: 8, asset: 'meal.jpg',
    description: '安排一顿更有仪式感的饭，餐厅和预算提前商量，再留一张合影作纪念。',
  },
  {
    id: 'day', name: '听 TA 安排一天', emoji: '📅', priceStars: 240, sortKey: 9, asset: 'day.jpg',
    description: '提前约定一天，由 TA 优先配合你的合理心愿；不涉及安全、隐私、大额消费或违背意愿的要求。',
  },
];

async function bootstrap() {
  await svc.bootstrap(USERS.map((u) => ({
    id: u.id, slot: u.slot, username: u.username,
    passwordHash: hashPassword(u.password), displayName: u.displayName,
  })));
  for (const it of ITEMS) {
    // asset 是客户端内置图片文件名，不入库
    const { asset, ...row } = it;
    await prisma.item.upsert({
      where: { id: it.id },
      create: { ...row, coverUrl: asset, status: 'listed' },
      update: {
        name: row.name, emoji: row.emoji, priceStars: row.priceStars,
        description: row.description, sortKey: row.sortKey, coverUrl: asset, status: 'listed',
      },
    });
  }
  // 不在本次清单里的旧物品下架（保留历史兑换记录的快照字段）
  const keep = ITEMS.map((i) => i.id);
  await prisma.item.updateMany({
    where: { id: { notIn: keep }, status: 'listed' },
    data: { status: 'delisted' },
  });
  // 模板池：status='pending' 表示还没被抽走，不出现在任何任务列表里。
  // id 用 sys-NN，两个人共用同一批模板 id 会冲突，所以加用户前缀。
  for (const user of USERS) {
    for (const template of SYSTEM_TASKS) {
      const id = `${template.id}-${user.slot}`;
      await prisma.task.upsert({
        where: { id },
        create: {
          id, origin: 'system', assigneeId: user.id,
          title: template.title, description: template.description, reward: template.reward,
          status: 'pending',
        },
        update: {
          title: template.title, description: template.description, reward: template.reward,
        },
      });
    }
  }
  // 旧模板（system-template-*）清掉，避免和新的重复
  await prisma.task.deleteMany({ where: { id: { startsWith: 'system-template-' }, status: 'pending' } });
}

const server = createServer(async (req, res) => {
  const traceId = Math.random().toString(36).slice(2, 10);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const method = req.method ?? 'GET';

  try {
    if (method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (path === '/health' && method === 'GET') {
      return ok(res, { status: 'up', ledger: await svc.reconcile() });
    }

    if (path === '/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const username = String(body.username ?? '');
      guard.check(username);
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user || !verifyPassword(String(body.password ?? ''), user.passwordHash)) {
        guard.fail(username);
        throw Object.assign(new Error('wrong username or password'), { code: 'AUTH_INVALID_CREDENTIALS' });
      }
      guard.reset(username);
      return ok(res, {
        accessToken: tokens.issue(user.id),
        user: byId.get(user.id),
        partner: byId.get(partnerOf(user.id)),
      });
    }

    // ---------- 媒体：静态读取（无需鉴权，文件名是内容哈希，不可枚举） ----------
    const mediaGet = /^\/media\/([^/]+)$/.exec(path);
    if (mediaGet && method === 'GET') {
      const file = await mediaStore.read(mediaGet[1]);
      if (!file) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      cors(res);
      res.writeHead(200, {
        'content-type': file.mime,
        'content-length': String(file.buf.length),
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(file.buf);
      return;
    }

    // 鉴权
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw Object.assign(new Error('missing token'), { code: 'AUTH_REQUIRED' });
    const v = tokens.verify(m[1]);
    if (!v) throw Object.assign(new Error('invalid token'), { code: 'AUTH_TOKEN_EXPIRED' });
    const me = v.userId;

    if (path === '/me' && method === 'GET') {
      return ok(res, {
        user: byId.get(me), partner: byId.get(partnerOf(me)),
        balance: await svc.balanceOf(me), partnerBalance: await svc.balanceOf(partnerOf(me)),
      });
    }
    if (path === '/wallet' && method === 'GET') {
      const esc = await prisma.account.findFirst({ where: { kind: 'escrow' } });
      return ok(res, { balance: await svc.balanceOf(me), escrowed: esc?.balance ?? 0 });
    }
    if (path === '/wallets' && method === 'GET') {
      return ok(res, {
        mine: await svc.balanceOf(me),
        partner: await svc.balanceOf(partnerOf(me)),
        weekGain: await svc.weekGain(me),
      });
    }

    // 账本：服务端返回用户真实分录，客户端不推断、不计算余额。
    if (path === '/ledger' && method === 'GET') {
      const requested = Number(url.searchParams.get('limit') ?? 50);
      const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50;
      const cursor = url.searchParams.get('cursor');
      const account = await prisma.account.findFirst({ where: { kind: 'user', ownerId: me } });
      if (!account) throw Object.assign(new Error('account missing'), { code: 'ACCOUNT_NOT_FOUND' });
      let afterId: bigint | null = null;
      if (cursor) {
        try { afterId = BigInt(cursor); } catch { throw Object.assign(new Error('invalid cursor'), { code: 'CURSOR_INVALID' }); }
      }
      const entries = await prisma.ledgerEntry.findMany({
        where: { accountId: account.id, ...(afterId === null ? {} : { id: { lt: afterId } }) },
        include: { op: { select: { bizType: true, memo: true } } },
        orderBy: { id: 'desc' },
        take: limit + 1,
      });
      const hasMore = entries.length > limit;
      const page = hasMore ? entries.slice(0, limit) : entries;
      return ok(res, {
        items: page.map((e) => ({
          id: e.id.toString(), type: e.op.bizType, memo: e.op.memo,
          delta: e.delta, balanceAfter: e.balanceAfter, createdAt: e.createdAt,
        })),
        nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
      });
    }

    if (path === '/checkin' && method === 'POST') return ok(res, await svc.checkIn(me));
    if (path === '/checkin/state' && method === 'GET') {
      const s = await prisma.checkinStreak.findUnique({ where: { userId: me } });
      return ok(res, { currentStreak: s?.currentStreak ?? 0, lastDateKey: s?.lastDateKey ?? null, today: dateKeyOf(new Date()) });
    }

    if (path === '/tasks/system' && method === 'GET') {
      return ok(res, await svc.currentSystemTask(me));
    }
    // 抽一条预览：不写库，用户可以选择加入 / 换一个 / 算了
    if (path === '/tasks/draw' && method === 'POST') {
      const b = await readBody(req);
      const exclude = Array.isArray(b.exclude) ? b.exclude.map(String) : [];
      const task = await svc.drawSystemTask(me, exclude);
      return ok(res, task);
    }
    const joinM = /^\/tasks\/([^/]+)\/join$/.exec(path);
    if (joinM && method === 'POST') {
      return ok(res, await svc.joinSystemTask(joinM[1], me));
    }
    if (path === '/tasks' && method === 'GET') {
      const scope = url.searchParams.get('scope') ?? 'all';
      // pending=模板池；declined/abandoned/cancelled=用户已拒绝或放弃，界面不再显示。
      const live = { status: { notIn: ['pending', 'declined', 'abandoned', 'cancelled', 'expired'] } };
      // 「我在做」不含已完成；已完成单独查
      const active = { status: { in: ['assigned', 'accepted', 'submitted'] } };
      const where = scope === 'assigned' ? { assigneeId: me, ...active }
        : scope === 'published' ? { publisherId: me, ...active }
        // 已完成：只要 confirmed，不看 live 排除列表（confirmed 本来就不在里面）
        : scope === 'done' ? { status: 'confirmed', OR: [{ assigneeId: me }, { publisherId: me }] }
        : { ...live, OR: [{ assigneeId: me }, { publisherId: me }] };
      return ok(res, await prisma.task.findMany({ where, orderBy: { createdAt: 'desc' } }));
    }
    if (path === '/tasks' && method === 'POST') {
      const key = req.headers['idempotency-key'] as string | undefined;
      if (key) { const h = idem.get(key); if (h.hit) return ok(res, h.result); }
      const b = await readBody(req);
      const limitRaw = Number(b.timeLimitHours);
      const timeLimitHours = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 24 * 30) : null;
      const t = await svc.publishTask(me, partnerOf(me), String(b.title ?? ''), Number(b.reward ?? 0), timeLimitHours);
      if (key) idem.set(key, t);
      // 通知对方有新任务（不阻塞响应）
      notifier.fire(
        partnerOf(me),
        '新任务：' + t.title,
        [
          '**' + t.title + '**',
          '',
          '奖励：' + t.reward + ' 星',
          timeLimitHours ? '时限：' + timeLimitHours + ' 小时（接受后开始计时）' : '时限：不限',
          '',
          '打开 App 接受或拒绝。',
        ].join('\n'),
      );
      return ok(res, t);
    }
    const ta = /^\/tasks\/([^/]+)\/(accept|decline|submit|confirm|cancel)$/.exec(path);
    if (ta && method === 'POST') {
      let extra: { photoUrl?: string; note?: string } | undefined;
      if (ta[2] === 'submit') {
        const b = await readBody(req);
        const photo = b.photoUrl ? ownPhotoUrl(b.photoUrl) : undefined;
        const note = b.note ? String(b.note).slice(0, 200) : undefined;
        extra = { photoUrl: photo, note };
      }
      const result = await svc.taskAction(ta[1], me, ta[2] as any, extra);
      // 提交后通知确认方：自定义任务发给发布人，系统任务发给「另一位」
      const confirmer = result.publisherId ?? partnerOf(result.assigneeId);
      if (ta[2] === 'submit' && confirmer) {
        notifier.fire(
          confirmer,
          '等你确认：' + result.title,
          [
            '**' + result.title + '** 已提交',
            '',
            extra?.note ? '留言：' + extra.note : '',
            result.origin === 'system' ? '（系统任务，确认后星星由系统发放）' : '奖励：' + result.reward + ' 星',
            '',
            '打开 App 确认。',
          ].filter(Boolean).join('\n'),
        );
      }
      return ok(res, result);
    }
    if (path === '/tasks/pending-confirm' && method === 'GET') {
      // 我是确认方的任务：对方执行并提交了
      //   自定义任务：publisherId = 我
      //   系统任务：publisherId 为 null，确认方固定是「另一位」
      const partner = partnerOf(me);
      return ok(res, await prisma.task.findMany({
        where: {
          status: 'submitted',
          OR: [
            { publisherId: me },
            { publisherId: null, assigneeId: partner },
          ],
        },
        orderBy: { submittedAt: 'desc' },
      }));
    }

    const taskOne = /^\/tasks\/([^/]+)$/.exec(path);
    if (taskOne && method === 'GET') {
      const t = await prisma.task.findUnique({ where: { id: taskOne[1] } });
      if (!t) throw Object.assign(new Error('not found'), { code: 'TASK_NOT_FOUND' });
      // 只有参与方（执行人/发布人）或系统任务的确认方能看
      const partner = partnerOf(me);
      const canSee =
        t.assigneeId === me ||
        t.publisherId === me ||
        (t.origin === 'system' && t.assigneeId === partner);
      if (!canSee) throw Object.assign(new Error('forbidden'), { code: 'TASK_NOT_ALLOWED' });
      return ok(res, t);
    }

    if (path === '/items' && method === 'GET') {
      return ok(res, await prisma.item.findMany({ where: { status: 'listed' }, orderBy: { sortKey: 'asc' } }));
    }
    const io = /^\/items\/([^/]+)$/.exec(path);
    if (io && method === 'GET') {
      const it = await prisma.item.findUnique({ where: { id: io[1] } });
      if (!it) throw Object.assign(new Error('not found'), { code: 'ITEM_NOT_FOUND' });
      return ok(res, it);
    }

    if (path === '/redemptions' && method === 'POST') {
      const key = req.headers['idempotency-key'] as string | undefined;
      if (key) { const h = idem.get(key); if (h.hit) return ok(res, h.result); }
      const b = await readBody(req);
      const r = await svc.redeem(me, String(b.itemId ?? ''), Number(b.quantity ?? 1), partnerOf(me), b.note ? String(b.note) : undefined);
      if (key) idem.set(key, r);
      notifier.fire(
        partnerOf(me),
        '待兑现：' + r.itemName,
        [
          '**' + r.itemName + '** × ' + r.quantity,
          '',
          '消耗：' + r.totalStars + ' 星',
          r.note ? '留言：' + r.note : '',
          '',
          '打开 App 兑现并上传照片。',
        ].filter(Boolean).join('\n'),
      );
      return ok(res, r);
    }
    if (path === '/redemptions' && method === 'GET') {
      const scope = url.searchParams.get('scope') ?? 'mine';
      const where = scope === 'inbox' ? { fulfillBy: me, status: 'pending' } : { redeemerId: me };
      return ok(res, await prisma.redemption.findMany({ where, orderBy: { createdAt: 'desc' } }));
    }
    const ra = /^\/redemptions\/([^/]+)\/(fulfill|nudge)$/.exec(path);
    if (ra && method === 'POST') {
      if (ra[2] === 'fulfill') {
        const b = await readBody(req);
        const photoUrl = ownPhotoUrl(b.photoUrl);
        return ok(res, await svc.fulfill(ra[1], me, photoUrl, b.note ? String(b.note) : undefined));
      }
      return ok(res, await svc.nudge(ra[1], me));
    }

    // ---------- 媒体上传 ----------
    if (path === '/media' && method === 'POST') {
      const ct = String(req.headers['content-type'] ?? '');
      const boundary = MediaStore.boundaryOf(ct);
      if (!boundary) throw Object.assign(new Error('not multipart'), { code: 'UPLOAD_BAD_REQUEST' });

      const raw = await readRawBody(req, MEDIA.maxBytes + 1024 * 1024);
      const parts = MediaStore.parseMultipart(raw, boundary);
      const filePart = parts.find((p) => p.filename && p.data.length > 0);
      if (!filePart) throw Object.assign(new Error('no file field'), { code: 'UPLOAD_EMPTY' });

      const saved = await mediaStore.save(filePart.data);
      const notePart = parts.find((p) => p.field === 'note');
      return ok(res, { ...saved, note: notePart ? notePart.data.toString('utf8') : undefined });
    }

    // ---------- 送星星 ----------
    if (path === '/gifts' && method === 'POST') {
      const key = req.headers['idempotency-key'] as string | undefined;
      if (key) { const h = idem.get(key); if (h.hit) return ok(res, h.result); }
      const b = await readBody(req);
      const amount = Number(b.amount ?? 0);
      // 不在这里截断：交给服务层校验并返回 GIFT_NOTE_TOO_LONG，
      // 否则用户写了 300 字会被静默砍成 100 字，以为发全了。
      const note = b.note ? String(b.note) : undefined;
      const r = await svc.sendGift(me, partnerOf(me), amount, note);
      if (key) idem.set(key, r);
      notifier.fire(
        partnerOf(me),
        '收到星星：' + amount + ' 颗',
        [
          '**' + amount + ' 颗星星** 已经到你账上啦',
          '',
          note ? '小纸条：' + note : '',
          '',
          '打开 App 看看吧。',
        ].filter(Boolean).join('\n'),
      );
      return ok(res, r);
    }
    if (path === '/gifts' && method === 'GET') {
      const scope = url.searchParams.get('scope') === 'received' ? 'received' : 'sent';
      return ok(res, await svc.listGifts(me, scope));
    }

    if (path === '/reconcile' && method === 'GET') return ok(res, await svc.reconcile());

    if (path === '/realtime/stats' && method === 'GET') return ok(res, hub.stats());

    throw Object.assign(new Error('no route'), { code: 'NOT_FOUND' });
  } catch (e: any) {
    const code = e?.code ?? 'INTERNAL';
    return fail(res, STATUS[code] ?? 500, code, e?.message ?? 'internal error', traceId);
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/ws')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  hub.handleUpgrade(req, socket, head);
});

bootstrap().then(() => {
  consumer.start();
  const autoConfirm = async () => {
    try { await svc.autoConfirmStale(); }
    catch (e) { console.error('[scheduler] auto-confirm failed', e); }
  };
  void autoConfirm();
  const scheduler = setInterval(autoConfirm, 60 * 60_000);
  scheduler.unref();

  // 超时处理：每 5 分钟扫一次
  const expireTick = async () => {
    try {
      const done = await svc.expireOverdueTasks();
      if (done.length) console.log('[scheduler] expired', done.length, 'task(s)');
    } catch (e) {
      console.error('[scheduler] expire failed', e);
    }
  };
  void expireTick();
  const expireTimer = setInterval(expireTick, 5 * 60_000);
  expireTimer.unref();

  // 截止提醒：每 5 分钟扫一次，只在时间过半时提醒一次
  // （75% 和超时不再推：Server酱每 key 只有 5 条/天，多一档会挤掉「等你确认」）
  const remindTick = async () => {
    try {
      const due = await svc.dueReminders();
      for (const { task, alsoMark, remainMin } of due) {
        const hours = remainMin >= 60 ? Math.floor(remainMin / 60) + ' 小时' : remainMin + ' 分钟';
        notifier.fire(
          task.assigneeId,
          '任务提醒：' + task.title,
          [
            '**' + task.title + '**',
            '',
            '时间已经过半，还剩约 ' + hours + '。',
            '',
            '打开 App 处理。',
          ].join('\n'),
        );
        await svc.markReminded(task.id, alsoMark);
      }
      if (due.length) console.log('[scheduler] sent', due.length, 'reminder(s)');
    } catch (e) {
      console.error('[scheduler] remind failed', e);
    }
  };
  void remindTick();
  const remindTimer = setInterval(remindTick, 5 * 60_000);
  remindTimer.unref();
  server.listen(PORT, () => {
    console.log('[love-stars] listening on http://127.0.0.1:' + PORT + ' (PostgreSQL)');
    console.log('[love-stars] websocket on ws://127.0.0.1:' + PORT + '/ws?token=<accessToken>');
  });
}).catch((e) => {
  console.error('bootstrap failed:', e);
  process.exit(1);
});
