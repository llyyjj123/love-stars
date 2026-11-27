import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class CheckinPage extends ConsumerStatefulWidget {
  const CheckinPage({super.key});

  @override
  ConsumerState<CheckinPage> createState() => _CheckinPageState();
}

class _CheckinPageState extends ConsumerState<CheckinPage> {
  bool _loading = false;

  Future<void> _checkIn() async {
    setState(() => _loading = true);
    try {
      final r = await ref.read(apiClientProvider).checkIn();
      ref.invalidate(checkInStateProvider);
      ref.invalidate(walletProvider);
      ref.invalidate(bothWalletsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('签到成功，+${r['gained']} 颗星')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(checkInStateProvider);

    return GradientScaffold(
      child: Column(
        children: [
          // 导航
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => context.pop(),
                  icon: const Icon(Icons.arrow_back),
                  style: IconButton.styleFrom(backgroundColor: AppColors.surface),
                ),
                const Expanded(
                  child: Center(
                    child: Text('签到', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          Expanded(
            child: state.when(
              data: (s) {
                final streak = (s['currentStreak'] as num?)?.toInt() ?? 0;
                final today = s['today'] as String? ?? '';
                final signedToday = s['lastDateKey'] == today;
                final nextDay = signedToday ? streak : (streak % 7) + 1;
                final reward = nextDay == 7 ? 5 : 1;

                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  children: [
                    const Text('今天打个卡', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.text)),
                    const SizedBox(height: 4),
                    const Text('每天 1 星 · 第 7 天 +5', style: AppText.label),
                    const SizedBox(height: 16),

                    // 主卡
                    AppCard(
                      color: AppColors.pinkSoft,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(999)),
                                child: const Row(
                                  children: [
                                    Text('★', style: TextStyle(fontSize: 10, color: AppColors.goldDeep)),
                                    SizedBox(width: 4),
                                    Text('每日签到', style: TextStyle(fontSize: 11, color: AppColors.goldDeep)),
                                  ],
                                ),
                              ),
                              const Spacer(),
                              Text('本周第 $nextDay 天', style: AppText.caption),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Expanded(
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.baseline,
                                  textBaseline: TextBaseline.alphabetic,
                                  children: [
                                    Text('$streak', style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w900, color: AppColors.text)),
                                    const SizedBox(width: 6),
                                    const Text('天', style: TextStyle(fontSize: 16, color: AppColors.text2)),
                                  ],
                                ),
                              ),
                              // 这是「第 7 天奖励预告」，规则固定 +5，不随今天是第几天变化。
                              // 之前用 +$reward 显示的是「今天能拿多少」，第 1 天就变成「第 7 天 +1★」。
                              Container(
                                width: 76,
                                height: 76,
                                decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
                                child: const Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text('第 7 天', style: TextStyle(fontSize: 11, color: AppColors.text2)),
                                    Text('+5★', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          // 7 个日期圈
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              for (var i = 1; i <= 7; i++)
                                _dayCircle(i, signedToday ? i <= (streak % 7 == 0 ? 7 : streak % 7) : i <= (streak % 7), i == nextDay),
                            ],
                          ),
                          const SizedBox(height: 18),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton(
                              onPressed: signedToday || _loading ? null : _checkIn,
                              child: _loading
                                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : Text(signedToday ? '今天已经签过啦' : '签到领 $reward★'),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    const SizedBox(height: 12),

                    // 规则
                    AppCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('签到规则', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                          const SizedBox(height: 10),
                          _rule('每天 +1 星'),
                          _rule('连续第 7 天额外 +5 星'),
                          _rule('每 7 天循环一次'),
                          _rule('不补签，断签后连续数归 1'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Center(child: Text(_footerHint(streak, signedToday), style: AppText.caption)),
                  ],
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
            ),
          ),
        ],
      ),
    );
  }

  /// 底部提示：按今天第几天动态生成，不再写死"连续 7 天就满啦"
  String _footerHint(int streak, bool signedToday) {
    final inCycle = streak % 7;                       // 本轮已签几天
    final dayAfter = signedToday ? streak : inCycle + 1;  // 今天签完是第几天
    final left = 7 - (dayAfter % 7 == 0 ? 7 : dayAfter % 7);
    if (signedToday && inCycle == 0 && streak > 0) return '满 7 天啦，明天开始新一轮';
    if (left == 0) return '满 7 天啦，明天开始新一轮';
    if (signedToday) return '已连签 $streak 天，还差 $left 天到第 7 天';
    if (dayAfter == 7) return '今天签完就满 7 天啦';
    return '今天签完是第 $dayAfter 天，还差 $left 天';
  }

  Widget _dayCircle(int day, bool done, bool isToday) {
    return Column(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: done ? AppColors.brand : AppColors.surface,
            border: isToday && !done ? Border.all(color: AppColors.brand, width: 1.5) : null,
          ),
          child: Center(
            child: done
                ? const Icon(Icons.check, size: 16, color: AppColors.onBrand)
                : Text(
                    isToday ? '★' : '$day',
                    style: TextStyle(fontSize: 13, color: isToday ? AppColors.brand : AppColors.text3),
                  ),
          ),
        ),
        const SizedBox(height: 4),
        Text(isToday ? '今天' : 'D$day', style: TextStyle(fontSize: 9, color: isToday ? AppColors.brand : AppColors.text3)),
      ],
    );
  }

  Widget _rule(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          const Icon(Icons.check, size: 12, color: AppColors.green),
          const SizedBox(width: 6),
          Text(text, style: AppText.label),
        ],
      ),
    );
  }
}
