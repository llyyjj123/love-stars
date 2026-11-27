import https from 'node:https';

/**
 * Server酱微信推送
 *
 * 两个 key 分属两个微信号，额度独立（各 5 条/天），合计 10 条。
 * 哪个用户的事件就发给哪个 key，天然分流，也避免了互相看到对方的通知。
 *
 * 设计原则：
 *   1. 推送失败**绝不阻塞业务**（任务照常创建，只是没通知）
 *   2. 不记录 SendKey 到日志
 *   3. 每条消息控制在 title 32 字以内（Server酱限制）
 */

export interface NotifyResult {
  ok: boolean;
  error?: string;
}

/** 标题最长 32 字符，超出截断 */
function clampTitle(s: string): string {
  const t = s.replace(/[\r\n]/g, ' ').trim();
  return t.length <= 32 ? t : t.slice(0, 31) + '…';
}

export class WeChatNotifier {
  private keys: Record<string, string>;
  private enabled: boolean;

  constructor(keys: Record<string, string>) {
    this.keys = keys;
    this.enabled = Object.values(keys).some((k) => k && k.startsWith('SCT'));
    if (!this.enabled) {
      console.log('[notify] no ServerChan key configured, WeChat push disabled');
    }
  }

  /** 给某个用户发微信通知。userId 对应 .env 里的 SERVERCHAN_KEY_A / _B */
  async send(userId: string, title: string, desp: string): Promise<NotifyResult> {
    if (!this.enabled) return { ok: false, error: 'disabled' };
    const key = this.keys[userId];
    if (!key) return { ok: false, error: 'no key for ' + userId };

    const body = new URLSearchParams({ title: clampTitle(title), desp }).toString();
    return new Promise((resolve) => {
      const req = https.request(
        {
          host: 'sctapi.ftqq.com',
          path: '/' + key + '.send',
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(body),
          },
          timeout: 10_000,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const j = JSON.parse(raw);
              if (j.code === 0) return resolve({ ok: true });
              // 常见错误：额度用完（code 40001）、频率超限
              console.warn('[notify] serverchan rejected:', j.code, j.message);
              resolve({ ok: false, error: String(j.message || j.code) });
            } catch {
              resolve({ ok: false, error: 'bad response' });
            }
          });
        },
      );
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'timeout' });
      });
      req.write(body);
      req.end();
    });
  }

  /** 不等待结果，业务代码直接调这个 */
  fire(userId: string, title: string, desp: string): void {
    this.send(userId, title, desp).catch((e) => console.warn('[notify] failed:', e?.message));
  }
}
