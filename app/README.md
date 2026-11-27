# love_stars — Flutter 客户端

「星星」情侣 App 的 Flutter 客户端，支持 Android / iOS / Web。

## 快速开始

```bash
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1
```

不带 `--dart-define` 时默认连生产服务器，见 `lib/data/providers/providers.dart`。

## 目录

```text
lib/
├── core/       网络、路由、主题、存储
├── data/       模型与 Riverpod provider
├── features/   登录 / 首页 / 任务 / 物品 / 我的
└── widgets/    通用组件
```

## 打包

```bash
flutter build apk --release     # Android
flutter build ios --no-codesign # iOS（需 macOS，CI 已配置）
```

## 约定

- `ref.listen` 只能在 `build` 里调用，写进 `initState` 会崩
- 客户端不计算余额，只渲染服务端返回值
- 物品插画打包进 `assets/items/`，不走网络
