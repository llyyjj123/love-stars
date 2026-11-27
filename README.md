# Love Stars · 星星

两个人之间的小应用：**签到赚星星 → 抽任务 → 用星星兑换小礼物 → 对方兑现**。

没有注册、没有社交、没有广告 —— 只为两个人做的私有小工具。

<p align="center">
  <img src="app/assets/items/hug.jpg" width="120" alt="一个拥抱">
  <img src="app/assets/items/tea.jpg" width="120" alt="奶茶">
  <img src="app/assets/items/movie.jpg" width="120" alt="陪我看指定电影">
</p>

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 签到 | 每天 1 ★；连续第 7 天当天 +5 ★（替代，不是叠加），周期循环 |
| 任务 | 36 条内置任务库，**先抽卡预览、确认后才加入**；也可自定义发布并设时限 |
| 托管 | 自定义任务发布时立即扣星进 escrow，拒绝则退款 |
| 超时 | 托管退还 + 执行人赔偿；系统任务回到池子 |
| 兑换 | 9 个预设物品；星星**直接销毁**（用户 → issue），不可逆 |
| 兑现 | 对方上传照片或文字确认，完成后发起方可确认 |
| 送星 | 账户间划转（不发行），可附 100 字小纸条，单日上限 50 星 |
| 小纸条 | 「我的 → 小纸条」收录所有送星留言，收到/送出分开看 |
| 账本 | 每笔星星流动都有借贷两条分录，全局 `SUM(balance) == 0` |
| 推送 | Server酱 → 微信，共 5 种：新任务 / 时间过半 / 对方提交 / 收到星星 / 待兑现 |

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 客户端 | Flutter 3.50 · Riverpod · go_router · Dio · WebSocket |
| 服务端 | Node.js · TypeScript · Prisma 7 · PostgreSQL |
| 部署 | systemd + PostgreSQL（单机） |

---

## 仓库结构

```text
love/
├── app/                  Flutter 客户端（Android / iOS / Web）
│   ├── lib/              core / data / features / widgets
│   ├── ios/              Xcode 工程
│   ├── android/          Gradle 工程
│   └── assets/items/     9 张物品插画（打包进 App，不走网络）
├── server/               Node.js + TypeScript + Prisma
│   ├── src/              账本内核、服务、HTTP、WebSocket
│   ├── prisma/           schema 与迁移
│   └── test/             单元测试 + 数据库集成测试
├── scripts/              冒烟测试 / WebSocket 验证 / 推送脚本
└── .github/workflows/    iOS 未签名 IPA · Android 未签名 APK
```

---

## 核心约束（改代码前必读）

1. **星星只能通过 `transfer()` 变动**，直接改余额会破坏对账
2. 全局不变式 `SUM(accounts.balance) == 0`，每笔操作一借一贷
3. 涉及星星的写操作与状态变更**必须在同一事务内**
4. 客户端不计算余额，只渲染服务端返回值
5. 自定义任务**发布时即扣星进托管**，不是确认时才扣
6. **兑换即销毁**（用户 → issue），因此 `-issue.balance` 是**净发行量**
7. **兑换不可逆**：没有取消、退款或超时
8. **送星不是发星**：走 `transfer()` 账户间划转，不碰 issue 账户，`SUM(balance)` 仍为 0
9. `ref.listen` **只能在 `build` 里调用**，写进 `initState` 会崩（有测试守着）
10. **对方提交后发布方不能取消**：服务端 409 `TASK_ALREADY_SUBMITTED`，否则等于白拿对方劳动

---

## 本地运行

### 1. 服务端

```bash
cd server
npm install
cp .env.example .env      # 填 DATABASE_URL / JWT_SECRET / 两个账号
npx tsc -p tsconfig.json
node dist/src/main.js     # 默认 http://127.0.0.1:3000
```

首次还需建库并灌数据：

```bash
npx prisma migrate deploy
node dist/src/seed.js
```

### 2. 客户端

```bash
cd app
flutter pub get
flutter run -d chrome \
  --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

不带 `--dart-define` 时默认连生产服务器（见 `app/lib/data/providers/providers.dart`）。

---

## 测试

```bash
# 服务端
cd server && npx tsc -p tsconfig.json
npm test                  # 单元测试
ALLOW_DB_TEST_RESET=1 npm run test:db    # 数据库测试（会清库！）

# 客户端
cd app && flutter test    # Widget 测试

# 端到端
node scripts/smoke.js     # 40 项 API 冒烟（需先启动服务端）
node scripts/e2e-full.js  # 72 项全功能验收，跑完自动还原 20/20
node scripts/verify-ws.js # WebSocket 全链路
```

> `smoke.js` 与 `verify-ws.js` 从 `server/.env` 读测试账号，源码里不含任何密码。

---

## 打包

### iOS（Windows 上无法编译，走 CI）

1. 推送后到 **Actions → iOS 未签名 IPA → Run workflow**
2. 约 10–15 分钟，下载 artifact `ios-unsigned-ipa`
3. 用爱思助手签名：**Bundle ID 必须固定 `com.love.loveStars`**
4. 覆盖安装，不要卸载（卸载会清沙盒缓存）
5. 免费证书 **7 天有效**，到期重签

### Android

```bash
cd app
flutter build apk --release
```

CI 产出的是**未签名** APK，仓库不接触任何证书。

---

## 关于这个仓库

- 仓库**不含**任何证书、keystore、`.env`、账号密码或部署文档
- 服务端的账号密码从 `server/.env` 读取（本地维护，`git` 忽略）
- 这是为一对情侣做的私有工具，不建议直接用于多租户场景
