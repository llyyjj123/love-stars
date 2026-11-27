import 'package:dio/dio.dart';
import '../../data/models/models.dart';
import '../storage/token_store.dart';

/// 统一 API 客户端
///
/// 契约（文档 v1.2 §7.4）：
///   1. 客户端不计算余额，只渲染服务端返回值
///   2. 收到 WS 事件只做「失效 + 重取」
///   3. 发布任务前必须提示「将立即扣除 N 星」
///   4. 兑换前必须提示「星星不返还」
class ApiException implements Exception {
  final String code;
  final String message;
  final int? statusCode;
  ApiException(this.code, this.message, [this.statusCode]);

  @override
  String toString() => '$code: $message';
}

class ApiClient {
  final Dio _dio;
  final TokenStore _tokenStore;
  final void Function()? onUnauthorized;

  ApiClient({required String baseUrl, required TokenStore tokenStore, this.onUnauthorized})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 20),
          contentType: 'application/json',
        )),
        _tokenStore = tokenStore {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _tokenStore.read();
        if (token != null) {
          options.headers['authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (e, handler) {
        if (e.response?.statusCode == 401) {
          _tokenStore.clear();
          onUnauthorized?.call();
        }
        handler.next(e);
      },
    ));
  }

  /// 统一解包 { ok, data } / { ok:false, error:{code,message} }
  Future<T> _unwrap<T>(Future<Response> Function() call) async {
    try {
      final res = await call();
      final body = res.data;
      if (body is Map && body['ok'] == true) {
        return body['data'] as T;
      }
      final err = body is Map ? body['error'] : null;
      throw ApiException(
        err?['code']?.toString() ?? 'UNKNOWN',
        err?['message']?.toString() ?? 'unknown error',
        res.statusCode,
      );
    } on DioException catch (e) {
      final data = e.response?.data;
      final err = data is Map ? data['error'] : null;
      throw ApiException(
        err?['code']?.toString() ?? 'NETWORK_ERROR',
        err?['message']?.toString() ?? e.message ?? 'network error',
        e.response?.statusCode,
      );
    }
  }

  // ---------- 认证 ----------
  Future<Map<String, dynamic>> login(String username, String password) =>
      _unwrap(() => _dio.post('/auth/login', data: {'username': username, 'password': password}));

  Future<Map<String, dynamic>> me() => _unwrap(() => _dio.get('/me'));

  // ---------- 钱包 ----------
  Future<Wallet> wallet() async => Wallet.fromJson(await _unwrap(() => _dio.get('/wallet')));
  Future<Map<String, dynamic>> wallets() => _unwrap(() => _dio.get('/wallets'));
  Future<Map<String, dynamic>> ledger({String? cursor, int limit = 30}) => _unwrap(
    () => _dio.get('/ledger', queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor}),
  );

  // ---------- 签到 ----------
  Future<Map<String, dynamic>> checkIn() => _unwrap(() => _dio.post('/checkin'));
  Future<Map<String, dynamic>> checkInState() => _unwrap(() => _dio.get('/checkin/state'));

  // ---------- 任务 ----------
  Future<Task?> systemTask() async {
    final j = await _unwrap<dynamic>(() => _dio.get('/tasks/system'));
    return j == null ? null : Task.fromJson(j as Map<String, dynamic>);
  }
  /// 抽一条预览：不写库，用户确认后才加入
  Future<Task?> drawSystemTask({List<String> exclude = const []}) async {
    final j = await _unwrap<dynamic>(() => _dio.post('/tasks/draw', data: {'exclude': exclude}));
    return j == null ? null : Task.fromJson(j as Map<String, dynamic>);
  }

  /// 把预览的任务加入「我在做」
  Future<Task> joinSystemTask(String taskId) async {
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post('/tasks/$taskId/join'));
    return Task.fromJson(j);
  }
  Future<List<Task>> tasks({String scope = 'all'}) async {
    final list = await _unwrap<List<dynamic>>(() => _dio.get('/tasks', queryParameters: {'scope': scope}));
    return list.map((e) => Task.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Task> publishTask({required String title, required int reward, int? timeLimitHours}) async {
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post(
          '/tasks',
          data: {
            'title': title,
            'reward': reward,
            if (timeLimitHours != null) 'timeLimitHours': timeLimitHours,
          },
          options: Options(headers: {'idempotency-key': _newKey()}),
        ));
    return Task.fromJson(j);
  }

  Future<Task> taskAction(String taskId, String action, {String? photoUrl, String? note}) async {
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post(
          '/tasks/$taskId/$action',
          data: {
            if (photoUrl != null) 'photoUrl': photoUrl,
            if (note != null && note.isNotEmpty) 'note': note,
          },
        ));
    return Task.fromJson(j);
  }

  /// 单条任务详情（不依赖列表，修「任务不存在」）
  Future<Task?> taskById(String taskId) async {
    try {
      final j = await _unwrap<Map<String, dynamic>>(() => _dio.get('/tasks/$taskId'));
      return Task.fromJson(j);
    } catch (_) {
      return null;
    }
  }

  Future<List<Task>> pendingConfirm() async {
    final list = await _unwrap<List<dynamic>>(() => _dio.get('/tasks/pending-confirm'));
    return list.map((e) => Task.fromJson(e as Map<String, dynamic>)).toList();
  }

  // ---------- 物品 ----------
  Future<List<Item>> items() async {
    final list = await _unwrap<List<dynamic>>(() => _dio.get('/items'));
    return list.map((e) => Item.fromJson(e as Map<String, dynamic>)).toList();
  }

  // ---------- 兑换 ----------
  Future<Redemption> redeem({
    required String itemId,
    required int quantity,
    String? note,
  }) async {
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post(
          '/redemptions',
          data: {'itemId': itemId, 'quantity': quantity, if (note != null) 'note': note},
          options: Options(headers: {'idempotency-key': _newKey()}),
        ));
    return Redemption.fromJson(j);
  }

  Future<List<Redemption>> redemptions({String scope = 'mine'}) async {
    final list = await _unwrap<List<dynamic>>(
      () => _dio.get('/redemptions', queryParameters: {'scope': scope}),
    );
    return list.map((e) => Redemption.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Redemption> fulfill({
    required String redemptionId,
    required String photoUrl,
    String? note,
  }) async {
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post(
          '/redemptions/$redemptionId/fulfill',
          data: {'photoUrl': photoUrl, if (note != null) 'note': note},
        ));
    return Redemption.fromJson(j);
  }

  Future<Map<String, dynamic>> nudge(String redemptionId) =>
      _unwrap(() => _dio.post('/redemptions/$redemptionId/nudge'));

  // ---------- 媒体 ----------
  Future<String> uploadPhoto(String filePath) async {
    final form = FormData.fromMap({
      'photo': await MultipartFile.fromFile(filePath, filename: 'photo.jpg'),
    });
    final j = await _unwrap<Map<String, dynamic>>(() => _dio.post('/media', data: form));
    return j['url'] as String;
  }

  String _newKey() =>
      '${DateTime.now().microsecondsSinceEpoch}-${identityHashCode(this) % 10000}';
}
