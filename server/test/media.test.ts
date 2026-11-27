import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaStore, sniffImageType, MEDIA } from '../src/media';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 构造最小合法 PNG（1x1 透明）
function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
}

function tinyJpeg(): Buffer {
  // 只有 magic number 的假 JPEG，够 sniffImageType 用
  const b = Buffer.alloc(16);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  return b;
}

function tinyGif(): Buffer {
  const b = Buffer.alloc(16);
  Buffer.from('GIF89a').copy(b, 0);
  return b;
}

function tinyWebp(): Buffer {
  const b = Buffer.alloc(20);
  Buffer.from('RIFF').copy(b, 0);
  Buffer.from('WEBP').copy(b, 8);
  return b;
}

// ---------- magic number 检测 ----------

test('识别 PNG', () => assert.equal(sniffImageType(tinyPng()), 'image/png'));
test('识别 JPEG', () => assert.equal(sniffImageType(tinyJpeg()), 'image/jpeg'));
test('识别 GIF', () => assert.equal(sniffImageType(tinyGif()), 'image/gif'));
test('识别 WebP', () => assert.equal(sniffImageType(tinyWebp()), 'image/webp'));

test('拒绝非图片（纯文本）', () => {
  assert.equal(sniffImageType(Buffer.from('hello world this is not an image')), null);
});

test('拒绝太短的 buffer', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null);
});

test('伪装成 png 的文本被拒绝', () => {
  const fake = Buffer.from('this is actually plain text but long enough');
  assert.equal(sniffImageType(fake), null);
});

// ---------- 存储 ----------

function withStore(fn: (store: MediaStore, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'media-test-'));
  const store = new MediaStore(dir, 'http://localhost:3000/media');
  return fn(store, dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('保存 PNG 返回哈希文件名和 URL', async () => {
  await withStore(async (store) => {
    const r = await store.save(tinyPng());
    assert.match(r.filename, /^[a-f0-9]{16}\.png$/);
    assert.equal(r.mime, 'image/png');
    assert.equal(r.url, 'http://localhost:3000/media/' + r.filename);
    assert.ok(r.bytes > 0);
  });
});

test('相同内容去重：两次保存得到同一文件名', async () => {
  await withStore(async (store) => {
    const a = await store.save(tinyPng());
    const b = await store.save(tinyPng());
    assert.equal(a.filename, b.filename);
  });
});

test('不同内容得到不同文件名', async () => {
  await withStore(async (store) => {
    const a = await store.save(tinyPng());
    const b = await store.save(tinyJpeg());
    assert.notEqual(a.filename, b.filename);
  });
});

test('拒绝超过 5MB 的文件', async () => {
  await withStore(async (store) => {
    const big = Buffer.alloc(MEDIA.maxBytes + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    await assert.rejects(
      () => store.save(big),
      (e: any) => e.code === 'UPLOAD_TOO_LARGE',
    );
  });
});

test('拒绝空文件', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      () => store.save(Buffer.alloc(0)),
      (e: any) => e.code === 'UPLOAD_EMPTY',
    );
  });
});

test('拒绝非图片内容', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      () => store.save(Buffer.from('not an image at all, just text')),
      (e: any) => e.code === 'UPLOAD_BAD_TYPE',
    );
  });
});

// ---------- 读取与安全 ----------

test('读取已保存的文件', async () => {
  await withStore(async (store) => {
    const saved = await store.save(tinyPng());
    const read = await store.read(saved.filename);
    assert.ok(read);
    assert.equal(read!.mime, 'image/png');
    assert.equal(read!.buf.length, saved.bytes);
  });
});

test('读取不存在的文件返回 null', async () => {
  await withStore(async (store) => {
    const r = await store.read('aaaaaaaaaaaaaaaa.png');
    assert.equal(r, null);
  });
});

test('路径穿越攻击被拒绝', async () => {
  await withStore(async (store) => {
    for (const evil of [
      '../etc/passwd',
      '..\\..\\windows\\system32\\config\\sam',
      '/etc/passwd',
      'a/../../b.png',
      'aaaaaaaaaaaaaaaa.png/../../../secret',
    ]) {
      const r = await store.read(evil);
      assert.equal(r, null, 'should reject: ' + evil);
    }
  });
});

test('非法文件名格式被拒绝', async () => {
  await withStore(async (store) => {
    assert.equal(await store.read('notahash.png'), null);
    assert.equal(await store.read('aaaaaaaaaaaaaaaa.exe'), null);
    assert.equal(await store.read('AAAAAAAAAAAAAAAA.PNG'), null);
  });
});

// ---------- multipart 解析 ----------

test('解析 multipart：单文件字段', () => {
  const boundary = '----test123';
  const png = tinyPng();
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Disposition: form-data; name="photo"; filename="a.png"\r\n'),
    Buffer.from('Content-Type: image/png\r\n\r\n'),
    png,
    Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);

  const parts = MediaStore.parseMultipart(body, boundary);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].field, 'photo');
  assert.equal(parts[0].filename, 'a.png');
  assert.equal(parts[0].mime, 'image/png');
  assert.equal(parts[0].data.length, png.length);
});

test('解析 multipart：文件 + 文本字段', () => {
  const boundary = '----mixed';
  const png = tinyPng();
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\n'),
    Buffer.from('Content-Disposition: form-data; name="photo"; filename="a.png"\r\n'),
    Buffer.from('Content-Type: image/png\r\n\r\n'),
    png,
    Buffer.from('\r\n--' + boundary + '\r\n'),
    Buffer.from('Content-Disposition: form-data; name="note"\r\n\r\n'),
    Buffer.from('买好啦'),
    Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);

  const parts = MediaStore.parseMultipart(body, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].field, 'photo');
  assert.equal(parts[1].field, 'note');
  assert.equal(parts[1].data.toString('utf8'), '买好啦');
});

test('从 Content-Type 提取 boundary', () => {
  assert.equal(MediaStore.boundaryOf('multipart/form-data; boundary=abc'), 'abc');
  assert.equal(MediaStore.boundaryOf('multipart/form-data; boundary="abc def"'), 'abc def');
  assert.equal(MediaStore.boundaryOf('application/json'), null);
});

test('无 boundary 时解析返回空', () => {
  assert.deepEqual(MediaStore.parseMultipart(Buffer.from('garbage'), 'nonexistent'), []);
});
