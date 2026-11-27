import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/network/realtime_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'data/providers/providers.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: LoveStarsApp()));
}

/// 全局 ScaffoldMessenger key
///
/// 用途：让非 widget 层（如 WebSocket 回调）也能弹 SnackBar。
/// 注意 MaterialApp.router 没有 navigatorKey 参数，但支持 scaffoldMessengerKey。
final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

class LoveStarsApp extends ConsumerStatefulWidget {
  const LoveStarsApp({super.key});

  @override
  ConsumerState<LoveStarsApp> createState() => _LoveStarsAppState();
}

class _LoveStarsAppState extends ConsumerState<LoveStarsApp> with WidgetsBindingObserver {
  StreamSubscription<String>? _nudgeSub;

  @override
  void initState() {
    super.initState();
    // iOS 切后台后 WebSocket 会被系统断掉，回前台必须重连并全量刷新，
    // 否则界面会停在切走那一刻的旧状态（看不到对方提交、没有确认按钮）。
    WidgetsBinding.instance.addObserver(this);

    // 启动时尝试恢复会话，成功后连 WebSocket
    Future.microtask(() async {
      if (!mounted) return;
      await ref.read(sessionProvider.notifier).bootstrap();
      if (!mounted) return;
      if (ref.read(sessionProvider).value?.isLoggedIn == true) {
        await ref.read(realtimeProvider).connect();
      }
    });

    // 收到「催一催」弹提示
    _nudgeSub = ref.read(realtimeProvider).nudges.listen((itemName) {
      scaffoldMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text('TA 在催你兑现「$itemName」')),
      );
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    if (ref.read(sessionProvider).value?.isLoggedIn != true) return;
    // 重连 WS（断线重连定时器可能还没到），再全量失效，让每个页面自己重取。
    ref.read(realtimeProvider).connect();
    ref.invalidate(walletProvider);
    ref.invalidate(bothWalletsProvider);
    ref.invalidate(tasksProvider);
    ref.invalidate(pendingConfirmProvider);
    ref.invalidate(systemTaskProvider);
    ref.invalidate(taskByIdProvider);
    ref.invalidate(checkInStateProvider);
    ref.invalidate(myRedemptionsProvider);
    ref.invalidate(inboxRedemptionsProvider);
    ref.invalidate(giftsSentProvider);
    ref.invalidate(giftsReceivedProvider);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _nudgeSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // ★ ref.listen 必须在 build 里调用。
    //   Riverpod 2.6 起在 initState 里调用会直接抛
    //   "ref.listen can only be used within the build method of a ConsumerWidget"。
    ref.listen<AsyncValue<Session>>(sessionProvider, (prev, next) {
      final logged = next.hasValue && next.value!.isLoggedIn;
      final wasLogged = prev?.hasValue == true && prev!.value!.isLoggedIn;
      if (logged && !wasLogged) {
        ref.read(realtimeProvider).connect();
      } else if (!logged && wasLogged) {
        ref.read(realtimeProvider).disconnect();
      }
    });

    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      scaffoldMessengerKey: scaffoldMessengerKey,
      title: '我们的小家',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: router,
    );
  }
}
