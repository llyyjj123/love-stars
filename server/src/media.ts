import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fsp } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

/**
 * 媒体上传（兑现照片）
 *
 * 设计要点：
 *   1. 不引第三方依赖，用 Node 内置 fs + crypto
 *   2. 文件名用内容哈希（sha256 前 16 位），天然去重
 *   3. 只允许图片类型，白名单校验 magic number，不信任 Content-Type
 *   4. 路径必须落在 MEDIA_ROOT 内，防目录穿越
 *   5. 大小上限 5 MB（与 .env.example 的 MEDIA_MAX_MB 一致）
 */

export const MEDIA = {
  maxBytes: 5 * 1024 * 1024,
  allowed: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  } as Record<string, string>,
};

/** 通过 magic number 判断真实类型，不信任客户端声明的 Content-Type */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';

  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';

  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';

  return null;
}

export interface SavedMedia {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string;
}

export class MediaStore {
  private root: string;
  private publicBase: string;

  constructor(rootDir: string, publicBase: string) {
    this.root = resolve(rootDir);
    this.publicBase = publicBase.replace(/\/$/, '');
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
  }

  /** 保存一个 buffer，返回可访问 URL */
  async save(buf: Buffer): Promise<SavedMedia> {
    if (buf.length === 0) {
      throw Object.assign(new Error('empty file'), { code: 'UPLOAD_EMPTY' });
    }
    if (buf.length > MEDIA.maxBytes) {
      throw Object.assign(new Error('file too large'), { code: 'UPLOAD_TOO_LARGE' });
    }

    const mime = sniffImageType(buf);
    if (!mime) {
      throw Object.assign(new Error('unsupported image type'), { code: 'UPLOAD_BAD_TYPE' });
    }

    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const ext = MEDIA.allowed[mime];
    const filename = hash + '.' + ext;
    const target = join(this.root, filename);

    // 去重：同内容已存在直接返回
    if (!existsSync(target)) {
      await fsp.writeFile(target, buf);
    }

    return {
      id: hash,
      filename,
      mime,
      bytes: buf.length,
      url: this.publicBase + '/' + filename,
    };
  }

  /** 读取（用于静态文件服务），做路径穿越校验 */
  async read(filename: string): Promise<{ buf: Buffer; mime: string } | null> {
    // 只允许「哈希.扩展名」格式，拒绝任何路径分隔符
    if (!/^[a-f0-9]{16}\.(jpg|png|webp|gif)$/.test(filename)) return null;

    const target = join(this.root, filename);
    // 二次确认：解析后的路径必须仍在 root 下
    const resolved = resolve(target);
    if (!resolved.startsWith(this.root + sep)) return null;

    try {
      const buf = await fsp.readFile(resolved);
      const mime = sniffImageType(buf);
      if (!mime) return null;
      return { buf, mime };
    } catch {
      return null;
    }
  }

  /** 解析 multipart/form-data，提取第一个文件字段 */
  static parseMultipart(body: Buffer, boundary: string): { field: string; filename: string; mime: string; data: Buffer }[] {
    const parts: { field: string; filename: string; mime: string; data: Buffer }[] = [];
    const delimiter = Buffer.from('--' + boundary);
    const endDelimiter = Buffer.from('--' + boundary + '--');

    let pos = body.indexOf(delimiter);
    if (pos < 0) return parts;

    while (pos >= 0) {
      // 结束标记
      if (body.subarray(pos, pos + endDelimiter.length).equals(endDelimiter)) break;

      const headerStart = pos + delimiter.length + 2;   // 跳过 \r\n
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
      if (headerEnd < 0) break;

      const headerText = body.subarray(headerStart, headerEnd).toString('utf8');
      const dataStart = headerEnd + 4;
      const nextDelimiter = body.indexOf(delimiter, dataStart);
      if (nextDelimiter < 0) break;

      // 去掉尾部 \r\n
      const dataEnd = nextDelimiter - 2;
      const data = body.subarray(dataStart, Math.max(dataStart, dataEnd));

      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const fileMatch = /filename="([^"]*)"/.exec(headerText);
      const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);

      if (nameMatch) {
        parts.push({
          field: nameMatch[1],
          filename: fileMatch ? fileMatch[1] : '',
          mime: mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream',
          data: Buffer.from(data),
        });
      }

      pos = nextDelimiter;
    }

    return parts;
  }

  static boundaryOf(contentType: string): string | null {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!m) return null;
    return (m[1] ?? m[2]).trim();
  }
}
