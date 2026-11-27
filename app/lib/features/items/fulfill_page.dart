import 'dart:io' show File;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/nav.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../data/providers/providers.dart';
import '../../widgets/gradient_scaffold.dart';

class FulfillPage extends ConsumerStatefulWidget {
  final String redemptionId;
  const FulfillPage({super.key, required this.redemptionId});

  @override
  ConsumerState<FulfillPage> createState() => _FulfillPageState();
}

class _FulfillPageState extends ConsumerState<FulfillPage> {
  final _note = TextEditingController();
  String? _localPath;
  bool _uploading = false;
  bool _submitting = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    // 拍照或相册都可以（Chrome 里没有相机时会自动走文件选择）
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('拍一张'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('从相册选'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: source,
      maxWidth: 1080,
      imageQuality: 80,
    );
    if (picked != null) {
      setState(() => _localPath = picked.path);
    }
  }

  Future<void> _submit(Redemption r) async {
    if (_localPath == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('拍一张兑现照片吧')));
      return;
    }
    setState(() => _submitting = true);
    try {
      setState(() => _uploading = true);
      final url = await ref.read(apiClientProvider).uploadPhoto(_localPath!);
      setState(() => _uploading = false);

      await ref.read(apiClientProvider).fulfill(
            redemptionId: r.id,
            photoUrl: url,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          );

      ref.invalidate(inboxRedemptionsProvider);
      ref.invalidate(myRedemptionsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已兑现，TA 会收到通知')));
        popOrHome(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
        setState(() {
          _uploading = false;
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final inbox = ref.watch(inboxRedemptionsProvider);

    return GradientScaffold(
      child: inbox.when(
        data: (list) {
          final r = list.where((x) => x.id == widget.redemptionId).firstOrNull;
          if (r == null) {
            return const Center(child: Text('这笔兑换已兑现或不存在', style: AppText.label));
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: IconButton(
                  onPressed: () => popOrHome(context),
                  icon: const Icon(Icons.close),
                  style: IconButton.styleFrom(backgroundColor: AppColors.surface),
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: Text('兑现「${r.itemName}」？', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.text)),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text('TA 用了 ${r.totalStars} 颗星兑换，等你兑现', style: AppText.label),
              ),
              const SizedBox(height: 20),

              // 物品行
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: AppColors.subtle, borderRadius: BorderRadius.circular(AppRadius.md)),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(AppRadius.md)),
                      child: Center(child: Text(r.itemEmoji ?? '★', style: const TextStyle(fontSize: 22))),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(r.itemName, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.text)),
                          Text('${r.createdAt.month} 月 ${r.createdAt.day} 日 · 已等待 ${_ago(r.createdAt)}', style: AppText.caption),
                        ],
                      ),
                    ),
                    Row(
                      children: [
                        Text('${r.totalStars}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.goldDeep)),
                        const SizedBox(width: 2),
                        const Text('★', style: TextStyle(fontSize: 13, color: AppColors.gold)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // 照片上传（必填）
              GestureDetector(
                onTap: _pickPhoto,
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.pinkSoft,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(color: AppColors.tint, style: BorderStyle.solid),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          image: _localPath != null
                              ? DecorationImage(image: FileImage(_file(_localPath!)), fit: BoxFit.cover)
                              : null,
                        ),
                        child: _localPath == null
                            ? const Icon(Icons.photo_camera_outlined, size: 20, color: AppColors.brand)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_localPath == null ? '拍一张兑现照片' : '已选择照片，点此重拍',
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
                            const Text('让 TA 看到你的兑现，留个小纪念', style: AppText.caption),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(color: AppColors.goldBg, borderRadius: BorderRadius.circular(999)),
                        child: const Text('必填', style: TextStyle(fontSize: 10, color: AppColors.goldDeep)),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // 留言
              const Text('给 TA 留句话（选填）', style: AppText.caption),
              const SizedBox(height: 6),
              TextField(
                controller: _note,
                maxLength: 100,
                decoration: const InputDecoration(hintText: '三分糖，已经买好啦，等你下楼 ♥'),
              ),
              const SizedBox(height: 8),

              // 提示
              Row(
                children: [
                  const Icon(Icons.favorite, size: 10, color: AppColors.pink),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      '兑换方已经扣星，不能拒绝；点「还没好」会继续留在待我兑现，已兑现不可撤回。',
                      style: AppText.caption,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: OutlinedButton(
                      onPressed: () => popOrHome(context),
                      child: const Text('还没好'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 4,
                    child: ElevatedButton(
                      onPressed: _submitting ? null : () => _submit(r),
                      child: _submitting
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text(_uploading ? '上传中…' : '已兑现'),
                    ),
                  ),
                ],
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('加载失败：$e', style: const TextStyle(color: Colors.redAccent))),
      ),
    );
  }

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inHours < 1) return '${d.inMinutes} 分钟';
    if (d.inDays < 1) return '${d.inHours} 小时';
    return '${d.inDays} 天';
  }
}

File _file(String path) => File(path);
