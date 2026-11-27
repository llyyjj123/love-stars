import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// 返回上一页；如果没有上一页（从通知/深链直接打开），回首页。
///
/// 直接用 context.pop() 在栈底会抛 "There is nothing to pop"，
/// 深链进入详情页、或在详情页完成操作后就会踩到。
void popOrHome(BuildContext context) {
  if (context.canPop()) {
    context.pop();
  } else {
    context.go('/');
  }
}
