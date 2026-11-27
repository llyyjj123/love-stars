import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/providers/providers.dart';
import '../../features/auth/login_page.dart';
import '../../features/gifts/gift_page.dart';
import '../../features/gifts/gift_success_page.dart';
import '../../features/gifts/notes_page.dart';
import '../../features/checkin/checkin_page.dart';
import '../../features/home/home_page.dart';
import '../../features/items/fulfill_page.dart';
import '../../features/items/items_page.dart';
import '../../features/items/redeem_success_page.dart';
import '../../features/items/redemption_detail_page.dart';
import '../../features/profile/ledger_page.dart';
import '../../features/profile/profile_page.dart';
import '../../features/profile/settings_page.dart';
import '../../features/shell.dart';
import '../../features/tasks/my_tasks_page.dart';
import '../../features/tasks/publish_task_page.dart';
import '../../features/tasks/task_detail_page.dart';
import '../../features/tasks/tasks_page.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ValueNotifier<bool>(false);
  ref.listen(sessionProvider, (prev, next) {
    final logged = next.hasValue && next.value!.isLoggedIn;
    if (notifier.value != logged) notifier.value = logged;
  });

  return GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, state) {
      final logged = ref.read(sessionProvider).hasValue && ref.read(sessionProvider).value!.isLoggedIn;
      final goingToLogin = state.matchedLocation == '/login';
      if (!logged && !goingToLogin) return '/login';
      if (logged && goingToLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginPage()),

      // 带底部 Tab 的主框架
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child, location: state.uri.path),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const HomePage()),
          GoRoute(path: '/tasks', builder: (_, __) => const TasksPage()),
          GoRoute(path: '/items', builder: (_, __) => const ItemsPage()),
          GoRoute(path: '/me', builder: (_, __) => const ProfilePage()),
        ],
      ),

      // 全屏页（无 Tab）
      GoRoute(path: '/checkin', builder: (_, __) => const CheckinPage()),
      GoRoute(path: '/tasks/new', builder: (_, __) => const PublishTaskPage()),
      GoRoute(
        path: '/tasks/:id',
        builder: (_, state) => TaskDetailPage(taskId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/items/success', builder: (_, __) => const RedeemSuccessPage()),
      GoRoute(
        path: '/items/fulfill/:id',
        builder: (_, state) => FulfillPage(redemptionId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/items/redemption/:id',
        builder: (_, state) => RedemptionDetailPage(redemptionId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/me/ledger', builder: (_, __) => const LedgerPage()),
      GoRoute(path: '/me/gift', builder: (_, __) => const GiftPage()),
      GoRoute(
        path: '/me/gift/success',
        builder: (_, state) => GiftSuccessPage(
          amount: int.tryParse(state.uri.queryParameters['amount'] ?? '') ?? 0,
        ),
      ),
      GoRoute(path: '/me/notes', builder: (_, __) => const NotesPage()),
      GoRoute(path: '/me/tasks', builder: (_, __) => const MyTasksPage()),
      GoRoute(path: '/me/settings', builder: (_, __) => const SettingsPage()),
    ],
  );
});
