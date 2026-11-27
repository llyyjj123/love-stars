import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class RedeemSuccessPage extends ConsumerWidget {
  const RedeemSuccessPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mine = ref.watch(myRedemptionsProvider);
    final latest = mine.value?.isNotEmpty == true ? mine.value!.first : null;
    final wallet = ref.watch(walletProvider);

    return GradientScaffold(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: IconButton(
              onPressed: () => context.go('/items'),
              icon: const Icon(Icons.close),
              style: IconButton.styleFrom(backgroundColor: AppColors.surface),
            ),
          ),
          const SizedBox(height: 40),

          // 大图标
          Center(
            child: Container(
              width: 132,
              height: 132,
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: AppColors.gold.withValues(alpha: 0.25), blurRadius: 40, spreadRadius: 8),
                ],
              ),
              child: Center(child: Text(latest?.itemEmoji ?? '★', style: const TextStyle(fontSize: 54))),
            ),
          ),
          const SizedBox(height: 32),

          Center(
            child: Text('${latest?.itemName ?? "兑换"}好啦', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.text)),
          ),
          const SizedBox(height: 6),
          Center(
            child: RichText(
              text: TextSpan(
                style: AppText.label,
                children: [
                  const TextSpan(text: '用 '),
                  TextSpan(
                    text: '${latest?.totalStars ?? 0} 颗星',
                    style: const TextStyle(color: AppColors.goldDeep, fontWeight: FontWeight.w700),
                  ),
                  const TextSpan(text: '换的，已经告诉 TA 啦'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(color: AppColors.greenBg, borderRadius: BorderRadius.circular(999)),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check, size: 11, color: AppColors.green),
                  SizedBox(width: 4),
                  Text('已通知 TA 来兑现', style: TextStyle(fontSize: 11, color: AppColors.green)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 28),

          // 余额对比
          AppCard(
            child: Row(
              children: [
                Expanded(child: _col('兑换前', '${(wallet.value?.balance ?? 0) + (latest?.totalStars ?? 0)}', false)),
                Container(
                  width: 36,
                  height: 36,
                  decoration: const BoxDecoration(color: AppColors.tintSoft, shape: BoxShape.circle),
                  child: const Icon(Icons.favorite, size: 15, color: AppColors.pink),
                ),
                Expanded(child: _col('兑换后', '${wallet.value?.balance ?? 0}', true, delta: latest?.totalStars)),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // 兑换卡
          if (latest != null)
            AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(AppRadius.md)),
                    child: Center(child: Text(latest.itemEmoji ?? '★', style: const TextStyle(fontSize: 20))),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${latest.itemName} · 待兑现', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                        const Text('TA 兑现后记得拍张照', style: AppText.caption),
                      ],
                    ),
                  ),
                  Row(
                    children: [
                      Text('${latest.totalStars}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.goldDeep)),
                      const SizedBox(width: 2),
                      const Text('★', style: TextStyle(fontSize: 12, color: AppColors.gold)),
                    ],
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(999)),
                    child: const Text('待兑现', style: TextStyle(fontSize: 10, color: AppColors.brand)),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 20),

          ElevatedButton(
            onPressed: () => context.go('/items'),
            child: const Text('好啦'),
          ),
          const SizedBox(height: 12),
          Center(
            child: TextButton(
              onPressed: () {
                context.go('/items');
              },
              child: const Text('查看我的兑换 ›', style: TextStyle(fontSize: 13, color: AppColors.text2)),
            ),
          ),
          const SizedBox(height: 8),
          const Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.favorite, size: 11, color: AppColors.text3),
                SizedBox(width: 4),
                Text('星星已销毁，但心意会留下', style: AppText.caption),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _col(String label, String value, bool highlight, {int? delta}) {
    return Column(
      children: [
        Text(label, style: AppText.caption),
        const SizedBox(height: 3),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppColors.text)),
            const Text('颗', style: AppText.caption),
            if (delta != null) ...[
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: AppColors.pinkSoft, borderRadius: BorderRadius.circular(999)),
                child: Text('-$delta', style: const TextStyle(fontSize: 10, color: AppColors.brand)),
              ),
            ],
          ],
        ),
      ],
    );
  }
}
