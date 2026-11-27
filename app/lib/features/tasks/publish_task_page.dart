import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class PublishTaskPage extends ConsumerStatefulWidget {
  const PublishTaskPage({super.key});

  @override
  ConsumerState<PublishTaskPage> createState() => _PublishTaskPageState();
}

class _PublishTaskPageState extends ConsumerState<PublishTaskPage> {
  final _title = TextEditingController(text: '一起看一部电影');
  final _note = TextEditingController();
  int _reward = 4;
  int? _timeLimitHours;   // null = 不限时
  bool _busy = false;

  static const _timeLimits = [
    (null, '不限时'),
    (2, '2 小时'),
    (6, '6 小时'),
    (12, '12 小时'),
    (24, '1 天'),
    (72, '3 天'),
    (168, '7 天'),
  ];

  static const _presets = [
    ('洗碗', 3),
    ('倒垃圾', 3),
    ('整理书桌', 2),
    ('浇花', 2),
    ('取快递', 3),
  ];

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _publish(int balance) async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('先给任务起个名字')));
      return;
    }
    if (_reward > balance) {
      _showNotEnough(balance);
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).publishTask(
            title: _title.text.trim(),
            reward: _reward,
            timeLimitHours: _timeLimitHours,
          );
      ref.invalidate(tasksProvider);
      ref.invalidate(walletProvider);
      ref.invalidate(bothWalletsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已发布，$_reward 星进入托管')),
        );
        context.pop();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showNotEnough(int balance) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.borderStrong, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('★', style: TextStyle(fontSize: 30, color: AppColors.gold)),
                const SizedBox(width: 8),
                const Text('星星不够啦', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text)),
              ],
            ),
            const SizedBox(height: 6),
            Text('这次要送 $_reward 颗，你现在只有 $balance 颗。', style: AppText.label),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: Row(
                children: [
                  Expanded(child: _num('$balance', '我的星星')),
                  Container(width: 1, height: 30, color: AppColors.border),
                  Expanded(child: _num('$_reward', '这次要送')),
                  Container(width: 1, height: 30, color: AppColors.border),
                  Expanded(child: _num('${_reward - balance}', '还差', color: AppColors.brand)),
                ],
              ),
            ),
            const SizedBox(height: 14),
            const Text('可以先签到攒星星，或者把奖励改小一点。', style: AppText.caption),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() => _reward = balance);
                    },
                    child: const Text('改小奖励'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 3,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      context.push('/checkin');
                    },
                    child: const Text('去签到赚星星'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _num(String value, String label, {Color? color}) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: color ?? AppColors.text)),
        const SizedBox(height: 2),
        Text(label, style: AppText.caption),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
    final balance = wallet.value?.balance ?? 0;

    return GradientScaffold(
      child: Column(
        children: [
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
                    child: Text('发布任务', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
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
                const Text('给 TA 一个小任务', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 3),
                const Text('TA 做完后，由我确认，星星才会到账。', style: AppText.caption),
                const SizedBox(height: 14),

                // 常用胶囊
                Wrap(
                  spacing: 8,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 7),
                      child: Text('常用', style: AppText.caption),
                    ),
                    for (final p in _presets)
                      GestureDetector(
                        onTap: () => setState(() {
                          _title.text = p.$1;
                          _reward = p.$2;
                        }),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                          decoration: BoxDecoration(
                            color: _title.text == p.$1 ? AppColors.pinkSoft : AppColors.surface,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: _title.text == p.$1 ? AppColors.brand : AppColors.border),
                          ),
                          child: Text('${p.$1} +${p.$2}',
                              style: TextStyle(fontSize: 13, color: _title.text == p.$1 ? AppColors.brand : AppColors.text2)),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 14),

                // 表单
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('任务名称', style: AppText.caption),
                      const SizedBox(height: 6),
                      TextField(controller: _title, maxLength: 30),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Text('奖励星星', style: AppText.caption),
                          const Spacer(),
                          Text('我的余额 $balance 颗',
                              style: TextStyle(fontSize: 11, color: _reward > balance ? AppColors.brand : AppColors.text3)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: _reward > balance ? AppColors.brand : AppColors.borderStrong,
                            width: _reward > balance ? 1.5 : 1,
                          ),
                        ),
                        child: Row(
                          children: [
                            Text('$_reward', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                            const SizedBox(width: 4),
                            const Text('★', style: TextStyle(fontSize: 13, color: AppColors.gold)),
                            if (_reward > balance) ...[
                              const SizedBox(width: 8),
                              Text('余额不足 ${_reward - balance} 颗', style: const TextStyle(fontSize: 11, color: AppColors.brand)),
                            ],
                            const Spacer(),
                            IconButton(
                              onPressed: _reward > 1 ? () => setState(() => _reward--) : null,
                              icon: const Icon(Icons.remove, size: 18),
                              style: IconButton.styleFrom(backgroundColor: AppColors.surface, minimumSize: const Size(30, 30)),
                            ),
                            const SizedBox(width: 6),
                            IconButton(
                              onPressed: () => setState(() => _reward++),
                              icon: const Icon(Icons.add, size: 18),
                              style: IconButton.styleFrom(backgroundColor: AppColors.surface, minimumSize: const Size(30, 30)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          const Text('完成时限', style: AppText.caption),
                          const Spacer(),
                          Text(
                            _timeLimitHours == null ? '不计时' : '接受后开始计时',
                            style: AppText.caption,
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final (h, label) in _timeLimits)
                            GestureDetector(
                              onTap: () => setState(() => _timeLimitHours = h),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                decoration: BoxDecoration(
                                  color: _timeLimitHours == h ? AppColors.brand : AppColors.subtle,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: _timeLimitHours == h ? AppColors.brand : AppColors.border,
                                  ),
                                ),
                                child: Text(
                                  label,
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: _timeLimitHours == h ? FontWeight.w700 : FontWeight.w400,
                                    color: _timeLimitHours == h ? AppColors.onBrand : AppColors.text2,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                      if (_timeLimitHours != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          '超时未提交：托管退还，你还会额外收到对方 ${_reward} 星赔偿（余额不足则赔到 0）',
                          style: const TextStyle(fontSize: 11, color: AppColors.text2, height: 1.4),
                        ),
                      ],
                      const SizedBox(height: 14),
                      const Text('备注（选填）', style: AppText.caption),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _note,
                        maxLines: 3,
                        maxLength: 100,
                        decoration: const InputDecoration(hintText: '看完记得拍一张合照。'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // 托管提示
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.subtle,
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    border: Border(
                      left: BorderSide(
                        color: _reward > balance ? AppColors.brand : AppColors.gold,
                        width: 4,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: _reward > balance ? AppColors.pinkSoft : AppColors.goldBg,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: _reward > balance
                              ? const Text('!', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppColors.brand))
                              : const Icon(Icons.lock_outline, size: 15, color: AppColors.goldDeep),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('发布后扣 $_reward 星，进入托管', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text)),
                            Text(
                              _reward > balance ? '你现在只有 $balance 颗，还差 ${_reward - balance} 颗' : '不是确认时才扣；TA 确认后才会转给 TA',
                              style: AppText.caption,
                            ),
                          ],
                        ),
                      ),
                      Text(
                        '$balance → ${balance - _reward}',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _reward > balance ? AppColors.brand : AppColors.goldDeep),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // 底部按钮
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: OutlinedButton(
                      onPressed: () => context.pop(),
                      child: const Text('存草稿'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 5,
                    child: ElevatedButton(
                      onPressed: _busy ? null : () => _publish(balance),
                      child: _busy
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text('发布并托管 $_reward 星'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
