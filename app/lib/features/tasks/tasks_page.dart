import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class TasksPage extends ConsumerWidget {
  final bool embedded;
  const TasksPage({super.key, this.embedded = false});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletProvider);
    final assigned = ref.watch(tasksProvider('assigned'));
    final published = ref.watch(tasksProvider('published'));
    final pending = ref.watch(pendingConfirmProvider);
    final done = ref.watch(tasksProvider('done'));
    final ciState = ref.watch(checkInStateProvider);
    final systemTask = ref.watch(systemTaskProvider);

    // 抽卡：先弹预览，用户确认后才写入「我在做」
    final seen = <String>[];

    Future<void> drawTask() async {
      final api = ref.read(apiClientProvider);
      Task? task;
      try {
        task = await api.drawSystemTask(exclude: seen);
      } catch (e) {
        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
        return;
      }
      if (task == null) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('任务库暂时抽不到新任务了')));
        }
        return;
      }
      if (!context.mounted) return;
      final picked = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => _DrawPreviewSheet(task: task!),
      );
      if (picked == null) return;   // 用户点了「算了」

      if (picked == 'join') {
        // 加入我的任务
        try {
          await api.joinSystemTask(task.id);
          seen.clear();
          ref.invalidate(systemTaskProvider);
          ref.invalidate(tasksProvider);
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已加入「我在做」：${task.title}')));
          }
        } catch (e) {
          if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
        }
      } else if (picked == 'reshuffle') {
        // 换一个：记下看过的，递归抽下一张
        seen.add(task.id);
        if (context.mounted) await drawTask();
      }
    }

    return GradientScaffold(
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(walletProvider);
          ref.invalidate(tasksProvider);
          ref.invalidate(pendingConfirmProvider);
          ref.invalidate(checkInStateProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            // 标题 + 发布
            Row(
              children: [
                Expanded(
                  child: Text(
                    embedded ? '' : '我们的小任务',
                    style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => context.push('/tasks/new'),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('发布'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(84, 38),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    textStyle: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // 余额卡
            AppCard(
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                    child: const Center(child: Text('★', style: TextStyle(fontSize: 18, color: AppColors.goldDeep))),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: wallet.when(
                      data: (w) => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('我的小星星', style: AppText.caption),
                          const SizedBox(height: 2),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text('${w.balance}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.text)),
                              const SizedBox(width: 3),
                              const Text('颗', style: AppText.caption),
                              if (w.escrowed > 0) ...[
                                const SizedBox(width: 8),
                                Text('托管中 ${w.escrowed}', style: const TextStyle(fontSize: 11, color: AppColors.goldDeep)),
                              ],
                            ],
                          ),
                        ],
                      ),
                      loading: () => const SizedBox(height: 44, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                      error: (e, _) => Text('$e', style: const TextStyle(fontSize: 11, color: Colors.redAccent)),
                    ),
                  ),
                  TextButton(
                    onPressed: () => context.push('/me/ledger'),
                    child: const Text('星星账本 ›', style: TextStyle(fontSize: 11)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),

            // 系统任务：完成或放弃当前任务后才能再抽，避免反复刷奖励。
            systemTask.when(
              data: (task) => AppCard(
                color: AppColors.goldBg,
                onTap: task == null ? null : () => context.push('/tasks/${task.id}'),
                child: task == null
                    ? Row(
                        children: [
                          const Icon(Icons.auto_awesome, color: AppColors.goldDeep),
                          const SizedBox(width: 12),
                          const Expanded(child: Text('不知道做什么？抽一个小任务', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.text))),
                          TextButton(onPressed: drawTask, child: const Text('抽一个')),
                        ],
                      )
                    : Row(
                        children: [
                          const Icon(Icons.auto_awesome, color: AppColors.goldDeep),
                          const SizedBox(width: 12),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(task.title, style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.text)),
                            const Text('今日的小任务，完成后等 TA 确认', style: AppText.caption),
                          ])),
                          Text('+${task.reward}★', style: const TextStyle(color: AppColors.goldDeep, fontWeight: FontWeight.w700)),
                        ],
                      ),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            const SizedBox(height: 12),

            // 签到卡
            AppCard(
              color: AppColors.goldBg,
              onTap: () => context.push('/checkin'),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
                    child: const Center(child: Text('★', style: TextStyle(fontSize: 16, color: AppColors.goldDeep))),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ciState.when(
                      data: (s) {
                        final streak = (s['currentStreak'] as num?)?.toInt() ?? 0;
                        final today = s['today'] as String? ?? '';
                        final signedToday = s['lastDateKey'] == today;
                        final next = (streak % 7) + 1;
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              signedToday ? '今天已签到 · 连续 $streak 天' : '连续 $streak 天，今天第 $next 天',
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              signedToday ? '明天记得再来' : '签到可得 +${next == 7 ? 5 : 1} 颗星',
                              style: const TextStyle(fontSize: 11, color: AppColors.text2),
                            ),
                          ],
                        );
                      },
                      loading: () => const Text('签到状态加载中…', style: AppText.caption),
                      error: (e, _) => const Text('签到状态不可用', style: AppText.caption),
                    ),
                  ),
                  const Text('去签到 ›', style: TextStyle(fontSize: 13, color: AppColors.goldDeep, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // 待我确认
            pending.when(
              data: (list) {
                if (list.isEmpty) return const SizedBox.shrink();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _sectionTitle('等我确认', list.length),
                    const SizedBox(height: 8),
                    for (final t in list) ...[
                      AppCard(
                        color: AppColors.pinkSoft,
                        onTap: () => context.push('/tasks/${t.id}'),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
                              child: const Center(child: Text('★', style: TextStyle(fontSize: 18, color: AppColors.gold))),
                            ),
                            const SizedBox(width: 10),
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
                            Row(
                              children: [
                                Text('+${t.reward}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.goldDeep)),
                                const SizedBox(width: 2),
                                const Text('★', style: TextStyle(fontSize: 12, color: AppColors.gold)),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    const SizedBox(height: 8),
                  ],
                );
              },
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // 我在做
            assigned.when(
              data: (list) => list.isEmpty
                  ? const SizedBox.shrink()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _sectionTitle('我在做', list.length),
                        const SizedBox(height: 8),
                        AppCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (var i = 0; i < list.length; i++) ...[
                                if (i > 0) const Divider(height: 1, color: AppColors.border),
                                _row(context, list[i]),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // 我发布的
            published.when(
              data: (list) => list.isEmpty
                  ? const SizedBox.shrink()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _sectionTitle('我发布的', list.length),
                        const SizedBox(height: 8),
                        AppCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (var i = 0; i < list.length; i++) ...[
                                if (i > 0) const Divider(height: 1, color: AppColors.border),
                                _row(context, list[i], showStatus: true),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // 已完成（折叠，默认不展开）
            done.when(
              data: (list) => list.isEmpty
                  ? const SizedBox.shrink()
                  : _DoneSection(tasks: list),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // 空状态
            if (assigned.value?.isEmpty == true && published.value?.isEmpty == true && pending.value?.isEmpty == true && done.value?.isEmpty == true)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Column(
                  children: [
                    const Text('★', style: TextStyle(fontSize: 40, color: AppColors.gold)),
                    const SizedBox(height: 16),
                    const Text('今天还没有小任务', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.text)),
                    const SizedBox(height: 6),
                    const Text('先派一件小事给 TA，或者从模板挑一个。', style: AppText.caption),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: () => context.push('/tasks/new'),
                      child: const Text('+ 发布第一件小事'),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(String text, int count) {
    return Row(
      children: [
        Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
        const SizedBox(width: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(8)),
          child: Text('$count', style: const TextStyle(fontSize: 10, color: AppColors.brand, fontWeight: FontWeight.w500)),
        ),
      ],
    );
  }

  Widget _row(BuildContext context, Task t, {bool showStatus = false}) {
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
              child: Center(child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.brand, shape: BoxShape.circle))),
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
            if (showStatus) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: t.status == 'accepted' ? AppColors.greenBg : AppColors.goldBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  t.statusLabel,
                  style: TextStyle(fontSize: 10, color: t.status == 'accepted' ? AppColors.green : AppColors.goldDeep),
                ),
              ),
            ],
            const Icon(Icons.chevron_right, size: 14, color: AppColors.text3),
          ],
        ),
      ),
    );
  }
}

/// 抽卡预览：加入 / 换一个 / 算了
///
/// 返回值为选中的 Task（加入），或 _reshuffle（换一个），或 null（算了）。
class _DrawPreviewSheet extends StatelessWidget {
  final Task task;
  const _DrawPreviewSheet({required this.task});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      padding: EdgeInsets.fromLTRB(20, 14, 20, 28 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40, height: 4,
              decoration: BoxDecoration(color: AppColors.borderStrong, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Container(
                width: 40, height: 40,
                decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                child: const Center(child: Icon(Icons.auto_awesome, size: 20, color: AppColors.goldDeep)),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text('抽到一个小任务', style: TextStyle(fontSize: 13, color: AppColors.text2)),
              ),
              Row(
                children: [
                  Text('+${task.reward}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                  const SizedBox(width: 2),
                  const Text('★', style: TextStyle(fontSize: 13, color: AppColors.gold)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(task.title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.text)),
          if (task.description != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('完成标准', style: AppText.caption),
                  const SizedBox(height: 6),
                  Text(task.description!, style: const TextStyle(fontSize: 13, height: 1.6, color: AppColors.text2)),
                ],
              ),
            ),
          ],
          const SizedBox(height: 8),
          const Text('加入后会出现在「我在做」，完成并等 TA 确认才能拿到星星。', style: AppText.caption),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('算了'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 3,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, 'reshuffle'),
                  child: const Text('换一个'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context, 'join'),
              child: const Text('加入我的任务'),
            ),
          ),
        ],
      ),
    );
  }
}

/// 已完成任务：默认折叠，点开才显示，不占首页空间
class _DoneSection extends StatefulWidget {
  final List<Task> tasks;
  const _DoneSection({required this.tasks});

  @override
  State<_DoneSection> createState() => _DoneSectionState();
}

class _DoneSectionState extends State<_DoneSection> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        InkWell(
          onTap: () => setState(() => _open = !_open),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Icon(_open ? Icons.expand_less : Icons.expand_more, size: 18, color: AppColors.text3),
                const SizedBox(width: 4),
                Text('已完成 ${widget.tasks.length} 个', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text2)),
              ],
            ),
          ),
        ),
        if (_open)
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < widget.tasks.length; i++) ...[
                  if (i > 0) const Divider(height: 1, color: AppColors.border),
                  // 归档任务也要能点开看完成详情（照片、附言、谁确认的）
                  InkWell(
                    onTap: () => context.push('/tasks/${widget.tasks[i].id}'),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle, size: 18, color: AppColors.green),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(widget.tasks[i].title, style: const TextStyle(fontSize: 14, color: AppColors.text)),
                                Text(
                                  widget.tasks[i].origin == 'system' ? '系统任务 · 已完成' : '一起做 · 已完成',
                                  style: AppText.caption,
                                ),
                              ],
                            ),
                          ),
                          Text('+${widget.tasks[i].reward}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text3)),
                          const SizedBox(width: 2),
                          const Text('★', style: TextStyle(fontSize: 11, color: AppColors.text3)),
                          const SizedBox(width: 4),
                          const Icon(Icons.chevron_right, size: 14, color: AppColors.text3),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 8),
      ],
    );
  }
}
