import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/theme/tokens.dart';
import '../data/providers/providers.dart';

/// 底部四个 Tab：首页 / 任务 / 物品 / 我的
///
/// 红点规则：
///   任务 → 有待我确认的任务
///   物品 → 有待我兑现的兑换
class AppShell extends ConsumerWidget {
  final Widget child;
  final String location;

  const AppShell({super.key, required this.child, required this.location});

  int get _index {
    if (location.startsWith('/tasks')) return 1;
    if (location.startsWith('/items')) return 2;
    if (location.startsWith('/me')) return 3;
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pendingTasks = ref.watch(pendingConfirmProvider).value?.length ?? 0;
    final pendingRedemptions = ref.watch(inboxRedemptionsProvider).value?.length ?? 0;

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 60,
            child: Row(
              children: [
                _tab(context, 0, '首页', Icons.home_outlined, Icons.home, 0),
                _tab(context, 1, '任务', Icons.check_circle_outline, Icons.check_circle, pendingTasks),
                _tab(context, 2, '物品', Icons.card_giftcard_outlined, Icons.card_giftcard, pendingRedemptions),
                _tab(context, 3, '我的', Icons.person_outline, Icons.person, 0),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tab(
    BuildContext context,
    int i,
    String label,
    IconData icon,
    IconData activeIcon,
    int badge,
  ) {
    final active = _index == i;
    final color = active ? AppColors.brand : AppColors.text3;
    return Expanded(
      child: InkWell(
        onTap: () {
          switch (i) {
            case 0:
              context.go('/');
              break;
            case 1:
              context.go('/tasks');
              break;
            case 2:
              context.go('/items');
              break;
            case 3:
              context.go('/me');
              break;
          }
        },
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // 图标 + 右上角红点
            SizedBox(
              width: 34,
              height: 24,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Center(child: Icon(active ? activeIcon : icon, size: 22, color: color)),
                  if (badge > 0)
                    Positioned(
                      right: 2,
                      top: 0,
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        decoration: BoxDecoration(
                          color: AppColors.brand,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.surface, width: 1.5),
                        ),
                        child: Center(
                          child: Text(
                            badge > 9 ? '9+' : '$badge',
                            style: const TextStyle(fontSize: 9, color: AppColors.onBrand, fontWeight: FontWeight.w700, height: 1.1),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 11, color: color, fontWeight: active ? FontWeight.w700 : FontWeight.w400),
            ),
          ],
        ),
      ),
    );
  }
}
