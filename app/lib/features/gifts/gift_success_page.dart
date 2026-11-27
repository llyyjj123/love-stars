import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/gradient_scaffold.dart';

/// 送星星成功
class GiftSuccessPage extends ConsumerWidget {
  final int amount;
  const GiftSuccessPage({super.key, this.amount = 0});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    final partnerName = session?.partner?.displayName ?? 'TA';

    return GradientScaffold(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 96,
                height: 96,
                decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                child: const Center(child: Text('★', style: TextStyle(fontSize: 44, color: AppColors.goldDeep))),
              ),
              const SizedBox(height: 24),
              Text('送出 $amount 颗', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.text)),
              const SizedBox(height: 8),
              Text('$partnerName 已经收到你的小心意', style: AppText.label),
              const SizedBox(height: 32),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => context.go('/'),
                  child: const Text('回到首页'),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => context.pushReplacement('/me/notes'),
                  child: const Text('看看小纸条'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
