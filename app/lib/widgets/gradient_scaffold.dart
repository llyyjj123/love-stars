import 'package:flutter/material.dart';
import '../core/theme/tokens.dart';

/// 带背景渐变的页面骨架
class GradientScaffold extends StatelessWidget {
  final Widget child;
  final Widget? bottomBar;
  final bool safeTop;

  const GradientScaffold({
    super.key,
    required this.child,
    this.bottomBar,
    this.safeTop = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(gradient: kBgGradient),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(top: safeTop, bottom: false, child: child),
        bottomNavigationBar: bottomBar,
      ),
    );
  }
}
