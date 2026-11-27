import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/providers/providers.dart';
import '../../widgets/gradient_scaffold.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(_username.text.trim(), _password.text);
      if (mounted && ref.read(sessionProvider).hasValue && ref.read(sessionProvider).value!.isLoggedIn) {
        context.go('/');
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    session.whenOrNull(error: (e, _) => _error = e.toString());

    return GradientScaffold(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 80),
            Center(
              child: Container(
                width: 88,
                height: 88,
                decoration: const BoxDecoration(color: AppColors.goldBg, shape: BoxShape.circle),
                child: const Center(child: Text('★', style: TextStyle(fontSize: 40, color: AppColors.goldDeep))),
              ),
            ),
            const SizedBox(height: 24),
            const Center(
              child: Text('我们的小家', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: AppColors.text)),
            ),
            const SizedBox(height: 8),
            const Center(
              child: Text('一起攒星星，一起换点小开心', style: AppText.label),
            ),
            const SizedBox(height: 48),
            TextField(
              controller: _username,
              decoration: const InputDecoration(labelText: '账号', prefixIcon: Icon(Icons.person_outline)),
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _password,
              decoration: const InputDecoration(labelText: '密码', prefixIcon: Icon(Icons.lock_outline)),
              obscureText: true,
              onSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
            ],
            const SizedBox(height: 28),
            ElevatedButton(
              onPressed: _loading ? null : _submit,
              child: _loading
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('进入我们的小家'),
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}
