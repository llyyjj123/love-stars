import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

/// 兑换详情 —— 看兑现照片、留言、时间
class RedemptionDetailPage extends ConsumerWidget {
  final String redemptionId;
  const RedemptionDetailPage({super.key, required this.redemptionId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mine = ref.watch(myRedemptionsProvider);
    final inbox = ref.watch(inboxRedemptionsProvider);
    final myId = ref.watch(sessionProvider).value?.user?.id;

    Redemption? r;
    bool inMine = false;
    bool inInbox = false;
    for (final x in mine.value ?? const <Redemption>[]) {
      if (x.id == redemptionId) {
        r = x;
        inMine = true;
        break;
      }
    }
    if (r == null) {
      for (final x in inbox.value ?? const <Redemption>[]) {
        if (x.id == redemptionId) {
          r = x;
          inInbox = true;
          break;
        }
      }
    }

    // 角色决定文案：我是兑换人 → 「我留的话」/「TA 说」；
    // 我是兑现人 → 「TA 留的话」/「我说」。
    // 之前写死「我留的话」，从「待我兑现」进来时留言归属正好反了。
    final iAmRedeemer = inMine || (!inInbox && myId != null);
    final myNoteLabel = iAmRedeemer ? '我留的话' : 'TA 留的话';
    final theirNoteLabel = iAmRedeemer ? 'TA 说' : '我说';

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
                    child: Text('兑换详情', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          Expanded(
            child: r == null
                ? const Center(child: Text('记录不存在', style: AppText.label))
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    children: [
                      // 物品头
                      AppCard(
                        child: Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration: BoxDecoration(
                                color: AppColors.goldBg,
                                borderRadius: BorderRadius.circular(AppRadius.lg),
                              ),
                              child: Center(child: Text(r.itemEmoji ?? '★', style: const TextStyle(fontSize: 26))),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(r.itemName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.text)),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${r.createdAt.month} 月 ${r.createdAt.day} 日兑换 · ${r.quantity} 件',
                                    style: AppText.caption,
                                  ),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Row(
                                  children: [
                                    Text('${r.totalStars}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                                    const SizedBox(width: 2),
                                    const Text('★', style: TextStyle(fontSize: 13, color: AppColors.gold)),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: r.isPending ? AppColors.tint : AppColors.greenBg,
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(
                                    r.isPending ? '待兑现' : '已兑现',
                                    style: TextStyle(fontSize: 10, color: r.isPending ? AppColors.brand : AppColors.green),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),

                      // 兑现照片
                      if (r.isPending)
                        AppCard(
                          color: AppColors.subtle,
                          child: Column(
                            children: [
                              Container(
                                height: 160,
                                decoration: BoxDecoration(
                                  color: AppColors.pinkSoft,
                                  borderRadius: BorderRadius.circular(AppRadius.md),
                                  border: Border.all(color: AppColors.tint, style: BorderStyle.solid),
                                ),
                                child: Center(
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      const Icon(Icons.photo_camera_outlined, size: 32, color: AppColors.brand),
                                      const SizedBox(height: 8),
                                      Text(
                                        iAmRedeemer ? '等 TA 拍一张照片' : '轮到你拍一张照片',
                                        style: const TextStyle(fontSize: 13, color: AppColors.brand, fontWeight: FontWeight.w500),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        iAmRedeemer ? '兑现后照片会出现在这里' : '去「待我兑现」里拍照兑现',
                                        style: AppText.caption,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        )
                      else if (r.photoUrl != null)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Padding(
                              padding: EdgeInsets.only(left: 4, bottom: 8),
                              child: Row(
                                children: [
                                  Icon(Icons.favorite, size: 11, color: AppColors.pink),
                                  SizedBox(width: 4),
                                  Text('兑现照片', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text)),
                                ],
                              ),
                            ),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(AppRadius.lg),
                              child: Image.network(
                                r.photoUrl!,
                                width: double.infinity,
                                fit: BoxFit.cover,
                                loadingBuilder: (context, child, progress) {
                                  if (progress == null) return child;
                                  return Container(
                                    height: 240,
                                    color: AppColors.subtle,
                                    child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                                  );
                                },
                                errorBuilder: (context, error, stack) => Container(
                                  height: 180,
                                  decoration: BoxDecoration(
                                    color: AppColors.subtle,
                                    borderRadius: BorderRadius.circular(AppRadius.lg),
                                  ),
                                  child: const Center(
                                    child: Column(
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Icon(Icons.broken_image_outlined, size: 28, color: AppColors.text3),
                                        SizedBox(height: 6),
                                        Text('照片加载失败', style: AppText.caption),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            if (r.fulfilledAt != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 8, left: 4),
                                child: Text(
                                  '兑现于 ${r.fulfilledAt!.month} 月 ${r.fulfilledAt!.day} 日 ${r.fulfilledAt!.hour.toString().padLeft(2, '0')}:${r.fulfilledAt!.minute.toString().padLeft(2, '0')}',
                                  style: AppText.caption,
                                ),
                              ),
                          ],
                        ),
                      const SizedBox(height: 14),

                      // 我留的言
                      if (r.note != null && r.note!.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 6),
                          child: Text(myNoteLabel, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text)),
                        ),
                        AppCard(
                          color: AppColors.subtle,
                          child: Text('「${r.note}」', style: const TextStyle(fontSize: 15, color: AppColors.text, height: 1.5)),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // TA 的留言
                      if (r.fulfillNote != null && r.fulfillNote!.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 6),
                          child: Text(theirNoteLabel, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text)),
                        ),
                        AppCard(
                          color: AppColors.pinkSoft,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.favorite, size: 14, color: AppColors.pink),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text('「${r.fulfillNote}」', style: const TextStyle(fontSize: 15, color: AppColors.text, height: 1.5)),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],


                      const SizedBox(height: 16),
                      const Center(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.info_outline, size: 11, color: AppColors.text3),
                            SizedBox(width: 4),
                            Text('兑换后星星已销毁，不能退回', style: AppText.caption),
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
}
