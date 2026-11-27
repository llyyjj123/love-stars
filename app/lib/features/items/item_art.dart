import 'package:flutter/material.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';

/// 物品插画
///
/// 图片随 App 打包（assets/items/），不走网络：
/// 断网也能看，也不占服务器带宽。
class ItemArt extends StatelessWidget {
  final Item item;

  /// 固定边长；为 null 时填满父容器（用于网格卡片）
  final double? size;
  final double radius;

  const ItemArt({super.key, required this.item, this.size, this.radius = AppRadius.md});

  @override
  Widget build(BuildContext context) {
    final path = item.assetPath;
    final box = size == null ? null : SizedBox(width: size, height: size);
    if (path == null) {
      // 没有封面时退回 emoji，避免空白
      final fallback = Container(
        color: AppColors.goldBg,
        child: Center(child: Text(item.emoji ?? '★', style: TextStyle(fontSize: (size ?? 52) * 0.42))),
      );
      return ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: box == null ? fallback : SizedBox(width: size, height: size, child: fallback),
      );
    }
    final image = Image.asset(
      path,
      fit: BoxFit.cover,
      // 图片缺失时不要让整个页面报错
      errorBuilder: (_, __, ___) => Container(
        color: AppColors.goldBg,
        child: Center(child: Text(item.emoji ?? '★', style: TextStyle(fontSize: (size ?? 52) * 0.42))),
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: box == null ? SizedBox.expand(child: image) : SizedBox(width: size, height: size, child: image),
    );
  }
}
