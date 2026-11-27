import { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { TokenService } from './auth';

/**
 * 极简 WebSocket 服务（RFC 6455 子集）
 *
 * 不引第三方库，只实现本项目需要的：
 *   - 握手（Sec-WebSocket-Accept）
 *   - 文本帧收发
 *   - ping/pong
 *   - 关闭帧
 *
 * 协议选择理由：文档 v1.0 里 P-10 写「ws / Socket.IO 二选一」。
 * Socket.IO 会多一层协议封装，而本项目只有两台设备、事件量极小，
 * 原生 ws 足够，且 Flutter 端用 web_socket_channel 直连即可。
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface Client {
  id: string;
  userId: string;
  socket: any;
  alive: boolean;
}

function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** 编码一个文本帧（服务端 → 客户端不掩码） */
export function encodeFrame(payload: string, opcode = 0x1): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;   // FIN + opcode
  return Buffer.concat([header, data]);
}

/** 解析客户端帧（客户端 → 服务端是掩码的） */
export function decodeFrame(buf: Buffer): { opcode: number; payload: string; consumed: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;

  let payload: Buffer;
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      payload[i] = buf[offset + 4 + i] ^ mask[i % 4];
    }
  } else {
    payload = buf.subarray(offset, offset + len);
  }

  return { opcode, payload: payload.toString('utf8'), consumed: offset + maskLen + len };
}

export class RealtimeHub {
  private clients = new Map<string, Client>();
  private seq = 0;

  constructor(private tokens: TokenService) {}

  /** 处理 HTTP upgrade，完成握手 */
  handleUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const v = this.tokens.verify(token);
    if (!v) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n',
    );

    this.seq += 1;
    const client: Client = { id: 'c' + this.seq, userId: v.userId, socket, alive: true };
    this.clients.set(client.id, client);

    // 欢迎帧
    socket.write(encodeFrame(JSON.stringify({ type: 'hello', userId: v.userId })));

    let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.consumed);

        if (frame.opcode === 0x8) {   // close
          this.remove(client.id);
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {   // ping
          socket.write(encodeFrame(frame.payload, 0xA));
          continue;
        }
        if (frame.opcode === 0x1) {   // text
          try {
            const msg = JSON.parse(frame.payload);
            if (msg.type === 'ping') {
              socket.write(encodeFrame(JSON.stringify({ type: 'pong', t: msg.t })));
            }
          } catch { /* 忽略非法 JSON */ }
        }
      }
    });

    socket.on('close', () => this.remove(client.id));
    socket.on('error', () => this.remove(client.id));
  }

  private remove(id: string) {
    const c = this.clients.get(id);
    if (!c) return;
    c.alive = false;
    this.clients.delete(id);
  }

  /** 推给某个用户的所有连接 */
  emitToUser(userId: string, event: string, payload: unknown): number {
    const frame = encodeFrame(JSON.stringify({ type: 'event', event, payload, at: new Date().toISOString() }));
    let sent = 0;
    for (const c of this.clients.values()) {
      if (c.userId === userId && c.alive) {
        try { c.socket.write(frame); sent += 1; } catch { this.remove(c.id); }
      }
    }
    return sent;
  }

  /** 推给所有人（两台设备） */
  broadcast(event: string, payload: unknown): number {
    const frame = encodeFrame(JSON.stringify({ type: 'event', event, payload, at: new Date().toISOString() }));
    let sent = 0;
    for (const c of this.clients.values()) {
      if (!c.alive) continue;
      try { c.socket.write(frame); sent += 1; } catch { this.remove(c.id); }
    }
    return sent;
  }

  stats() {
    return { clients: this.clients.size, users: [...new Set([...this.clients.values()].map((c) => c.userId))] };
  }

  closeAll() {
    for (const c of this.clients.values()) {
      try { c.socket.write(encodeFrame('', 0x8)); c.socket.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

/**
 * Outbox 消费者
 *
 * 业务事务里只写 Outbox 表，这里异步取出并推送。
 * 为什么不在事务里推：事务可能回滚，推送已发出就会造成「收到了但没发生」。
 */
export class OutboxConsumer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private prisma: PrismaClient,
    private hub: RealtimeHub,
    private intervalMs = 500,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 处理一批，返回处理条数（测试里可以直接调） */
  async tick(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.prisma.outbox.findMany({
        where: { sentAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      let sent = 0;
      for (const row of rows) {
        try {
          this.hub.emitToUser(row.toUserId, row.event, row.payload);
          await this.prisma.outbox.update({
            where: { id: row.id },
            data: { sentAt: new Date() },
          });
          sent += 1;
        } catch (e: any) {
          await this.prisma.outbox.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, lastError: String(e?.message ?? e).slice(0, 500) },
          });
        }
      }
      return sent;
    } finally {
      this.running = false;
    }
  }
}
