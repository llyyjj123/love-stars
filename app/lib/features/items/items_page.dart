import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';
import 'item_art.dart';

class ItemsPage extends ConsumerStatefulWidget {
  const ItemsPage({super.key});

  @override
  ConsumerState<ItemsPage> createState() => _ItemsPageState();
}

class _ItemsPageState extends ConsumerState<ItemsPage> with SingleTickerProviderStateMixin {
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
    final inbox = ref.watch(inboxRedemptionsProvider);

    return GradientScaffold(
      child: Column(
        children: [
          // 头部
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('我们的小任务', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text)),
                      SizedBox(height: 2),
                      Text('用星星换一点小开心', style: AppText.caption),
                    ],
                  ),
                ),
                OutlinedButton(
                  onPressed: () => _tab.animateTo(2),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(84, 34),
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                  child: const Text('兑换记录 ›'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // 余额
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AppCard(
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
                          const Text('我的星星', style: AppText.caption),
                          const SizedBox(height: 2),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Text('${w.balance}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.text)),
                              const SizedBox(width: 3),
                              const Text('颗', style: AppText.caption),
                            ],
                          ),
                        ],
                      ),
                      loading: () => const SizedBox(height: 44, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                      error: (e, _) => Text('$e', style: const TextStyle(fontSize: 11, color: Colors.redAccent)),
                    ),
                  ),
                  inbox.when(
                    data: (list) => list.isEmpty
                        ? const SizedBox.shrink()
                        : Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(999)),
                            child: Text('待我兑现 ${list.length}', style: const TextStyle(fontSize: 11, color: AppColors.brand, fontWeight: FontWeight.w500)),
                          ),
                    loading: () => const SizedBox.shrink(),
                    error: (_, __) => const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // 三段 Tab
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Container(
              height: 40,
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(color: AppColors.tintSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
              child: TabBar(
                controller: _tab,
                indicator: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(9)),
                indicatorSize: TabBarIndicatorSize.tab,
                dividerColor: Colors.transparent,
                labelColor: AppColors.brand,
                unselectedLabelColor: AppColors.text2,
                labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                unselectedLabelStyle: const TextStyle(fontSize: 13),
                tabs: [
                  const Tab(text: '可兑换'),
                  Tab(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text('待我兑现'),
                        if ((inbox.value?.length ?? 0) > 0) ...[
                          const SizedBox(width: 4),
                          Container(
                            constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            decoration: BoxDecoration(
                              color: AppColors.brand,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Center(
                              child: Text(
                                '${inbox.value!.length}',
                                style: const TextStyle(fontSize: 9, color: AppColors.onBrand, fontWeight: FontWeight.w700),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const Tab(text: '兑换记录'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          Expanded(
            child: TabBarView(
              controller: _tab,
              children: const [
                _RedeemableTab(),
                _InboxTab(),
                _RecordsTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------- 可兑换 ----------
class _RedeemableTab extends ConsumerWidget {
  const _RedeemableTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(itemsProvider);
    final wallet = ref.watch(walletProvider);

    return items.when(
      data: (list) {
        if (list.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('★', style: TextStyle(fontSize: 48, color: AppColors.gold)),
                const SizedBox(height: 16),
                const Text('还没有可兑换的物品', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 6),
                const Text('等 TA 上架一点小心意，就能用星星换啦。', style: AppText.caption),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: () => context.go('/tasks'),
                  style: ElevatedButton.styleFrom(minimumSize: const Size(220, 48)),
                  child: const Text('去完成任务赚星星'),
                ),
              ],
            ),
          );
        }

        final balance = wallet.value?.balance ?? 0;
        return LayoutBuilder(
          builder: (context, constraints) {
            // 卡片高度 = 列宽（方形插画）+ 文字区高度。
            // 固定值或固定宽高比都不行：手机和 Chrome 的列宽差很多，
            // 固定高度会把方形插画压扁，固定宽高比会把卡片撑到上千像素。
            const gap = 12.0;
            final colWidth = (constraints.maxWidth - 32 - gap) / 2;
            const textArea = 86.0;

            return GridView.builder(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: gap,
                crossAxisSpacing: gap,
                mainAxisExtent: colWidth + textArea,
              ),
              itemCount: list.length,
              itemBuilder: (context, i) {
                final it = list[i];
                final affordable = balance >= it.priceStars;
                return Opacity(
                  opacity: affordable ? 1 : 0.4,
                  child: AppCard(
                    padding: const EdgeInsets.all(10),
                    onTap: affordable ? () => _showRedeemSheet(context, ref, it, balance) : null,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 方形插画占满卡片宽度
                        Expanded(
                          child: SizedBox(
                            width: double.infinity,
                            child: ItemArt(item: it, radius: AppRadius.md),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          it.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Text('${it.priceStars}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: affordable ? AppColors.goldDeep : AppColors.text3)),
                            const SizedBox(width: 2),
                            Text('★', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: affordable ? AppColors.gold : AppColors.text3)),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(color: AppColors.tint, borderRadius: BorderRadius.circular(AppRadius.sm)),
                              child: const Text('兑换', style: TextStyle(fontSize: 11, color: AppColors.brand, fontWeight: FontWeight.w500)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
    );
  }

  void _showRedeemSheet(BuildContext context, WidgetRef ref, Item item, int balance) {
    final qty = ValueNotifier<int>(1);
    final note = TextEditingController();
    var submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) {
          final bottomInset = MediaQuery.of(ctx).viewInsets.bottom;
          return Container(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
            ),
            // 弹层内容（插画 + 描述 + 数量 + 留言 + 余额预览）在小屏上会超过一屏，
            // 必须可滚动，否则会溢出。键盘弹出时用 bottomInset 让出空间。
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(ctx).size.height * 0.9 - bottomInset,
            ),
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(20, 14, 20, 28 + bottomInset),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.borderStrong, borderRadius: BorderRadius.circular(2))),
                const SizedBox(height: 18),
                ItemArt(item: item, size: 96, radius: AppRadius.lg),
                const SizedBox(height: 14),
                Text('兑换「${item.name}」？', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 6),
                if (item.description != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Text(
                      item.description!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, height: 1.5, color: AppColors.text2),
                    ),
                  ),
                const SizedBox(height: 14),

                // 物品行
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(AppRadius.md)),
                  child: Row(
                    children: [
                      ItemArt(item: item, size: 48, radius: AppRadius.md),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(item.name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.text)),
                            const Text('可重复兑换 · 不限购', style: AppText.caption),
                          ],
                        ),
                      ),
                      Row(
                        children: [
                          Text('${item.priceStars}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                          const SizedBox(width: 2),
                          const Text('★', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.gold)),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 数量
                Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('数量', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                          Text('不限购，可一次兑多份', style: AppText.caption),
                        ],
                      ),
                    ),
                    Container(
                      height: 36,
                      decoration: BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(AppRadius.sm), border: Border.all(color: AppColors.border)),
                      child: Row(
                        children: [
                          IconButton(
                            icon: const Icon(Icons.remove, size: 16),
                            onPressed: qty.value > 1 ? () => setState(() => qty.value--) : null,
                            constraints: const BoxConstraints(minWidth: 36),
                          ),
                          SizedBox(
                            width: 32,
                            child: Text('${qty.value}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.add, size: 16),
                            onPressed: qty.value < 99 ? () => setState(() => qty.value++) : null,
                            constraints: const BoxConstraints(minWidth: 36),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // 留言
                Align(alignment: Alignment.centerLeft, child: const Text('给 TA 留句话（选填）', style: AppText.caption)),
                const SizedBox(height: 6),
                TextField(
                  controller: note,
                  maxLength: 100,
                  decoration: const InputDecoration(hintText: '想喝三分糖，谢谢宝宝 ♥'),
                ),
                const SizedBox(height: 8),

                // 余额预览
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(AppRadius.md)),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('兑换后余额', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
                            const Text('星星会立即销毁，不能退回', style: AppText.caption),
                          ],
                        ),
                      ),
                      Text('$balance', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text3)),
                      const Padding(padding: EdgeInsets.symmetric(horizontal: 4), child: Text('→', style: TextStyle(fontSize: 13, color: AppColors.text3))),
                      Text('${balance - item.priceStars * qty.value}',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: balance - item.priceStars * qty.value >= 0 ? AppColors.goldDeep : Colors.redAccent,
                          )),
                      const SizedBox(width: 2),
                      const Text('★', style: TextStyle(fontSize: 12, color: AppColors.gold)),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // 积压提示
                Consumer(
                  builder: (ctx2, ref2, _) {
                    final inbox = ref2.watch(inboxRedemptionsProvider).value ?? [];
                    if (inbox.isEmpty) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline, size: 14, color: AppColors.brand),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text('TA 目前有 ${inbox.length} 件待兑现，兑换前可以先看看 TA 的积压。',
                                style: const TextStyle(fontSize: 11, color: AppColors.text2)),
                          ),
                        ],
                      ),
                    );
                  },
                ),

                // 按钮
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('再想想'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 4,
                      child: ElevatedButton(
                        onPressed: submitting
                            ? null
                            : () async {
                                final total = item.priceStars * qty.value;
                                if (total > balance) {
                                  Navigator.pop(ctx);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text('还差 ${total - balance} 颗星，先去完成任务吧')),
                                  );
                                  return;
                                }
                                setState(() => submitting = true);
                                try {
                                  await ref.read(apiClientProvider).redeem(
                                        itemId: item.id,
                                        quantity: qty.value,
                                        note: note.text.trim().isEmpty ? null : note.text.trim(),
                                      );
                                  if (ctx.mounted) Navigator.pop(ctx);
                                  ref.invalidate(walletProvider);
                                  ref.invalidate(bothWalletsProvider);
                                  ref.invalidate(myRedemptionsProvider);
                                  ref.invalidate(inboxRedemptionsProvider);
                                  if (context.mounted) context.push('/items/success');
                                } catch (e) {
                                  setState(() => submitting = false);
                                  if (ctx.mounted) {
                                    ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('$e')));
                                  }
                                }
                              },
                        child: submitting
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text('确认兑换 ${item.priceStars * qty.value} ★'),
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
  }
}

// ---------- 待我兑现 ----------
class _InboxTab extends ConsumerWidget {
  const _InboxTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inbox = ref.watch(inboxRedemptionsProvider);

    return inbox.when(
      data: (list) {
        if (list.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('★', style: TextStyle(fontSize: 48, color: AppColors.gold)),
                const SizedBox(height: 16),
                const Text('还没有等你兑现的事', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 6),
                const Text('TA 用星星换了东西，就会出现在这里。', style: AppText.caption),
              ],
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, i) {
            final r = list[i];
            return AppCard(
              onTap: () => context.push('/items/redemption/${r.id}'),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(AppRadius.md)),
                    child: Center(child: Text(r.itemEmoji ?? '★', style: const TextStyle(fontSize: 24))),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.itemName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppColors.text)),
                        const SizedBox(height: 3),
                        Text('已等待 ${_ago(r.createdAt)}', style: AppText.caption),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Text('${r.totalStars}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.goldDeep)),
                            const Text(' ★ 已销毁 · 不限购', style: AppText.caption),
                          ],
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton(
                    onPressed: () => context.push('/items/fulfill/${r.id}'),
                    style: ElevatedButton.styleFrom(minimumSize: const Size(68, 34), padding: EdgeInsets.zero),
                    child: const Text('去兑现', style: TextStyle(fontSize: 13)),
                  ),
                ],
              ),
            );
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
    );
  }

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inHours < 1) return '${d.inMinutes} 分钟';
    if (d.inDays < 1) return '${d.inHours} 小时';
    return '${d.inDays} 天';
  }
}

// ---------- 兑换记录 ----------
class _RecordsTab extends ConsumerWidget {
  const _RecordsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mine = ref.watch(myRedemptionsProvider);

    return mine.when(
      data: (list) {
        if (list.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('★', style: TextStyle(fontSize: 48, color: AppColors.gold)),
                const SizedBox(height: 16),
                const Text('还没兑换过任何东西', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 6),
                const Text('挑一个喜欢的，用星星换给 TA。', style: AppText.caption),
              ],
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          itemCount: list.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final r = list[i];
            return AppCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              onTap: () => context.push('/items/redemption/${r.id}'),
              child: Row(
                children: [
                  // 已兑现且有照片 → 显示缩略图；否则显示 emoji
                  if (!r.isPending && r.photoUrl != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      child: Image.network(
                        r.photoUrl!,
                        width: 40,
                        height: 40,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(color: AppColors.pinkSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
                          child: Center(child: Text(r.itemEmoji ?? '★', style: const TextStyle(fontSize: 18))),
                        ),
                      ),
                    )
                  else
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: r.isPending ? AppColors.goldBg : AppColors.pinkSoft,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                      child: Center(child: Text(r.itemEmoji ?? '★', style: const TextStyle(fontSize: 18))),
                    ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.itemName, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                        const SizedBox(height: 2),
                        Text(
                          '${r.createdAt.month} 月 ${r.createdAt.day} 日 · ${r.isPending ? "待兑现" : "已兑现"}',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  Text('-${r.totalStars}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
                  const SizedBox(width: 2),
                  const Text('★', style: const TextStyle(fontSize: 11, color: AppColors.gold)),
                  const SizedBox(width: 6),
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
                  if (r.isPending) ...[
                    const SizedBox(width: 6),
                    GestureDetector(
                      onTap: () async {
                        try {
                          await ref.read(apiClientProvider).nudge(r.id);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已经提醒 TA 啦')));
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
                          }
                        }
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.pinkSoft,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.tint),
                        ),
                        child: const Text('催一催', style: TextStyle(fontSize: 10, color: AppColors.brand)),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
    );
  }
}
