import { createServer } from 'node:http';
import { prisma } from './prisma';
import { PrismaService } from './prisma-service';
import { TokenService } from './auth';
import { MediaStore, MEDIA } from './media';

const tokens = new TokenService('v', 3600_000);
const svc = new PrismaService(prisma);
const store = new MediaStore('./data/media', 'http://127.0.0.1:PORT/media');

function readRaw(req: any, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) return reject(new Error('too large')); chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function readJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function tinyPng(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
}

async function main() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const json = (code: number, body: any) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

    if (path === '/media' && req.method === 'POST') {
      const ct = String(req.headers['content-type'] ?? '');
      const boundary = MediaStore.boundaryOf(ct);
      if (!boundary) return json(400, { ok: false, error: { code: 'UPLOAD_BAD_REQUEST' } });
      const raw = await readRaw(req, MEDIA.maxBytes + 1024 * 1024);
      const parts = MediaStore.parseMultipart(raw, boundary);
      const filePart = parts.find((p) => p.filename && p.data.length > 0);
      if (!filePart) return json(400, { ok: false, error: { code: 'UPLOAD_EMPTY' } });
      try {
        const saved = await store.save(filePart.data);
        return json(200, { ok: true, data: saved });
      } catch (e: any) {
        return json(e.code === 'UPLOAD_TOO_LARGE' ? 413 : 415, { ok: false, error: { code: e.code } });
      }
    }

    const mg = /^\/media\/([^/]+)$/.exec(path);
    if (mg && req.method === 'GET') {
      const f = await store.read(mg[1]);
      if (!f) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'content-type': f.mime });
      return res.end(f.buf);
    }

    if (path === '/fulfill' && req.method === 'POST') {
      const b = await readJson(req);
      try {
        const r = await svc.fulfill(b.redemptionId, 'user-b', b.photoUrl, b.note);
        return json(200, { ok: true, data: r });
      } catch (e: any) {
        return json(400, { ok: false, error: { code: e.code, message: e.message } });
      }
    }

    json(404, { ok: false });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const base = 'http://127.0.0.1:' + port;
  console.log('server on', port);

  // 1) 上传照片
  const boundary = '----v' + Date.now();
  const png = tinyPng();
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Disposition: form-data; name="photo"; filename="p.png"\r\n'),
    Buffer.from('Content-Type: image/png\r\n\r\n'),
    png,
    Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);
  const up = await fetch(base + '/media', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=' + boundary }, body });
  const upJson: any = await up.json();
  console.log('1. 上传:', up.status, JSON.stringify(upJson.data));

  const filename = upJson.data.filename;
  const url = base + '/media/' + filename;

  // 2) 读回图片
  const got = await fetch(url);
  const gotBuf = Buffer.from(await got.arrayBuffer());
  console.log('2. 读回:', got.status, got.headers.get('content-type'), gotBuf.length, 'bytes, 内容一致:', gotBuf.equals(png));

  // 3) 用这个 URL 兑现
  const pending = await prisma.redemption.findFirst({ where: { status: 'pending' } });
  if (!pending) {
    console.log('3. 没有待兑现的单，跳过');
  } else {
    const ff = await fetch(base + '/fulfill', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redemptionId: pending.id, photoUrl: url, note: '买好啦' }),
    });
    const ffJson: any = await ff.json();
    console.log('3. 兑现:', ff.status, ffJson.data?.status, '照片:', ffJson.data?.photoUrl);
  }

  // 4) 安全测试
  const evil = await fetch(base + '/media/..%2F..%2Fetc%2Fpasswd');
  console.log('4. 路径穿越:', evil.status, '(应为 404)');

  const bad = await fetch(base + '/media', {
    method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
    body: Buffer.concat([
      Buffer.from('--' + boundary + '\r\n'),
      Buffer.from('Content-Disposition: form-data; name="photo"; filename="x.txt"\r\n\r\n'),
      Buffer.from('this is plain text, not an image'),
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]),
  });
  const badJson: any = await bad.json();
  console.log('5. 非图片:', bad.status, badJson.error?.code, '(应为 415)');

  server.close();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
