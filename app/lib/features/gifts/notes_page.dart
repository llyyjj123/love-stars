import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

/// 小纸条 —— 所有送星星时写下的留言，送出和收到的都在这里
class NotesPage extends ConsumerStatefulWidget {
  const NotesPage({super.key});

  @override
  ConsumerState<NotesPage> createState() => _NotesPageState();
}

class _NotesPageState extends ConsumerState<NotesPage> with SingleTickerProviderStateMixin {
  late final TabController _tab = TabController(length: 2, vsync: this);

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sent = ref.watch(giftsSentProvider);
    final received = ref.watch(giftsReceivedProvider);

    return GradientScaffold(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => popOrHome(context),
                  icon: const Icon(Icons.arrow_back),
                  style: IconButton.styleFrom(backgroundColor: AppColors.surface),
                ),
                const Expanded(
                  child: Center(
                    child: Text('小纸条', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                IconButton(
                  onPressed: () => context.push('/me/gift'),
                  icon: const Icon(Icons.favorite_border),
                  style: IconButton.styleFrom(backgroundColor: AppColors.surface),
                ),
              ],
            ),
          ),
          TabBar(
            controller: _tab,
            labelColor: AppColors.brand,
            unselectedLabelColor: AppColors.text3,
            indicatorColor: AppColors.brand,
            tabs: const [Tab(text: '我收到的'), Tab(text: '我送出的')],
          ),
          Expanded(
            child: TabBarView(
              controller: _tab,
              children: [
                _list(received, true),
                _list(sent, false),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _list(AsyncValue<List<Gift>> async, bool incoming) {
    return async.when(
      data: (list) {
        if (list.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('★', style: TextStyle(fontSize: 44, color: AppColors.gold)),
                const SizedBox(height: 14),
                Text(incoming ? '还没有收到小纸条' : '还没有送过小纸条', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.text)),
                const SizedBox(height: 6),
                Text(
                  incoming ? 'TA 送星星时写的留言会出现在这里' : '送星星时写一句话，TA 就会收到',
                  style: AppText.caption,
                ),
                const SizedBox(height: 18),
                ElevatedButton(
                  onPressed: () => context.push('/me/gift'),
                  child: const Text('去送星星'),
                ),
              ],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(giftsSentProvider);
            ref.invalidate(giftsReceivedProvider);
            await ref.read((incoming ? giftsReceivedProvider : giftsSentProvider).future);
          },
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) => _noteCard(list[i], incoming),
          ),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
    );
  }

  Widget _noteCard(Gift g, bool incoming) {
    final hasNote = g.note != null && g.note!.isNotEmpty;
    return AppCard(
      color: incoming ? AppColors.pinkSoft : AppColors.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.favorite, size: 12, color: AppColors.pink),
              const SizedBox(width: 6),
              Text(
                incoming ? '收到 ${g.amount} 颗星' : '送出 ${g.amount} 颗星',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text),
              ),
              const Spacer(),
              Text(_fmt(g.createdAt), style: AppText.caption),
            ],
          ),
          if (hasNote) ...[
            const SizedBox(height: 10),
            Text('「${g.note}」', style: const TextStyle(fontSize: 15, height: 1.6, color: AppColors.text)),
          ] else ...[
            const SizedBox(height: 8),
            const Text('（没有留言）', style: AppText.caption),
          ],
        ],
      ),
    );
  }

  String _fmt(DateTime t) {
    final l = t.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${l.month} 月 ${l.day} 日 ${two(l.hour)}:${two(l.minute)}';
  }
}
