import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:love_stars/core/network/api_client.dart';
import 'package:love_stars/core/storage/token_store.dart';
import 'package:love_stars/core/theme/app_theme.dart';
import 'package:love_stars/data/models/models.dart';
import 'package:love_stars/data/providers/providers.dart';
import 'package:love_stars/features/auth/login_page.dart';
import 'package:love_stars/features/profile/ledger_page.dart';
import 'package:love_stars/features/tasks/tasks_page.dart';
import 'package:love_stars/features/checkin/checkin_page.dart';
import 'package:love_stars/features/gifts/gift_page.dart';
import 'package:love_stars/features/gifts/notes_page.dart';
import 'package:love_stars/features/tasks/task_detail_page.dart';
import 'package:love_stars/features/items/item_art.dart';
import 'package:love_stars/features/items/items_page.dart';
import 'package:love_stars/widgets/app_card.dart';
import 'package:love_stars/main.dart';

/// 用内存版 ApiClient 替换真实网络：只覆盖这几个页面会用到的接口。
class FakeApi extends ApiClient {
  FakeApi(this._me) : super(baseUrl: 'http://test', tokenStore: _NoopStore());
  final String _me;
  List<Map<String, dynamic>> ledgerPages = [];
  Task? currentSystemTask;
  Map<String, dynamic>? checkinState;
  List<Item> itemList = [];
  int drawCalls = 0;
  int joinCalls = 0;

  @override
  Future<Map<String, dynamic>> me() async => {
        'user': {'id': _me, 'username': 'a', 'displayName': '杰'},
        'partner': {'id': 'user-b', 'username': 'b', 'displayName': '媛'},
      };

  @override
  Future<Wallet> wallet() async => Wallet(balance: 37, escrowed: 3);

  @override
  Future<Map<String, dynamic>> ledger({String? cursor, int limit = 30}) async {
    final page = ledgerPages.isEmpty ? <String, dynamic>{'items': [], 'nextCursor': null} : ledgerPages.removeAt(0);
    return page;
  }

  @override
  Future<Task?> systemTask() async => currentSystemTask;

  @override
  Future<Task?> drawSystemTask({List<String> exclude = const []}) async {
    drawCalls++;
    return Task(id: 'sys-1', origin: 'system', assigneeId: _me, title: '陪 TA 散步十分钟', description: '放下手机走十分钟。', reward: 2, status: 'pending');
  }

  @override
  Future<Task> joinSystemTask(String taskId) async {
    joinCalls++;
    currentSystemTask = Task(id: taskId, origin: 'system', assigneeId: _me, title: '陪 TA 散步十分钟', reward: 2, status: 'assigned');
    return currentSystemTask!;
  }

  List<Task> doneTasks = [];

  @override
  Future<List<Task>> tasks({String scope = 'all'}) async =>
      scope == 'done' ? doneTasks : [];

  @override
  Future<List<Item>> items() async => itemList;

  @override
  Future<List<Redemption>> redemptions({String scope = 'mine'}) async => [];

  @override
  Future<List<Task>> pendingConfirm() async => [];

  Task? taskDetail;
  List<Gift> giftsSent = [];
  List<Gift> giftsReceived = [];
  int giftCalls = 0;

  @override
  Future<Task?> taskById(String taskId) async => taskDetail;

  @override
  Future<List<Gift>> gifts({String scope = 'sent'}) async =>
      scope == 'sent' ? giftsSent : giftsReceived;

  @override
  Future<Map<String, dynamic>> sendGift({required int amount, String? note}) async {
    giftCalls++;
    return {'gift': {'id': 'g1', 'fromId': _me, 'toId': 'user-b', 'amount': amount, 'note': note}};
  }

  @override
  Future<Map<String, dynamic>> checkInState() async => checkinState ?? {'currentStreak': 0, 'lastDateKey': null, 'today': '2026-11-26'};
}

class _NoopStore extends TokenStore {
  @override
  Future<String?> read() async => 'test-token';
  @override
  Future<void> write(String token) async {}
  @override
  Future<void> clear() async {}
}

/// 直接给一个已登录的会话，省掉 bootstrap 网络往返。
/// 详情页要靠 myId 判断「我是执行人还是发布人」，没会话会把角色算反。
class _FakeSession extends SessionNotifier {
  _FakeSession(ApiClient api, TokenStore tokens, Ref ref, Session session)
      : super(api, tokens, ref) {
    state = AsyncValue.data(session);
  }
}

Widget harness(Widget home, ApiClient api, {String me = 'user-a'}) {
  final partnerId = me == 'user-a' ? 'user-b' : 'user-a';
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(api),
      sessionProvider.overrideWith((ref) => _FakeSession(
            api,
            ref.watch(tokenStoreProvider),
            ref,
            Session(
              user: User(id: me, username: me, displayName: me == 'user-a' ? '杰' : '媛'),
              partner: User(
                id: partnerId,
                username: partnerId,
                displayName: partnerId == 'user-b' ? '媛' : '杰',
              ),
            ),
          )),
    ],
    child: MaterialApp(theme: buildTheme(), home: home),
  );
}

void main() {
  testWidgets('签到页：第 7 天奖励固定显示 +5★，不随当天变化', (tester) async {
    final api = FakeApi('user-a')..checkinState = {'currentStreak': 1, 'lastDateKey': null, 'today': '2026-11-26'};
    await tester.pumpWidget(harness(const CheckinPage(), api));
    await tester.pumpAndSettle();
    // 第 1 天也必须显示 +5★（曾经显示 +1★）
    expect(find.text('+5★'), findsOneWidget);
    expect(find.text('+1★'), findsNothing);
  });

  testWidgets('签到页：底部提示按天数变化，不写死"7 天就满"', (tester) async {
    // 底部文案在 ListView 末尾，默认 800x600 视口不会构建到，放大后再测
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')..checkinState = {'currentStreak': 1, 'lastDateKey': null, 'today': '2026-11-26'};
    await tester.pumpWidget(harness(const CheckinPage(), api));
    await tester.pumpAndSettle();
    expect(find.textContaining('今天签完是第 2 天'), findsOneWidget);
    expect(find.text('今天签完，连续 7 天就满啦'), findsNothing);
  });

  testWidgets('物品卡用本地插画，兑换弹层显示描述', (tester) async {
    tester.view.physicalSize = const Size(1200, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')..itemList = [
      Item(
        id: 'hug', name: '一个拥抱', emoji: '🤗', priceStars: 4, status: 'listed',
        description: '给彼此一个认真的拥抱，不敷衍、不赶时间，把今天的小疲惫先放下。',
        coverUrl: 'hug.jpg',
      ),
    ];
    await tester.pumpWidget(harness(const ItemsPage(), api));
    await tester.pumpAndSettle();
    expect(find.byType(ItemArt), findsWidgets);
    expect(find.text('一个拥抱'), findsOneWidget);
    await tester.tap(find.text('一个拥抱'));
    await tester.pumpAndSettle();
    // 弹层是 SingleChildScrollView，描述可能在视口外，用 findsWidgets 或滚动后断言
    final desc = find.textContaining('不敷衍、不赶时间');
    if (desc.evaluate().isEmpty) {
      await tester.drag(find.byType(SingleChildScrollView).last, const Offset(0, -200));
      await tester.pumpAndSettle();
    }
    expect(desc, findsOneWidget, reason: '弹层要显示描述');
  });

  testWidgets('物品网格在手机和宽屏上都不溢出，卡片高度随列宽变化', (tester) async {
    final api = FakeApi('user-a')
      ..itemList = [
        for (var i = 0; i < 6; i++)
          Item(
            id: 'i$i', name: '物品$i', priceStars: 4 + i, status: 'listed',
            description: '描述$i', coverUrl: 'hug.jpg',
          ),
      ];

    // 手机尺寸
    for (final size in [const Size(390, 844), const Size(1554, 1361)]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(harness(const ItemsPage(), api));
      await tester.pumpAndSettle();

      // 没有 overflow 异常
      expect(tester.takeException(), isNull, reason: '尺寸 $size 不能溢出');

      // 卡片高度 = 列宽 + 文字区（86），不是固定的 210
      final cards = tester.widgetList<AppCard>(find.byType(AppCard)).toList();
      expect(cards, isNotEmpty);
      final box = tester.getSize(find.byType(AppCard).at(1));
      final colWidth = (size.width - 32 - 12) / 2;
      expect(box.height, closeTo(colWidth + 86, 2.0),
          reason: '尺寸 $size 下卡片高度应随列宽变化');
    }
  });

  testWidgets('整个 App 能启动，不在 initState 里误用 ref.listen', (tester) async {
    // 这个场景曾经直接崩溃：
    // "ref.listen can only be used within the build method of a ConsumerWidget"
    await tester.pumpWidget(const ProviderScope(child: LoveStarsApp()));
    await tester.pump();
    expect(tester.takeException(), isNull, reason: '启动过程中不能抛断言');
    expect(find.byType(MaterialApp), findsOneWidget);
  });

  testWidgets('登录页不再预填账号密码', (tester) async {
    await tester.pumpWidget(ProviderScope(child: MaterialApp(theme: buildTheme(), home: const LoginPage())));
    await tester.pump();
    expect(find.text('我们的小家'), findsOneWidget);
    expect(find.text('进入我们的小家'), findsOneWidget);
    final editable = tester.widgetList<EditableText>(find.byType(EditableText)).map((e) => e.controller.text).toList();
    expect(editable, everyElement(isEmpty), reason: '正式包不应把 a/a123456 写进输入框');
  });

  testWidgets('账本页渲染服务端分录，正负号与类型标签正确', (tester) async {
    final api = FakeApi('user-a')
      ..ledgerPages = [
        {
          'items': [
            {'id': '3', 'type': 'checkin', 'memo': '签到 2026-11-26', 'delta': 1, 'balanceAfter': 37, 'createdAt': '2026-11-26T00:00:00.000Z'},
            {'id': '2', 'type': 'task_escrow', 'memo': '任务托管', 'delta': -3, 'balanceAfter': 36, 'createdAt': '2026-11-25T10:00:00.000Z'},
            {'id': '1', 'type': 'opening', 'memo': '开户礼', 'delta': 20, 'balanceAfter': 39, 'createdAt': '2026-11-24T00:00:00.000Z'},
          ],
          'nextCursor': null,
        },
      ];
    await tester.pumpWidget(harness(const LedgerPage(), api));
    await tester.pumpAndSettle();
    expect(find.text('37'), findsOneWidget, reason: '余额来自 wallet 接口');
    expect(find.text('托管中 3'), findsOneWidget);
    expect(find.text('每日签到'), findsOneWidget);
    expect(find.text('发布任务 · 托管'), findsOneWidget);
    expect(find.text('开户礼'), findsOneWidget, reason: 'memo 与标签相同时不重复显示');
    expect(find.text('+1'), findsOneWidget);
    expect(find.text('-3'), findsOneWidget);
    expect(find.text('+20'), findsOneWidget);
    expect(find.text('没有更多了'), findsOneWidget, reason: 'nextCursor 为 null 时不显示"加载更多"');
  });

  testWidgets('账本页：空记录显示引导文案，不显示空白', (tester) async {
    final api = FakeApi('user-a')..ledgerPages = [];
    await tester.pumpWidget(harness(const LedgerPage(), api));
    await tester.pumpAndSettle();
    expect(find.textContaining('还没有星星记录'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('账本页：有下一页时显示"加载更多"，点击后追加', (tester) async {
    final api = FakeApi('user-a')
      ..ledgerPages = [
        {
          'items': [{'id': '2', 'type': 'opening', 'memo': null, 'delta': 20, 'balanceAfter': 20, 'createdAt': '2026-11-24T00:00:00.000Z'}],
          'nextCursor': '2',
        },
        {
          'items': [{'id': '1', 'type': 'checkin', 'memo': null, 'delta': 1, 'balanceAfter': 21, 'createdAt': '2026-11-23T00:00:00.000Z'}],
          'nextCursor': null,
        },
      ];
    await tester.pumpWidget(harness(const LedgerPage(), api));
    await tester.pumpAndSettle();
    expect(find.text('开户礼'), findsOneWidget);
    expect(find.text('每日签到'), findsNothing);
    await tester.tap(find.text('加载更多'));
    await tester.pumpAndSettle();
    expect(find.text('每日签到'), findsOneWidget);
    expect(find.text('没有更多了'), findsOneWidget);
  });

  testWidgets('任务页：没有系统任务时显示"抽一个"，点击后显示任务', (tester) async {
    final api = FakeApi('user-a');
    await tester.pumpWidget(harness(const TasksPage(), api));
    await tester.pumpAndSettle();
    expect(find.text('抽一个'), findsOneWidget);
    await tester.tap(find.text('抽一个'));
    await tester.pumpAndSettle();

    // 先弹预览，任务还没进「我在做」
    expect(api.drawCalls, 1);
    expect(find.text('抽到一个小任务'), findsOneWidget);
    expect(find.text('陪 TA 散步十分钟'), findsOneWidget);
    expect(find.text('完成标准'), findsOneWidget);
    expect(find.text('加入我的任务'), findsOneWidget);
    expect(find.text('换一个'), findsOneWidget);
    expect(find.text('算了'), findsOneWidget);

    // 确认加入后卡片才出现
    await tester.tap(find.text('加入我的任务'));
    await tester.pumpAndSettle();
    expect(find.text('陪 TA 散步十分钟'), findsOneWidget);
    expect(find.text('+2★'), findsOneWidget);
    expect(find.text('抽一个'), findsNothing, reason: '已有任务时不能再抽');
  });

  testWidgets('抽卡：点「换一个」不会加入任务', (tester) async {
    tester.view.physicalSize = const Size(1200, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a');
    await tester.pumpWidget(harness(const TasksPage(), api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('抽一个'));
    await tester.pumpAndSettle();
    expect(find.text('抽到一个小任务'), findsOneWidget);

    // 点「换一个」：不应该调用 joinSystemTask
    await tester.tap(find.text('换一个'));
    await tester.pumpAndSettle();

    expect(api.joinCalls, 0, reason: '换一个不能触发加入');
    expect(api.drawCalls, greaterThanOrEqualTo(2), reason: '应该再抽一次');
  });

  testWidgets('任务页：已有系统任务时直接展示，不出现"抽一个"', (tester) async {
    final api = FakeApi('user-a')
      ..currentSystemTask = Task(id: 'sys-9', origin: 'system', assigneeId: 'user-a', title: '为 TA 倒一杯温水', reward: 1, status: 'assigned');
    await tester.pumpWidget(harness(const TasksPage(), api));
    await tester.pumpAndSettle();
    expect(find.text('为 TA 倒一杯温水'), findsOneWidget);
    expect(find.text('抽一个'), findsNothing);
    expect(api.drawCalls, 0);
  });

  // ---------- v1.5.0 新增 ----------

  testWidgets('任务详情：对方提交后，确认方看到提交内容 + 确认按钮', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // 我是 user-a，任务由 user-b 执行并已提交（自定义任务，我是发布人）
    final api = FakeApi('user-a')
      ..taskDetail = Task(
        id: 't1', origin: 'custom', publisherId: 'user-a', assigneeId: 'user-b',
        title: '一起看一部电影', reward: 4, status: 'submitted',
        submittedAt: DateTime(2026, 11, 28, 1, 41),
        submitNote: '看完了，很好看', submitPhotoUrl: 'http://test/x.jpg',
      );
    await tester.pumpWidget(harness(const TaskDetailPage(taskId: 't1'), api));
    await tester.pumpAndSettle();

    expect(find.text('TA 的提交'), findsOneWidget, reason: '执行人是 TA，应显示 TA 的提交');
    expect(find.text('看完了，很好看'), findsOneWidget);
    expect(find.textContaining('确认完成，给 4 星'), findsOneWidget, reason: '确认方必须有确认按钮');
  });

  testWidgets('任务详情：系统任务被对方提交后，也有确认按钮', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // 系统任务没有 publisherId：曾经这里没有按钮，只能等 7 天自动确认
    final api = FakeApi('user-a')
      ..taskDetail = Task(
        id: 't2', origin: 'system', assigneeId: 'user-b',
        title: '陪 TA 散步十分钟', reward: 2, status: 'submitted',
        submittedAt: DateTime(2026, 11, 28, 1, 41),
        submitNote: '走完了',
      );
    await tester.pumpWidget(harness(const TaskDetailPage(taskId: 't2'), api));
    await tester.pumpAndSettle();

    expect(find.textContaining('确认完成，给 2 星'), findsOneWidget, reason: '系统任务的确认方也要能确认');
  });

  testWidgets('任务详情：我自己提交的，标签是「我的提交」', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')
      ..taskDetail = Task(
        id: 't3', origin: 'custom', publisherId: 'user-b', assigneeId: 'user-a',
        title: '一起看一部电影', reward: 4, status: 'submitted',
        submittedAt: DateTime(2026, 11, 28, 1, 41),
        submitNote: 'gg',
      );
    await tester.pumpWidget(harness(const TaskDetailPage(taskId: 't3'), api));
    await tester.pumpAndSettle();

    expect(find.text('我的提交'), findsOneWidget, reason: '执行人是我，不能写死「TA 的提交」');
    expect(find.text('TA 的提交'), findsNothing);
    expect(find.textContaining('确认完成'), findsNothing, reason: '执行人不能自己确认');
    expect(find.text('已提交，等 TA 确认'), findsOneWidget);
  });

  testWidgets('任务详情：已完成显示完成详情，含确认人/时间', (tester) async {
    tester.view.physicalSize = const Size(1200, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')
      ..taskDetail = Task(
        id: 't4', origin: 'custom', publisherId: 'user-b', assigneeId: 'user-a',
        title: '杰宝，等下睡前要给我发晚安', reward: 1, status: 'confirmed',
        acceptedAt: DateTime(2026, 11, 27, 0, 50),
        submittedAt: DateTime(2026, 11, 27, 0, 51),
        submitNote: '111',
        confirmedAt: DateTime(2026, 11, 27, 0, 53),
        confirmedBy: 'user-b',
      );
    await tester.pumpWidget(harness(const TaskDetailPage(taskId: 't4'), api));
    await tester.pumpAndSettle();

    expect(find.text('完成详情'), findsOneWidget, reason: '归档任务要能看到完成详情');
    expect(find.text('TA 确认的'), findsOneWidget);
    expect(find.text('111'), findsOneWidget, reason: '归档也要能看到提交内容');
  });

  testWidgets('归档任务可以点开查看详情', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')
      ..doneTasks = [
        Task(id: 'd1', origin: 'custom', publisherId: 'user-a', assigneeId: 'user-b',
            title: '已经完成的事', reward: 2, status: 'confirmed'),
      ];
    await tester.pumpWidget(harness(const TasksPage(), api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('已完成 1 个'));
    await tester.pumpAndSettle();
    expect(find.text('已经完成的事'), findsOneWidget);

    // 点进去应该触发导航（这里用 InkWell 存在性验证可点）
    final tappable = find.ancestor(of: find.text('已经完成的事'), matching: find.byType(InkWell));
    expect(tappable, findsWidgets, reason: '归档行必须可点击');
  });

  testWidgets('送星星：默认 5 颗，可切预设，带留言提交', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a');
    await tester.pumpWidget(harness(const GiftPage(), api));
    await tester.pumpAndSettle();

    expect(find.text('送 5 颗星'), findsOneWidget);
    await tester.tap(find.text('10 颗'));
    await tester.pumpAndSettle();
    expect(find.text('送 10 颗星'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, '买杯奶茶');
    await tester.tap(find.text('送 10 颗星'));
    await tester.pumpAndSettle();
    expect(api.giftCalls, 1);
  });

  testWidgets('送星星：超过余额时给出提示且不发请求', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a'); // 余额 37
    await tester.pumpWidget(harness(const GiftPage(), api));
    await tester.pumpAndSettle();

    await tester.tap(find.text('自定义'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '999');
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('送 999 颗星'));
    await tester.pumpAndSettle();

    expect(api.giftCalls, 0, reason: '余额不足不能发请求');
    expect(find.textContaining('送不了 999 颗'), findsOneWidget);
  });

  testWidgets('小纸条：收到的留言按时间显示', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')
      ..giftsReceived = [
        Gift(id: 'g1', fromId: 'user-b', toId: 'user-a', amount: 5,
             note: '今天辛苦啦', createdAt: DateTime(2026, 11, 28, 1, 30)),
      ];
    await tester.pumpWidget(harness(const NotesPage(), api));
    await tester.pumpAndSettle();

    expect(find.text('收到 5 颗星'), findsOneWidget);
    expect(find.text('「今天辛苦啦」'), findsOneWidget);
  });

  testWidgets('小纸条：没有留言时显示占位，不显示空引号', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a')
      ..giftsReceived = [
        Gift(id: 'g2', fromId: 'user-b', toId: 'user-a', amount: 2, createdAt: DateTime(2026, 11, 28, 1, 30)),
      ];
    await tester.pumpWidget(harness(const NotesPage(), api));
    await tester.pumpAndSettle();

    expect(find.text('（没有留言）'), findsOneWidget);
    expect(find.text('「」'), findsNothing);
  });

  testWidgets('物品页标题是「我们的小确幸」，不是「我们的小任务」', (tester) async {
    tester.view.physicalSize = const Size(1200, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = FakeApi('user-a');
    await tester.pumpWidget(harness(const ItemsPage(), api));
    await tester.pumpAndSettle();

    expect(find.text('我们的小确幸'), findsOneWidget);
    expect(find.text('我们的小任务'), findsNothing);
  });
}
