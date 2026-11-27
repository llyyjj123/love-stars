import 'package:shared_preferences/shared_preferences.dart';

/// 令牌存储
///
/// 生产环境建议换 flutter_secure_storage（iOS Keychain / Android Keystore）。
/// 当前用 SharedPreferences，方便先跑通；上线前替换。
class TokenStore {
  static const _key = 'access_token';

  Future<String?> read() async {
    final sp = await SharedPreferences.getInstance();
    return sp.getString(_key);
  }

  Future<void> write(String token) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_key, token);
  }

  Future<void> clear() async {
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_key);
  }
}
