import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/token_store.dart';
import '../models/models.dart';

/// 后端地址
///
/// 默认指向云服务器 —— 这样 `flutter build apk` 不带参数也能直接装机使用，
/// 不依赖电脑开机、不要求手机和电脑同 WiFi。
///
/// 需要指向别处时用 --dart-define 覆盖：
///   flutter run --dart-define=API_BASE_URL=http://127.0.0.1:3000/api/v1   （本地后端）
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.100:3000/api/v1 （局域网真机）
const kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://47.116.23.114/api/v1',
);

final tokenStoreProvider = Provider((ref) => TokenStore());

/// 401 回调：不能在 apiClientProvider 内部直接 watch/read sessionProvider，
/// 那会形成 apiClientProvider ↔ sessionProvider 的循环引用。
/// 用一个可变的回调登记处，由 sessionProvider 在创建时填入。
final _onUnauthorized = ValueNotifier<void Function()?>(null);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: kApiBaseUrl,
    tokenStore: ref.watch(tokenStoreProvider),
    onUnauthorized: () => _onUnauthorized.value?.call(),
  );
});

// ---------- 会话 ----------
class Session {
  final User? user;
  final User? partner;
  const Session({this.user, this.partner});
  bool get isLoggedIn => user != null;
}

class SessionNotifier extends StateNotifier<AsyncValue<Session>> {
  final ApiClient api;
  final TokenStore tokens;
  final Ref ref;
  SessionNotifier(this.api, this.tokens, this.ref) : super(const AsyncValue.data(Session()));

  /// 登录态变化时，把所有跟账号相关的缓存全部作废
  ///
  /// 这是切换账号能生效的关键：如果不 invalidate，
  /// wallet / tasks / items / redemptions 会一直返回上一个账号的缓存。
  void _invalidateAll() {
    ref.invalidate(walletProvider);
    ref.invalidate(bothWalletsProvider);
    ref.invalidate(checkInStateProvider);
    ref.invalidate(tasksProvider);
    ref.invalidate(pendingConfirmProvider);
    ref.invalidate(itemsProvider);
    ref.invalidate(myRedemptionsProvider);
    ref.invalidate(inboxRedemptionsProvider);
    ref.invalidate(ledgerPageProvider);
    ref.invalidate(systemTaskProvider);
  }

  void expireSession() {
    if (state.value?.isLoggedIn != true) return;
    _invalidateAll();
    state = const AsyncValue.data(Session());
  }

  Future<void> bootstrap() async {
    final token = await tokens.read();
    if (token == null) return;
    try {
      final j = await api.me();
      state = AsyncValue.data(Session(
        user: User.fromJson(j['user'] as Map<String, dynamic>),
        partner: User.fromJson(j['partner'] as Map<String, dynamic>),
      ));
    } catch (_) {
      await tokens.clear();
      state = const AsyncValue.data(Session());
    }
  }

  Future<void> login(String username, String password) async {
    state = const AsyncValue.loading();
    try {
      final j = await api.login(username, password);
      await tokens.write(j['accessToken'] as String);

      // 先清缓存，再写新会话 —— 顺序很重要，
      // 否则新 session 会让 provider 用旧 token 重新请求一次
      _invalidateAll();

      state = AsyncValue.data(Session(
        user: User.fromJson(j['user'] as Map<String, dynamic>),
        partner: User.fromJson(j['partner'] as Map<String, dynamic>),
      ));

      // session 落定后再失效一次，确保新 token 生效
      _invalidateAll();
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> logout() async {
    await tokens.clear();
    _invalidateAll();
    state = const AsyncValue.data(Session());
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, AsyncValue<Session>>((ref) {
  final notifier = SessionNotifier(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider), ref);
  _onUnauthorized.value = notifier.expireSession;
  ref.onDispose(() {
    if (_onUnauthorized.value == notifier.expireSession) _onUnauthorized.value = null;
  });
  return notifier;
});

// ---------- 钱包 ----------
final walletProvider = FutureProvider<Wallet>((ref) async {
  return ref.watch(apiClientProvider).wallet();
});

/// 双方余额（首页对比用）
final bothWalletsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiClientProvider).wallets();
});

// ---------- 签到 ----------
final checkInStateProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.watch(apiClientProvider).checkInState();
});

// ---------- 任务 ----------
final tasksProvider = FutureProvider.family<List<Task>, String>((ref, scope) async {
  return ref.watch(apiClientProvider).tasks(scope: scope);
});

final taskByIdProvider = FutureProvider.family<Task?, String>((ref, id) async {
  return ref.watch(apiClientProvider).taskById(id);
});

final systemTaskProvider = FutureProvider<Task?>((ref) async {
  return ref.watch(apiClientProvider).systemTask();
});

class LedgerPageData {
  final List<Map<String, dynamic>> items;
  final String? nextCursor;
  const LedgerPageData(this.items, this.nextCursor);
}

final ledgerPageProvider = FutureProvider.family<LedgerPageData, String?>((ref, cursor) async {
  final j = await ref.watch(apiClientProvider).ledger(cursor: cursor);
  return LedgerPageData(
    (j['items'] as List<dynamic>).map((e) => e as Map<String, dynamic>).toList(),
    j['nextCursor'] as String?,
  );
});

final pendingConfirmProvider = FutureProvider<List<Task>>((ref) async {
  return ref.watch(apiClientProvider).pendingConfirm();
});

// ---------- 物品 ----------
final itemsProvider = FutureProvider<List<Item>>((ref) async {
  return ref.watch(apiClientProvider).items();
});

// ---------- 兑换 ----------
final myRedemptionsProvider = FutureProvider<List<Redemption>>((ref) async {
  return ref.watch(apiClientProvider).redemptions(scope: 'mine');
});

final inboxRedemptionsProvider = FutureProvider<List<Redemption>>((ref) async {
  return ref.watch(apiClientProvider).redemptions(scope: 'inbox');
});
