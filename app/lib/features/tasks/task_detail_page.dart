import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

class TaskDetailPage extends ConsumerStatefulWidget {
  final String taskId;
  const TaskDetailPage({super.key, required this.taskId});

  @override
  ConsumerState<TaskDetailPage> createState() => _TaskDetailPageState();
}

class _TaskDetailPageState extends ConsumerState<TaskDetailPage> {
  bool _busy = false;

  Future<void> _act(String action, {String? photoUrl, String? note}) async {
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).taskAction(widget.taskId, action, photoUrl: photoUrl, note: note);
      ref.invalidate(tasksProvider);
      ref.invalidate(taskByIdProvider(widget.taskId));
      ref.invalidate(pendingConfirmProvider);
      ref.invalidate(walletProvider);
      ref.invalidate(bothWalletsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_actionLabel(action))));
        if (action == 'confirm' || action == 'decline' || action == 'cancel') {
          context.pop();
        }
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 拒绝前确认一次：拒绝后任务从列表消失，自定义任务的星星会退回对方
  Future<void> _confirmDecline(Task t) async {
    final isSystem = t.origin == 'system';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('拒绝这个任务？'),
        content: Text(
          isSystem
              ? '拒绝后它不会出现在你的任务列表里，之后还有机会再抽到。'
              : '拒绝后 ${t.reward} 颗星会退回给 TA，任务从列表消失。',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('再想想')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确定拒绝')),
        ],
      ),
    );
    if (ok == true) await _act('decline');
  }

  /// 提交弹层：可附照片和文案，而不是一个按钮就完事
  Future<void> _showSubmitSheet(Task t) async {
    final note = TextEditingController();
    String? photoUrl;
    bool uploading = false;

    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final bottom = MediaQuery.of(ctx).viewInsets.bottom;
          return Container(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
            ),
            constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.9 - bottom),
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(20, 14, 20, 28 + bottom),
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
                  const SizedBox(height: 18),
                  Text('提交「${t.title}」', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.text)),
                  const SizedBox(height: 4),
                  const Text('提交后计时停止，等 TA 确认就能拿到星星。', style: AppText.caption),
                  const SizedBox(height: 18),

                  // 照片（可选）
                  OutlinedButton.icon(
                    onPressed: uploading
                        ? null
                        : () async {
                            final source = await _pickSource(ctx);
                            if (source == null) return;
                            final picker = ImagePicker();
                            final picked = await picker.pickImage(
                              source: source,
                              maxWidth: 1080,
                              imageQuality: 80,
                            );
                            if (picked == null) return;
                            setSheet(() => uploading = true);
                            try {
                              final url = await ref.read(apiClientProvider).uploadPhoto(picked.path);
                              setSheet(() {
                                photoUrl = url;
                                uploading = false;
                              });
                            } catch (e) {
                              setSheet(() => uploading = false);
                              if (ctx.mounted) {
                                ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('上传失败：$e')));
                              }
                            }
                          },
                    icon: Icon(photoUrl == null ? Icons.add_a_photo_outlined : Icons.check_circle, size: 18),
                    label: Text(
                      uploading
                          ? '上传中…'
                          : photoUrl == null
                              ? '添加照片（选填）'
                              : '照片已添加，点此重选',
                    ),
                  ),
                  const SizedBox(height: 16),

                  // 文案（可选）
                  const Text('说点什么（选填）', style: AppText.caption),
                  const SizedBox(height: 6),
                  TextField(
                    controller: note,
                    maxLines: 3,
                    maxLength: 200,
                    decoration: const InputDecoration(hintText: '比如：今天扫得很干净，角落也擦了'),
                  ),
                  const SizedBox(height: 12),

                  Row(
                    children: [
                      Expanded(
                        flex: 2,
                        child: OutlinedButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: const Text('取消'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        flex: 4,
                        child: ElevatedButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('提交'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );

    if (result == true) {
      await _act('submit', photoUrl: photoUrl, note: note.text.trim().isEmpty ? null : note.text.trim());
    }
    note.dispose();
  }

  /// 让用户选拍照还是从相册选
  Future<ImageSource?> _pickSource(BuildContext context) {
    return showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('拍一张'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('从相册选'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// 时限进度条：显示还剩多少时间，超时变红
  Widget _deadlineBar(Task t) {
    final now = DateTime.now();
    final deadline = t.deadlineAt!;
    final start = t.acceptedAt ?? now;
    final total = deadline.difference(start).inSeconds;
    if (total <= 0) return const SizedBox.shrink();

    final left = deadline.difference(now).inSeconds;
    final pct = ((total - left) / total).clamp(0.0, 1.0);
    final overdue = left <= 0;
    final urgent = !overdue && pct >= 0.75;

    final text = overdue
        ? '已超时'
        : left >= 3600
            ? '还剩 ${(left / 3600).floor()} 小时 ${(left % 3600) ~/ 60} 分钟'
            : '还剩 ${(left / 60).ceil()} 分钟';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: overdue ? const Color(0xFFFFEBEE) : (urgent ? AppColors.goldBg : AppColors.subtle),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(overdue ? Icons.error_outline : Icons.schedule, size: 16,
                  color: overdue ? Colors.redAccent : (urgent ? AppColors.goldDeep : AppColors.text2)),
              const SizedBox(width: 6),
              Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: overdue ? Colors.redAccent : AppColors.text)),
              const Spacer(),
              Text('${(pct * 100).round()}%', style: AppText.caption),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 6,
              backgroundColor: AppColors.border,
              valueColor: AlwaysStoppedAnimation(overdue ? Colors.redAccent : (urgent ? AppColors.gold : AppColors.brand)),
            ),
          ),
        ],
      ),
    );
  }

  String _actionLabel(String a) => switch (a) {
        'accept' => '已接受任务',
        'decline' => '已拒绝',
        'submit' => '已提交，等 TA 确认',
        'confirm' => '已确认，星星到账',
        'cancel' => '已取消，星星已退回',
        _ => '操作成功',
      };

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value;
    final myId = session?.user?.id;
    final taskAsync = ref.watch(taskByIdProvider(widget.taskId));

    return GradientScaffold(
      child: taskAsync.when(
        data: (t) {
          if (t == null) {
            return const Center(child: Text('任务不存在或无权查看', style: AppText.label));
          }
          final isAssignee = t.assigneeId == myId;
          final isPublisher = t.publisherId == myId;

          return Column(
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
                        child: Text('任务详情', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
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
                    // 主卡
                    AppCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(color: AppColors.pinkSoft, borderRadius: BorderRadius.circular(999)),
                                child: Text(
                                  t.origin == 'system' ? '系统任务' : '一起做 · TA 发起',
                                  style: const TextStyle(fontSize: 11, color: AppColors.brand),
                                ),
                              ),
                              const Spacer(),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(color: _statusColor(t.status), borderRadius: BorderRadius.circular(999)),
                                child: Text(t.statusLabel, style: TextStyle(fontSize: 11, color: _statusTextColor(t.status))),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(t.title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.text)),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Text(t.origin == 'system' ? '系统派发' : 'TA 发布', style: AppText.label),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(999)),
                                child: Row(
                                  children: [
                                    Text('完成 +${t.reward}', style: const TextStyle(fontSize: 11, color: AppColors.goldDeep, fontWeight: FontWeight.w500)),
                                    const SizedBox(width: 2),
                                    const Text('★', style: TextStyle(fontSize: 10, color: AppColors.gold)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          const Divider(height: 1, color: AppColors.border),
                          const SizedBox(height: 14),
                          // 进度
                          _progressRow(t.status),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),

                    // 托管说明
                    if (t.origin == 'custom')
                      AppCard(
                        color: AppColors.subtle,
                        child: Row(
                          children: [
                            Container(
                              width: 34,
                              height: 34,
                              decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                              child: const Icon(Icons.lock_outline, size: 15, color: AppColors.goldDeep),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${t.reward} 星正在托管中', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text)),
                                  const Text('确认后转给 TA，不会重复扣', style: AppText.caption),
                                ],
                              ),
                            ),
                            Row(
                              children: [
                                Text('+${t.reward}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.goldDeep)),
                                const SizedBox(width: 2),
                                const Text('★', style: TextStyle(fontSize: 11, color: AppColors.gold)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    // 时限进度
                    if (t.deadlineAt != null && t.status != 'confirmed') ...[
                      const SizedBox(height: 12),
                      _deadlineBar(t),
                    ],

                    // 提交内容（对方提交的照片和文案）
                    if (t.status == 'submitted' || t.status == 'confirmed') ...[
                      if (t.submitNote != null || t.submitPhotoUrl != null) ...[
                        const SizedBox(height: 12),
                        AppCard(
                          color: AppColors.subtle,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('TA 的提交', style: AppText.caption),
                              const SizedBox(height: 8),
                              if (t.submitNote != null)
                                Text(t.submitNote!, style: const TextStyle(fontSize: 14, height: 1.6, color: AppColors.text)),
                              if (t.submitPhotoUrl != null) ...[
                                const SizedBox(height: 10),
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(AppRadius.md),
                                  child: Image.network(
                                    t.submitPhotoUrl!,
                                    width: double.infinity,
                                    height: 180,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => const SizedBox(
                                      height: 60,
                                      child: Center(child: Text('照片加载失败', style: AppText.caption)),
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ],

                    const SizedBox(height: 16),
                    Center(
                      child: Text(
                        t.status == 'confirmed' ? '已完成，星星已到账' : '确认后不能撤回，想清楚再点',
                        style: AppText.caption,
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
                  child: _bottomBar(t, isAssignee, isPublisher),
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
      ),
    );
  }

  Widget _bottomBar(Task t, bool isAssignee, bool isPublisher) {
    if (_busy) {
      return const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    }

    // 待接受（执行人）
    if (t.status == 'assigned' && isAssignee) {
      return Row(
        children: [
          Expanded(
            flex: 2,
            child: OutlinedButton(onPressed: () => _confirmDecline(t), child: const Text('拒绝')),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 4,
            child: ElevatedButton(onPressed: () => _act('accept'), child: const Text('接受邀请')),
          ),
        ],
      );
    }

    // 进行中（执行人）
    if (t.status == 'accepted' && isAssignee) {
      return Row(
        children: [
          Expanded(
            flex: 2,
            child: OutlinedButton(onPressed: () => _act('cancel'), child: const Text('放弃')),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 4,
            child: ElevatedButton(onPressed: () => _showSubmitSheet(t), child: const Text('提交完成')),
          ),
        ],
      );
    }

    // 待确认（发布人）
    if (t.status == 'submitted' && isPublisher) {
      return Row(
        children: [
          Expanded(
            flex: 2,
            child: OutlinedButton(onPressed: () => _act('cancel'), child: const Text('再想想')),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 4,
            child: ElevatedButton(
              onPressed: () => _act('confirm'),
              child: Text('确认完成，给 ${t.reward} 星'),
            ),
          ),
        ],
      );
    }

    // 待确认（执行人等待）
    if (t.status == 'submitted' && isAssignee) {
      return const Center(child: Text('已提交，等 TA 确认', style: AppText.label));
    }

    // 已完成
    if (t.status == 'confirmed') {
      return const Center(child: Text('✓ 已完成', style: TextStyle(fontSize: 16, color: AppColors.green, fontWeight: FontWeight.w700)));
    }

    // 已拒绝 / 取消 / 放弃
    return Center(child: Text(t.statusLabel, style: AppText.label));
  }

  Widget _progressRow(String status) {
    final steps = [
      ('发布', ['assigned', 'accepted', 'submitted', 'confirmed'].contains(status)),
      ('接受', ['accepted', 'submitted', 'confirmed'].contains(status)),
      ('提交', ['submitted', 'confirmed'].contains(status)),
      ('完成', status == 'confirmed'),
    ];
    return Row(
      children: [
        for (var i = 0; i < steps.length; i++) ...[
          if (i > 0)
            Expanded(
              child: Container(
                height: 1.5,
                color: steps[i].$2 ? AppColors.brand : AppColors.border,
              ),
            ),
          Column(
            children: [
              Container(
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: steps[i].$2 ? AppColors.brand : AppColors.subtle,
                ),
                child: Center(
                  child: steps[i].$2
                      ? const Icon(Icons.check, size: 12, color: AppColors.onBrand)
                      : Text('${i + 1}', style: const TextStyle(fontSize: 10, color: AppColors.text3)),
                ),
              ),
              const SizedBox(height: 4),
              Text(steps[i].$1, style: TextStyle(fontSize: 10, color: steps[i].$2 ? AppColors.brand : AppColors.text3)),
            ],
          ),
        ],
      ],
    );
  }

  Color _statusColor(String s) => switch (s) {
        'assigned' => AppColors.goldBg,
        'accepted' => AppColors.greenBg,
        'submitted' => AppColors.tint,
        'confirmed' => AppColors.greenBg,
        _ => AppColors.subtle,
      };

  Color _statusTextColor(String s) => switch (s) {
        'assigned' => AppColors.goldDeep,
        'accepted' => AppColors.green,
        'submitted' => AppColors.brand,
        'confirmed' => AppColors.green,
        _ => AppColors.text3,
      };
}
