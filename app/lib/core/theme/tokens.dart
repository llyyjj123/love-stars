import 'package:flutter/material.dart';

/// 设计令牌 —— 与 Figma 的 Color / Radius / Spacing 变量一一对应
class AppColors {
  // 背景渐变
  static const bgTop = Color(0xFFFFF8F7);
  static const bgMid = Color(0xFFFBEFF0);
  static const bgBottom = Color(0xFFFBE8EC);

  // 表面
  static const surface = Color(0xFFFFFDFC);
  static const subtle = Color(0xFFFFF0F2);
  static const sunken = Color(0xFFFBE8EC);

  // 边框
  static const border = Color(0xFFFAE7EB);
  static const borderStrong = Color(0xFFF5D7DD);

  // 文字
  static const text = Color(0xFF35282B);
  static const text2 = Color(0xFF8F7B7F);
  static const text3 = Color(0xFFBCA9AD);

  // 品牌
  static const brand = Color(0xFFB25C66);
  static const brandDeep = Color(0xFF9A4A54);
  static const onBrand = Color(0xFFFFFDFC);
  static const tint = Color(0xFFF9DFE3);
  static const tintSoft = Color(0xFFFBE8EC);

  // 金色
  static const gold = Color(0xFFE9B44C);
  static const goldDeep = Color(0xFFC9922F);
  static const goldBg = Color(0xFFFBF0D8);

  // 绿色
  static const green = Color(0xFF5E8C6A);
  static const greenBg = Color(0xFFE7F0E4);

  // 粉色
  static const pink = Color(0xFFF2A7B8);
  static const pinkSoft = Color(0xFFFDE8EE);
}

class AppRadius {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 18.0;
  static const sheet = 28.0;
  static const full = 999.0;
}

class AppSpacing {
  static const x1 = 4.0;
  static const x2 = 8.0;
  static const x3 = 12.0;
  static const x4 = 16.0;
  static const x5 = 20.0;
  static const x6 = 24.0;
  static const x8 = 32.0;
}

/// 字号 —— 与 Figma 的 7 个文字样式对应
class AppText {
  static const display = TextStyle(fontSize: 44, fontWeight: FontWeight.w900, color: AppColors.text, height: 1.2);
  static const title = TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.text, height: 1.25);
  static const headline = TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text, height: 1.3);
  static const body = TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppColors.text, height: 1.45);
  static const bodyRegular = TextStyle(fontSize: 15, fontWeight: FontWeight.w400, color: AppColors.text, height: 1.45);
  static const label = TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.text2, height: 1.4);
  static const caption = TextStyle(fontSize: 11, fontWeight: FontWeight.w400, color: AppColors.text3, height: 1.4);
}

/// 背景渐变 —— 所有页面共用
const kBgGradient = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [AppColors.bgTop, AppColors.bgMid, AppColors.bgBottom],
  stops: [0.0, 0.55, 1.0],
);
