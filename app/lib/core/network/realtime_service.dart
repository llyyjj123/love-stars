import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../data/providers/providers.dart';

/// WebSocket 实时服务
///
/// 契约（文档 v1.2 §7.4 第 2 条）：
///   收到事件只做「失效 + 重取」，不直接拿事件内容当数据。
///   因为事件可能乱序或丢失，直接按事件更新会得到错误状态。
class RealtimeService {
  final Ref _ref;
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _heartbeat;
  Timer? _reconnect;
  String? _token;
  bool _disposed = false;

  /// 连接状态：给 UI 显示「离线」提示用
  bool connected = false;

  /// 收到 nudged 事件时通知 UI 弹提示
  final _nudgeController = StreamController<String>.broadcast();
  Stream<String> get nudges => _nudgeController.stream;

  RealtimeService(this._ref);

  /// 后端 WS 地址：把 http(s) 换成 ws(s)
  String _wsUrl(String token) {
    final base = kApiBaseUrl;
    final ws = base.replaceFirst('http://', 'ws://').replaceFirst('https://', 'wss://');
    final root = ws.replaceFirst(RegExp(r'/api/v1/?$'), '');
    return '$root/ws?token=${Uri.encodeComponent(token)}';
  }

  Future<void> connect() async {
    if (_disposed) return;
    _token = await _ref.read(tokenStoreProvider).read();
    if (_token == null || _token!.isEmpty) return;

    await disconnect();

    try {
      final channel = WebSocketChannel.connect(Uri.parse(_wsUrl(_token!)));
      _channel = channel;

      // ★ 必须紧跟 connect 挂监听：服务端在握手瞬间就发 hello，
      //   晚一步就会丢掉首帧。
      _sub = channel.stream.listen(
        _onMessage,
        onDone: _onDone,
        onError: (_) => _onDone(),
        cancelOnError: false,
      );

      connected = true;
      _startHeartbeat();
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    if (msg['type'] == 'hello') {
      connected = true;
      return;
    }
    if (msg['type'] != 'event') return;

    final event = msg['event'] as String? ?? '';
    final payload = msg['payload'];

    switch (event) {
      case 'redemption.created':
        // 有人兑换了 → 待我兑现列表变了
        _ref.invalidate(inboxRedemptionsProvider);
        _ref.invalidate(walletProvider);
        _ref.invalidate(bothWalletsProvider);
        break;

      case 'redemption.fulfilled':
        // TA 兑现了 → 我的兑换记录变了
        _ref.invalidate(myRedemptionsProvider);
        _ref.invalidate(inboxRedemptionsProvider);
        break;

      case 'redemption.nudged':
        // TA 在催我兑现
        final title = payload is Map ? (payload['itemName']?.toString() ?? '东西') : '东西';
        _nudgeController.add(title);
        _ref.invalidate(inboxRedemptionsProvider);
        break;

      case 'task.assigned':
      case 'task.accepted':
      case 'task.declined':
      case 'task.submitted':
      case 'task.confirmed':
      case 'task.auto_confirmed':
      case 'task.abandoned':
      case 'task.cancelled':
      case 'task.expired':
        // 事件内容可能过期；只失效并重新读取服务端权威状态。
        _ref.invalidate(tasksProvider);
        _ref.invalidate(pendingConfirmProvider);
        _ref.invalidate(walletProvider);
        _ref.invalidate(bothWalletsProvider);
        _ref.invalidate(systemTaskProvider);
        // 详情页也必须失效：否则对方提交后点进去还是「进行中」，
        // 既看不到照片文案，也没有确认按钮。
        _ref.invalidate(taskByIdProvider);
        break;

      case 'gift.received':
        _ref.invalidate(walletProvider);
        _ref.invalidate(bothWalletsProvider);
        _ref.invalidate(giftsReceivedProvider);
        _ref.invalidate(giftsSentProvider);
        break;
    }
  }

  void _onDone() {
    connected = false;
    _heartbeat?.cancel();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _reconnect?.cancel();
    _reconnect = Timer(const Duration(seconds: 5), () {
      if (!_disposed) connect();
    });
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(const Duration(seconds: 30), (_) {
      try {
        _channel?.sink.add(jsonEncode({
          'type': 'ping',
          't': DateTime.now().millisecondsSinceEpoch,
        }));
      } catch (_) {
        _onDone();
      }
    });
  }

  Future<void> disconnect() async {
    _heartbeat?.cancel();
    _reconnect?.cancel();
    await _sub?.cancel();
    _sub = null;
    try {
      await _channel?.sink.close();
    } catch (_) {}
    _channel = null;
    connected = false;
  }

  void dispose() {
    _disposed = true;
    disconnect();
    _nudgeController.close();
  }
}

/// 全局单例
final realtimeProvider = Provider<RealtimeService>((ref) {
  final svc = RealtimeService(ref);
  ref.onDispose(svc.dispose);
  return svc;
});
