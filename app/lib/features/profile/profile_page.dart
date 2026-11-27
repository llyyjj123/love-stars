import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    final both = ref.watch(bothWalletsProvider);
    final myRedemptions = ref.watch(myRedemptionsProvider);

    return GradientScaffold(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('我们', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.text)),
              ),
              IconButton(
                onPressed: () => context.push('/me/settings'),
                icon: const Icon(Icons.settings_outlined),
              ),
            ],
          ),
          const SizedBox(height: 4),

          // 情侣卡
          AppCard(
            color: AppColors.pinkSoft,
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(999)),
                      child: const Row(
                        children: [
                          Icon(Icons.favorite, size: 10, color: AppColors.brand),
                          SizedBox(width: 4),
                          Text('我们', style: TextStyle(fontSize: 11, color: AppColors.brand)),
                        ],
                      ),
                    ),
                    const Spacer(),
                    Text('在一起 ${_daysTogether()} 天', style: AppText.caption),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _avatar(session?.user?.displayName ?? '我', true),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 28),
                      child: Icon(Icons.favorite, size: 16, color: AppColors.pink),
                    ),
                    _avatar(session?.partner?.displayName ?? 'TA', false),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('把普通的一天，过成我们的小日子。', style: AppText.label),
                const SizedBox(height: 16),
                const Divider(height: 1, color: AppColors.border),
                const SizedBox(height: 12),
                both.when(
                  data: (w) => Row(
                    children: [
                      Expanded(child: _stat('我的小星星', '${w['mine']}', '颗')),
                      Expanded(child: _stat('TA 的小星星', '${w['partner']}', '颗')),
                      Expanded(child: _stat('本周我', _weekGain(ref), '', color: AppColors.goldDeep)),
                    ],
                  ),
                  loading: () => const SizedBox(height: 40, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                  error: (e, _) => Text('$e', style: const TextStyle(fontSize: 11, color: Colors.redAccent)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // 星星账本按钮
          ElevatedButton(
            onPressed: () => context.push('/me/ledger'),
            child: const Text('星星账本'),
          ),
          const SizedBox(height: 12),

          // 菜单
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _menuItem(context, Icons.receipt_long, '星星账本', '每一颗都有来处', '/me/ledger'),
                const Divider(height: 1, color: AppColors.border),
                _menuItem(context, Icons.checklist, '我的任务', '我发布的和我在做的', '/me/tasks'),
                const Divider(height: 1, color: AppColors.border),
                _menuItem(context, Icons.card_giftcard, '我的兑换', '用星星换的小确幸',
                    myRedemptions.value?.isEmpty == true ? '/items' : '/items'),
              ],
            ),
          ),
          const SizedBox(height: 12),

          const SizedBox(height: 16),

          TextButton(
            onPressed: () async {
              await ref.read(sessionProvider.notifier).logout();
              if (context.mounted) context.go('/login');
            },
            child: const Text('退出登录', style: TextStyle(color: AppColors.text3, fontSize: 13)),
          ),
        ],
      ),
    );
  }

  /// 在一起的天数：从 2023 年 6 月 18 日算起
  int _daysTogether() {
    final start = DateTime(2023, 6, 18);
    final now = DateTime.now();
    return now.difference(DateTime(start.year, start.month, start.day)).inDays + 1;
  }

  /// 本周获得的星星（服务端 /wallets 返回 weekGain）
  String _weekGain(WidgetRef ref) {
    final w = ref.watch(bothWalletsProvider).value;
    final g = (w?['weekGain'] as num?)?.toInt() ?? 0;
    return g > 0 ? '+$g' : '$g';
  }

  Widget _avatar(String name, bool isMe) {
    return Column(
      children: [
        Container(
          width: 62,
          height: 62,
          decoration: BoxDecoration(
            color: AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: isMe ? AppColors.gold : AppColors.pink, width: 2),
          ),
          child: Center(
            child: Text(
              name.isEmpty ? '★' : name.substring(0, 1),
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: isMe ? AppColors.goldDeep : AppColors.brand),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(isMe ? '我' : 'TA', style: AppText.caption),
      ],
    );
  }

  Widget _stat(String label, String value, String unit, {Color? color}) {
    return Column(
      children: [
        Text(label, style: AppText.caption),
        const SizedBox(height: 3),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color ?? AppColors.text)),
            if (unit.isNotEmpty) Text(unit, style: AppText.caption),
          ],
        ),
      ],
    );
  }

  Widget _menuItem(BuildContext context, IconData icon, String title, String sub, String route) {
    return InkWell(
      onTap: () => context.push(route),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(color: AppColors.tintSoft, borderRadius: BorderRadius.circular(AppRadius.sm)),
              child: Icon(icon, size: 17, color: AppColors.brand),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppColors.text)),
                  const SizedBox(height: 1),
                  Text(sub, style: AppText.caption),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 16, color: AppColors.text3),
          ],
        ),
      ),
    );
  }
}

