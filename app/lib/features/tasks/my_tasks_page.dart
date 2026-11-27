import 'package:flutter/material.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../widgets/gradient_scaffold.dart';
import 'tasks_page.dart';

/// 「我的任务」—— 从我的页进入的任务中心（带返回箭头）
class MyTasksPage extends StatelessWidget {
  const MyTasksPage({super.key});

  @override
  Widget build(BuildContext context) {
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
                    child: Text('我的任务', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text)),
                  ),
                ),
                const SizedBox(width: 40),
              ],
            ),
          ),
          const Expanded(child: TasksPage(embedded: true)),
        ],
      ),
    );
  }
}
