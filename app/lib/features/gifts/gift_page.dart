import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/app_card.dart';
import '../../widgets/gradient_scaffold.dart';

/// 送星星 —— 星星只是从我的账户转到 TA 的账户，不发行、不销毁。
/// 附带一张「小纸条」，会同时进「我的 → 小纸条」列表。
class GiftPage extends ConsumerStatefulWidget {
  const GiftPage({super.key});

  @override
  ConsumerState<GiftPage> createState() => _GiftPageState();
}

class _GiftPageState extends ConsumerState<GiftPage> {
  static const _presets = [1, 5, 10, 20];
  final _note = TextEditingController();
  final _custom = TextEditingController();
  int _amount = 5;
  bool _customMode = false;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    _custom.dispose();
    super.dispose();
  }

  int _currentAmount() {
    if (!_customMode) return _amount;
    final v = int.tryParse(_custom.text.trim()) ?? 0;
    return v;
  }

  Future<void> _send(int balance) async {
    final amount = _currentAmount();
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('先填一个要送的数量')));
      return;
    }
    if (amount > balance) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('你现在只有 $balance 颗，送不了 $amount 颗')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).sendGift(
            amount: amount,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          );
      ref.invalidate(walletProvider);
      ref.invalidate(bothWalletsProvider);
      ref.invalidate(giftsSentProvider);
      ref.invalidate(giftsReceivedProvider);
      if (!mounted) return;
      context.pushReplacement('/me/gift/success?amount=$amount');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
    final session = ref.watch(sessionProvider).value;
    final balance = wallet.value?.balance ?? 0;
    final partnerName = session?.partner?.displayName ?? 'TA';

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
                    child: Text('送 TA 星星', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: [
                Center(
                  child: Column(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                        child: const Center(child: Text('★', style: TextStyle(fontSize: 34, color: AppColors.goldDeep))),
                      ),
                      const SizedBox(height: 12),
                      Text('给 $partnerName 几颗星星', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.text)),
                      const SizedBox(height: 4),
                      const Text('星星只是从你账上转给 TA，不会凭空多出来', style: AppText.caption),
                    ],
                  ),
                ),
                const SizedBox(height: 22),

                // 数量
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final v in _presets)
                      _chip(v, '$v 颗', !_customMode && _amount == v, () {
                        setState(() {
                          _customMode = false;
                          _amount = v;
                        });
                      }),
                    _chip(-1, '自定义', _customMode, () => setState(() => _customMode = true)),
                  ],
                ),
                if (_customMode) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _custom,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(hintText: '输入要送的颗数', suffixText: '颗'),
                  ),
                ],
                const SizedBox(height: 18),

                // 留言
                const Text('附一张小纸条（选填）', style: AppText.caption),
                const SizedBox(height: 6),
                TextField(
                  controller: _note,
                  maxLines: 3,
                  maxLength: 100,
                  decoration: const InputDecoration(hintText: '今天辛苦啦，买杯奶茶吧 ♥'),
                ),
                const SizedBox(height: 8),

                // 结算
                AppCard(
                  color: AppColors.goldBg,
                  child: Row(
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('送出后余额', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
                            Text('转给 TA 后不可撤回', style: AppText.caption),
                          ],
                        ),
                      ),
                      Text('$balance', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text3)),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 4),
                        child: Text('→', style: TextStyle(fontSize: 13, color: AppColors.text3)),
                      ),
                      Text(
                        '${balance - _currentAmount()}',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          color: balance - _currentAmount() >= 0 ? AppColors.goldDeep : Colors.redAccent,
                        ),
                      ),
                      const SizedBox(width: 2),
                      const Text('★', style: TextStyle(fontSize: 12, color: AppColors.gold)),
                    ],
                  ),
                ),
                const SizedBox(height: 18),

                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => popOrHome(context),
                        child: const Text('再想想'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 4,
                      child: ElevatedButton(
                        onPressed: _busy ? null : () => _send(balance),
                        child: _busy
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text('送 ${_currentAmount()} 颗星'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                const Center(
                  child: Text('单日最多送 50 颗', style: AppText.caption),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(int value, String label, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppColors.pinkSoft : AppColors.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: active ? AppColors.brand : AppColors.border),
        ),
        child: Text(
          label,
          style: TextStyle(fontSize: 14, color: active ? AppColors.brand : AppColors.text2, fontWeight: active ? FontWeight.w700 : FontWeight.w400),
        ),
      ),
    );
  }
}
