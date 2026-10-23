import 'package:flutter/material.dart';
import 'package:kit_ui/kit_ui.dart';

/// Brand tokens from docs/design/DESIGN.md ("Cartographer's ledger").
abstract final class Brand {
  static const navy = Color(0xFF0F2238);
  static const deep = Color(0xFF13263F);
  static const copper = Color(0xFFC98D5B);
  static const copperDark = Color(0xFFB07A45);
  static const sand = Color(0xFFF5F1EA);
  static const mist = Color(0xFFE6E1D8);
  static const moss = Color(0xFF3F6B4F);
  static const brick = Color(0xFFA4452C);
  static const slate = Color(0xFF5B6573);
}

ThemeData buildAppTheme(Locale locale) {
  final colors = XfamColors.light
      .copyWith(
        bg: Brand.sand,
        surface: Colors.white,
        surfaceRaised: Colors.white,
        surfaceSunken: const Color(0xFFFBF9F5),
        fg: Brand.navy,
        fgMuted: Brand.slate,
        fgSubtle: const Color(0xFF6B7482),
        border: Brand.mist,
        borderStrong: const Color(0xFFCFC8BA),
        success: Brand.moss,
        successSubtle: const Color(0xFFE3EEE6),
        successSubtleFg: Brand.moss,
        successBorder: Brand.moss,
        danger: Brand.brick,
        dangerSubtle: const Color(0xFFF6E4DE),
        dangerSubtleFg: Brand.brick,
        dangerBorder: Brand.brick,
        warningSubtle: const Color(0xFFF7EBDD),
        warningSubtleFg: const Color(0xFF7A4B1E),
        warningBorder: Brand.copper,
        neutralSubtle: const Color(0xFFEDE8DF),
        neutralSubtleFg: Brand.slate,
        neutralBorder: Brand.mist,
      )
      .withBrand(
        brand: Brand.navy,
        brandHover: Brand.deep,
        brandFg: Colors.white,
        brandSubtle: const Color(0xFFEFE6D8),
        brandSubtleFg: Brand.navy,
      );
  final base = buildXfamTheme(brightness: Brightness.light, locale: locale, colors: colors);
  final latin = locale.languageCode != 'fa';
  final t = base.textTheme;
  // Fraunces carries Latin display type; Persian stays on Vazirmatn (DESIGN.md).
  TextStyle? display(TextStyle? s) => latin ? s?.copyWith(fontFamily: 'Fraunces') : s;
  return base.copyWith(
    textTheme: t.copyWith(
      displaySmall: display(t.displaySmall),
      headlineSmall: display(t.headlineSmall),
      titleLarge: display(t.titleLarge),
    ),
    appBarTheme: base.appBarTheme.copyWith(
      backgroundColor: Brand.sand,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: display(t.titleLarge),
    ),
    navigationBarTheme: base.navigationBarTheme.copyWith(
      indicatorColor: const Color(0xFFEFE6D8),
      labelTextStyle: WidgetStatePropertyAll(t.labelSmall),
    ),
  );
}

XfamColors xc(BuildContext context) => Theme.of(context).extension<XfamColors>()!;
