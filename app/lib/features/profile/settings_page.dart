import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  /// 在一起的天数：从 2023 年 6 月 18 日算起（与个人页一致）
  static int _daysTogether() {
    final start = DateTime(2023, 6, 18);
    final now = DateTime.now();
    return now.difference(DateTime(start.year, start.month, start.day)).inDays + 1;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    return GradientScaffold(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => popOrHome(context),
                  icon: const Icon(Icons.arrow_back),
                  style: IconButton.styleFrom(backgroundColor: AppColors.surface),
                ),
                const Expanded(
                  child: Center(
                    child: Text('情侣设置', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('我们的资料', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                      const SizedBox(height: 12),
                      _row('我的昵称', session?.user?.displayName ?? '我'),
                      const Divider(height: 20, color: AppColors.border),
                      _row('TA 的昵称', session?.partner?.displayName ?? 'TA'),
                      const Divider(height: 20, color: AppColors.border),
                      _row('我们在一起', '${_daysTogether()} 天'),
                      const Divider(height: 20, color: AppColors.border),
                      _row('绑定状态', '已绑定'),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('提醒', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                      const SizedBox(height: 10),
                      _toggle('任务待确认提醒', true),
                      _toggle('兑换待兑现提醒', true),
                      _toggle('每日签到提醒', false),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('关于', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                      const SizedBox(height: 10),
                      _VersionRow(),
                      const Divider(height: 20, color: AppColors.border),
                      _row('星星规则', '签到 + 任务'),
                      const Divider(height: 20, color: AppColors.border),
                      _row('兑换规则', '即销毁，不退款'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Row(
      children: [
        Text(label, style: AppText.label),
        const Spacer(),
        Text(value, style: const TextStyle(fontSize: 13, color: AppColors.text)),
      ],
    );
  }

  Widget _toggle(String label, bool value) {
    return Row(
      children: [
        Text(label, style: AppText.label),
        const Spacer(),
        Switch(value: value, onChanged: (_) {}, activeThumbColor: AppColors.brand),
      ],
    );
  }
}

/// 版本号：从安装包读取，不再写死
class _VersionRow extends StatefulWidget {
  const _VersionRow();

  @override
  State<_VersionRow> createState() => _VersionRowState();
}

class _VersionRowState extends State<_VersionRow> {
  String _text = '—';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((info) {
      if (!mounted) return;
      setState(() => _text = info.version == info.buildNumber ? info.version : '${info.version} (${info.buildNumber})');
    }).catchError((_) {
      if (mounted) setState(() => _text = '未知');
    });
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('版本', style: AppText.label),
        const Spacer(),
        Text(_text, style: const TextStyle(fontSize: 13, color: AppColors.text)),
      ],
    );
  }
}
