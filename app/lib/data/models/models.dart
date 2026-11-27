/// 与服务端返回结构一一对应
library;

class User {
  final String id;
  final String username;
  final String displayName;
  const User({required this.id, required this.username, required this.displayName});

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'] as String,
        username: j['username'] as String,
        displayName: j['displayName'] as String,
      );
}

class Wallet {
  final int balance;
  final int escrowed;
  const Wallet({required this.balance, required this.escrowed});

  factory Wallet.fromJson(Map<String, dynamic> j) => Wallet(
        balance: (j['balance'] as num).toInt(),
        escrowed: (j['escrowed'] as num?)?.toInt() ?? 0,
      );
}

class Item {
  final String id;
  final String name;
  final String? emoji;
  final int priceStars;
  final String status;
  final String? description;
  final String? coverUrl;

  const Item({
    required this.id,
    required this.name,
    this.emoji,
    required this.priceStars,
    required this.status,
    this.description,
    this.coverUrl,
  });

  factory Item.fromJson(Map<String, dynamic> j) => Item(
        id: j['id'] as String,
        name: j['name'] as String,
        emoji: j['emoji'] as String?,
        priceStars: (j['priceStars'] as num).toInt(),
        status: j['status'] as String? ?? 'listed',
        description: j['description'] as String?,
        coverUrl: j['coverUrl'] as String?,
      );

  /// 本地图片资源路径。
  ///
  /// 服务端只存文件名（如 hug.jpg），图片随 App 打包，不走网络，
  /// 这样断网也能看到图，也不用担心服务器带宽。
  String? get assetPath => coverUrl == null ? null : 'assets/items/$coverUrl';
}

class Task {
  final String id;
  final String origin;
  final String? publisherId;
  final String assigneeId;
  final String title;
  final String? description;
  final int reward;
  final String status;
  final int? timeLimitHours;
  final DateTime? acceptedAt;
  final DateTime? deadlineAt;
  final DateTime? submittedAt;
  final String? submitPhotoUrl;
  final String? submitNote;
  final DateTime? confirmedAt;
  final String? confirmedBy;
  const Task({
    required this.id,
    required this.origin,
    this.publisherId,
    required this.assigneeId,
    required this.title,
    this.description,
    required this.reward,
    required this.status,
    this.timeLimitHours,
    this.acceptedAt,
    this.deadlineAt,
    this.submittedAt,
    this.submitPhotoUrl,
    this.submitNote,
    this.confirmedAt,
    this.confirmedBy,
  });

  factory Task.fromJson(Map<String, dynamic> j) => Task(
        id: j['id'] as String,
        origin: j['origin'] as String,
        publisherId: j['publisherId'] as String?,
        assigneeId: j['assigneeId'] as String,
        title: j['title'] as String,
        description: j['description'] as String?,
        reward: (j['reward'] as num).toInt(),
        status: j['status'] as String,
        timeLimitHours: (j['timeLimitHours'] as num?)?.toInt(),
        acceptedAt: j['acceptedAt'] == null ? null : DateTime.parse(j['acceptedAt'] as String),
        deadlineAt: j['deadlineAt'] == null ? null : DateTime.parse(j['deadlineAt'] as String),
        submittedAt: j['submittedAt'] == null ? null : DateTime.parse(j['submittedAt'] as String),
        submitPhotoUrl: j['submitPhotoUrl'] as String?,
        submitNote: j['submitNote'] as String?,
        confirmedAt: j['confirmedAt'] == null ? null : DateTime.parse(j['confirmedAt'] as String),
        confirmedBy: j['confirmedBy'] as String?,
      );

  /// 状态中文名
  String get statusLabel => switch (status) {
        'assigned' => '待接受',
        'accepted' => '进行中',
        'submitted' => '待确认',
        'confirmed' => '已完成',
        'rejected' => '被驳回',
        'declined' => '已拒绝',
        'abandoned' => '已放弃',
        'cancelled' => '已取消',
        'expired' => '已过期',
        _ => status,
      };
}

/// 送星星 = 账户之间划转，不发行不销毁
class Gift {
  final String id;
  final String fromId;
  final String toId;
  final int amount;
  final String? note;
  final DateTime createdAt;

  const Gift({
    required this.id,
    required this.fromId,
    required this.toId,
    required this.amount,
    this.note,
    required this.createdAt,
  });

  factory Gift.fromJson(Map<String, dynamic> j) => Gift(
        id: j['id'] as String,
        fromId: j['fromId'] as String,
        toId: j['toId'] as String,
        amount: (j['amount'] as num).toInt(),
        note: j['note'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

class Redemption {
  final String id;
  final String itemName;
  final String? itemEmoji;
  final int priceStars;
  final int quantity;
  final int totalStars;
  final String status;
  final String? note;
  final String? photoUrl;
  final String? fulfillNote;
  final DateTime? fulfilledAt;
  final DateTime createdAt;
  const Redemption({
    required this.id,
    required this.itemName,
    this.itemEmoji,
    required this.priceStars,
    required this.quantity,
    required this.totalStars,
    required this.status,
    this.note,
    this.photoUrl,
    this.fulfillNote,
    this.fulfilledAt,
    required this.createdAt,
  });

  factory Redemption.fromJson(Map<String, dynamic> j) => Redemption(
        id: j['id'] as String,
        itemName: j['itemName'] as String,
        itemEmoji: j['itemEmoji'] as String?,
        priceStars: (j['priceStars'] as num).toInt(),
        quantity: (j['quantity'] as num).toInt(),
        totalStars: (j['totalStars'] as num).toInt(),
        status: j['status'] as String,
        note: j['note'] as String?,
        photoUrl: j['photoUrl'] as String?,
        fulfillNote: j['fulfillNote'] as String?,
        fulfilledAt: j['fulfilledAt'] == null ? null : DateTime.parse(j['fulfilledAt'] as String),
        createdAt: DateTime.parse(j['createdAt'] as String),
      );

  bool get isPending => status == 'pending';
}
