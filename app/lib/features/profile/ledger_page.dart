import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

/// 星星账本：直接展示服务端分录，客户端不计算余额。
class LedgerPage extends ConsumerStatefulWidget {
  const LedgerPage({super.key});

  @override
  ConsumerState<LedgerPage> createState() => _LedgerPageState();
}

class _LedgerPageState extends ConsumerState<LedgerPage> {
  final _rows = <Map<String, dynamic>>[];
  String? _cursor;
  bool _loadingMore = false;
  bool _reachedEnd = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_reachedEnd) return;
    setState(() {
      _loadingMore = true;
      _error = null;
    });
    try {
      final page = await ref.read(apiClientProvider).ledger(cursor: _cursor);
      final items = (page['items'] as List<dynamic>).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        _rows.addAll(items);
        _cursor = page['nextCursor'] as String?;
        _reachedEnd = _cursor == null;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMore = false;
        _error = e;
      });
    }
  }

  static const _labels = {
    'opening': '开户礼',
    'checkin': '每日签到',
    'checkin_cycle': '连续签到奖励',
    'task_escrow': '发布任务 · 托管',
    'task_settle': '任务完成',
    'task_reward': '任务完成',
    'task_refund': '任务退回',
    'burn': '兑换物品',
    'adjust': '调整',
  };

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
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
                    child: Text('星星账本', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('当前余额', style: AppText.caption),
                  const SizedBox(height: 4),
                  wallet.when(
                    data: (w) => Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text('${w.balance}', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w900, color: AppColors.text)),
                        const SizedBox(width: 4),
                        const Text('颗', style: AppText.label),
                        const SizedBox(width: 12),
                        if (w.escrowed > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(999)),
                            child: Text('托管中 ${w.escrowed}', style: const TextStyle(fontSize: 11, color: AppColors.goldDeep)),
                          ),
                      ],
                    ),
                    loading: () => const SizedBox(height: 50, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                    error: (e, _) => Text('$e', style: const TextStyle(fontSize: 11, color: Colors.redAccent)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: _rows.isEmpty && _loadingMore
                ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                : _rows.isEmpty && _error != null
                    ? _centered('加载失败：$_error', retry: _load)
                    : _rows.isEmpty
                        ? _centered('还没有星星记录，签个到就能拿到第一颗', retry: _load)
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                            itemCount: _rows.length + 1,
                            itemBuilder: (context, i) {
                              if (i == _rows.length) return _footer();
                              return _row(_rows[i]);
                            },
                          ),
          ),
        ],
      ),
    );
  }

  Widget _centered(String text, {required VoidCallback retry}) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(text, textAlign: TextAlign.center, style: AppText.caption),
          const SizedBox(height: 12),
          TextButton(onPressed: retry, child: const Text('重试')),
        ],
      ),
    );
  }

  Widget _footer() {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: TextButton(onPressed: _load, child: const Text('加载更多失败，点此重试')),
      );
    }
    if (_reachedEnd) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Text('没有更多了', style: AppText.caption),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(child: _loadingMore ? const CircularProgressIndicator(strokeWidth: 2) : TextButton(onPressed: _load, child: const Text('加载更多'))),
    );
  }

  Widget _row(Map<String, dynamic> e) {
    final delta = (e['delta'] as num).toInt();
    final type = e['type']?.toString() ?? '';
    final isCredit = delta > 0;
    final created = DateTime.tryParse(e['createdAt']?.toString() ?? '');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.border, width: 1))),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: isCredit ? AppColors.greenBg : AppColors.goldBg,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Center(child: Text(isCredit ? '★' : '✦', style: TextStyle(fontSize: 16, color: isCredit ? AppColors.green : AppColors.goldDeep))),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_labels[type] ?? type, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.text)),
                if (e['memo'] != null && e['memo'].toString() != (_labels[type] ?? type))
                  Text(e['memo'].toString(), style: AppText.caption),
                if (created != null)
                  Text('${created.month}月${created.day}日 ${created.hour.toString().padLeft(2, '0')}:${created.minute.toString().padLeft(2, '0')}', style: AppText.caption),
              ],
            ),
          ),
          Text(
            '${isCredit ? '+' : ''}$delta',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: isCredit ? AppColors.green : AppColors.text),
          ),
        ],
      ),
    );
  }
}
