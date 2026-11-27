import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    final both = ref.watch(bothWalletsProvider);
    final tasks = ref.watch(tasksProvider('assigned'));
    final pending = ref.watch(pendingConfirmProvider);

    return GradientScaffold(
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(walletProvider);
          ref.invalidate(bothWalletsProvider);
          ref.invalidate(tasksProvider);
          ref.invalidate(pendingConfirmProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            // 当前登录标识（方便确认切换账号生效）
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(999)),
                child: Text(
                  '当前：${session?.user?.displayName ?? "未登录"}',
                  style: const TextStyle(fontSize: 11, color: AppColors.text2),
                ),
              ),
            ),
            const SizedBox(height: 6),
            // 标题
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                  child: const Center(child: Text('★', style: TextStyle(fontSize: 20, color: AppColors.goldDeep))),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('我们的小家', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text)),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(Icons.favorite, size: 11, color: AppColors.pink),
                        const SizedBox(width: 4),
                        Text(
                          '${session?.user?.displayName ?? ''} 和 ${session?.partner?.displayName ?? ''}',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),

            // 余额卡
            AppCard(
              child: both.when(
                data: (w) => Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('我的小星星', style: AppText.caption),
                          const SizedBox(height: 4),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text('${w['mine']}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppColors.text)),
                              const SizedBox(width: 3),
                              const Text('颗', style: AppText.caption),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.favorite, size: 16, color: AppColors.pink),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          const Text('TA 的小星星', style: AppText.caption),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text('${w['partner']}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppColors.text)),
                              const SizedBox(width: 3),
                              const Text('颗', style: AppText.caption),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                loading: () => const SizedBox(height: 60, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                error: (e, _) => Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
              ),
            ),
            const SizedBox(height: 12),

            // 快捷入口
            Row(
              children: [
                _quick(context, '签到', Icons.calendar_today, () => context.push('/checkin')),
                const SizedBox(width: 10),
                _quick(context, '发布', Icons.add_circle_outline, () => context.push('/tasks/new')),
                const SizedBox(width: 10),
                _quick(context, '物品', Icons.card_giftcard, () => context.go('/items')),
                const SizedBox(width: 10),
                _quick(context, '送星星', Icons.favorite, () => context.push('/me/gift')),
              ],
            ),
            const SizedBox(height: 16),

            // 待我确认
            pending.when(
              data: (list) {
                if (list.isEmpty) return const SizedBox.shrink();
                final t = list.first;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.favorite, size: 12, color: AppColors.brand),
                        const SizedBox(width: 4),
                        const Text('今天的小事', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(8)),
                          child: Text('${list.length}', style: const TextStyle(fontSize: 10, color: AppColors.brand, fontWeight: FontWeight.w500)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    AppCard(
                      color: AppColors.pinkSoft,
                      onTap: () => context.push('/tasks/${t.id}'),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('TA 完成了「${t.title}」', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                                const SizedBox(height: 2),
                                const Text('你点头，星星就归 TA 啦', style: AppText.caption),
                              ],
                            ),
                          ),
                          ElevatedButton(
                            onPressed: () => context.push('/tasks/${t.id}'),
                            style: ElevatedButton.styleFrom(minimumSize: const Size(56, 32), padding: EdgeInsets.zero),
                            child: const Text('看看', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                );
              },
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // 我在做
            tasks.when(
              data: (list) {
                if (list.isEmpty) return const SizedBox.shrink();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text('我正在做', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(8)),
                          child: Text('${list.length}', style: const TextStyle(fontSize: 10, color: AppColors.brand, fontWeight: FontWeight.w500)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    AppCard(
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: [
                          for (var i = 0; i < list.length && i < 3; i++) ...[
                            if (i > 0) const Divider(height: 1, color: AppColors.border),
                            _taskRow(context, list[i]),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                );
              },
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _quick(BuildContext context, String label, IconData icon, VoidCallback onTap) {
    return Expanded(
      child: AppCard(
        padding: const EdgeInsets.symmetric(vertical: 12),
        radius: AppRadius.lg,
        onTap: onTap,
        child: Column(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(color: AppColors.tintSoft, shape: BoxShape.circle),
              child: Icon(icon, size: 18, color: AppColors.brand),
            ),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontSize: 12, color: AppColors.text2)),
          ],
        ),
      ),
    );
  }

  Widget _taskRow(BuildContext context, Task t) {
    return InkWell(
      onTap: () => context.push('/tasks/${t.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.tint, width: 1.5)),
              child: Center(
                child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.brand, shape: BoxShape.circle)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppColors.text)),
                  const SizedBox(height: 1),
                  Text(t.statusLabel, style: AppText.caption),
                ],
              ),
            ),
            Row(
              children: [
                Text('+${t.reward}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.goldDeep)),
                const SizedBox(width: 2),
                const Text('★', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.gold)),
              ],
            ),
            const Icon(Icons.chevron_right, size: 14, color: AppColors.text3),
          ],
        ),
      ),
    );
  }
}
