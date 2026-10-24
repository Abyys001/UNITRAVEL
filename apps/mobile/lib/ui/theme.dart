import 'package:flutter/material.dart';
import 'package:kit_ui/kit_ui.dart';

import 'tokens.g.dart';

/// Brand tokens from docs/design/DESIGN.md ("Night flight").
abstract final class Brand {
  static const navy950 = BrandTokens.navy950;
  static const navy900 = BrandTokens.navy900;
  static const navy800 = BrandTokens.navy800;
  static const royal = BrandTokens.royal;
  static const blue = BrandTokens.blue;
  static const cyan = BrandTokens.cyan;
  static const sky = BrandTokens.sky;
  static const orange = BrandTokens.orange;
  static const orange300 = BrandTokens.orange300;
  static const orange700 = BrandTokens.orange700;
  static const cloud = BrandTokens.cloud;
  static const line = BrandTokens.line;
  static const steel = BrandTokens.steel;
  static const success = BrandTokens.success;
  static const danger = BrandTokens.danger;

  /// Secondary text on the navy gradient (>= 7:1 on navy-900).
  static const onDarkMuted = BrandTokens.onDarkMuted;

  // Dark ("night deck") surfaces: navy ink, not neutral grey, so the brand reads in both modes.
  static const ink = BrandTokens.ink;
  static const inkSurface = BrandTokens.inkSurface;
  static const inkRaised = BrandTokens.inkRaised;
  static const inkSunken = BrandTokens.inkSunken;
  static const inkLine = BrandTokens.inkLine;
  static const inkLineStrong = BrandTokens.inkLineStrong;
  static const inkText = BrandTokens.inkText;
  static const inkMuted = BrandTokens.inkMuted;
  static const inkSubtle = BrandTokens.inkSubtle;

  static const radius = BrandTokens.radiusLg;

  /// Bento tiles are rounder than ordinary cards.
  static const tileRadius = BrandTokens.radiusTile;
  static const gradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [navy950, navy800, royal]);

  /// Soft navy card shadow (content surfaces only).
  static const cardShadow = [BoxShadow(color: Color(0x1A061F4C), blurRadius: 18, offset: Offset(0, 6))];
}

/// Orange-700 text is for light surfaces only; on dark use orange-300 (both >= 4.5:1 on their surface).
Color accentText(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? Brand.orange300 : Brand.orange700;

bool isDark(BuildContext context) => Theme.of(context).brightness == Brightness.dark;

ThemeData buildAppTheme(Locale locale, {Brightness brightness = Brightness.light}) {
  final dark = brightness == Brightness.dark;
  final colors = (dark ? _darkColors() : _lightColors());
  final base = buildXfamTheme(brightness: brightness, locale: locale, colors: colors);
  final t = base.textTheme;
  final bg = colors.bg;
  final line = colors.border;
  final onBrand = dark ? Brand.sky : Brand.navy900;
  // Montserrat 800 carries Latin display type; Persian stays on Vazirmatn (DESIGN.md).
  TextStyle? display(TextStyle? s) => s?.copyWith(fontWeight: FontWeight.w800);
  final card = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radius));
  final field = BorderRadius.circular(12);
  return base.copyWith(
    scaffoldBackgroundColor: bg,
    textTheme: t.copyWith(displaySmall: display(t.displaySmall), headlineSmall: display(t.headlineSmall), titleLarge: display(t.titleLarge)),
    appBarTheme: base.appBarTheme.copyWith(
      backgroundColor: bg,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: display(t.titleLarge)?.copyWith(color: colors.fg),
      iconTheme: IconThemeData(color: colors.fg),
    ),
    navigationBarTheme: base.navigationBarTheme.copyWith(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: dark ? Brand.orange.withValues(alpha: 0.30) : Brand.orange.withValues(alpha: 0.28),
      indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Brand.radius)),
      labelTextStyle: WidgetStatePropertyAll(t.labelSmall?.copyWith(color: colors.fg)),
      iconTheme: WidgetStatePropertyAll(IconThemeData(color: colors.fg)),
    ),
    // Orange fill with navy-950 text; white on orange fails contrast.
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.orange,
        foregroundColor: Brand.navy950,
        disabledBackgroundColor: dark ? Brand.inkRaised : Brand.line,
        disabledForegroundColor: dark ? Brand.inkSubtle : Brand.steel,
        minimumSize: const Size(64, 48),
        shape: card,
        textStyle: t.labelLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: onBrand,
        minimumSize: const Size(64, 48),
        shape: card,
        side: BorderSide(color: dark ? Brand.inkLineStrong : Brand.line, width: 1.5),
        textStyle: t.labelLarge?.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: dark ? Brand.sky : Brand.royal, minimumSize: const Size(48, 48)),
    ),
    // Selected segment is a solid navy fill with white text (AA), not a faint tint.
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        backgroundColor: WidgetStateProperty.resolveWith((st) => st.contains(WidgetState.selected) ? (dark ? Brand.navy800 : Brand.navy900) : colors.surface),
        foregroundColor: WidgetStateProperty.resolveWith((st) => st.contains(WidgetState.selected) ? Colors.white : colors.fg),
        side: WidgetStatePropertyAll(BorderSide(color: dark ? Brand.inkLineStrong : Brand.line)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: const Size(48, 48))),
    chipTheme: base.chipTheme.copyWith(
      side: BorderSide(color: line),
      backgroundColor: colors.surface,
      selectedColor: dark ? Brand.navy800 : Brand.navy900,
      secondarySelectedColor: dark ? Brand.navy800 : Brand.navy900,
      checkmarkColor: Colors.white,
      labelStyle: t.labelLarge?.copyWith(color: colors.fg),
      secondaryLabelStyle: t.labelLarge?.copyWith(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    cardTheme: base.cardTheme.copyWith(
      color: colors.surface,
      elevation: 0,
      shadowColor: Brand.navy950,
      shape: card.copyWith(side: BorderSide(color: line)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadiusDirectional.vertical(top: Radius.circular(24))),
    ),
    dividerTheme: DividerThemeData(color: line, space: 1),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: dark ? Brand.inkRaised : Brand.navy950,
      contentTextStyle: t.bodyMedium?.copyWith(color: Colors.white),
    ),
    inputDecorationTheme: base.inputDecorationTheme.copyWith(
      filled: true,
      fillColor: colors.surface,
      border: OutlineInputBorder(borderRadius: field, borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(
        borderRadius: field,
        borderSide: BorderSide(color: dark ? Brand.inkLineStrong : Brand.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: field,
        borderSide: BorderSide(color: dark ? Brand.sky : Brand.royal, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: field,
        borderSide: BorderSide(color: colors.danger),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Brand.orange),
  );
}

XfamColors _lightColors() => XfamColors.light
    .copyWith(
      bg: Brand.cloud,
      surface: Colors.white,
      surfaceRaised: Colors.white,
      surfaceSunken: const Color(0xFFF8FBFE),
      fg: Brand.navy950,
      fgMuted: Brand.steel,
      fgSubtle: const Color(0xFF5B6E8A),
      border: Brand.line,
      borderStrong: const Color(0xFFBCCDE3),
      ring: Brand.royal,
      success: Brand.success,
      successSubtle: const Color(0xFFE2F2EA),
      successSubtleFg: Brand.success,
      successBorder: Brand.success,
      danger: Brand.danger,
      dangerSubtle: const Color(0xFFFBE7E5),
      dangerSubtleFg: Brand.danger,
      dangerBorder: Brand.danger,
      warningSubtle: const Color(0xFFFFF0E0),
      warningSubtleFg: const Color(0xFF9A4600),
      warningBorder: Brand.orange,
      infoSubtle: const Color(0xFFE4F3FD),
      infoSubtleFg: Brand.royal,
      infoBorder: Brand.royal,
      neutralSubtle: const Color(0xFFEAF0F8),
      neutralSubtleFg: Brand.steel,
      neutralBorder: Brand.line,
    )
    .withBrand(brand: Brand.navy900, brandHover: Brand.navy950, brandFg: Colors.white, brandSubtle: const Color(0xFFE4EEFA), brandSubtleFg: Brand.navy900);

/// Night-flight dark: same hues, ink backgrounds. Every text/surface pair is checked >= 4.5:1 in test/theme_test.dart.
XfamColors _darkColors() => XfamColors.dark
    .copyWith(
      bg: Brand.ink,
      surface: Brand.inkSurface,
      surfaceRaised: Brand.inkRaised,
      surfaceSunken: Brand.inkSunken,
      fg: Brand.inkText,
      fgMuted: Brand.inkMuted,
      fgSubtle: Brand.inkSubtle,
      border: Brand.inkLine,
      borderStrong: Brand.inkLineStrong,
      ring: Brand.sky,
      success: const Color(0xFF5BE49B),
      successSubtle: const Color(0xFF0C2E24),
      successSubtleFg: const Color(0xFF8FF0BD),
      successBorder: const Color(0xFF1F7A52),
      danger: const Color(0xFFFF8A80),
      dangerSubtle: const Color(0xFF34141A),
      dangerSubtleFg: const Color(0xFFFFB4AC),
      dangerBorder: const Color(0xFF8F3A3A),
      warningSubtle: const Color(0xFF33200A),
      warningSubtleFg: Brand.orange300,
      warningBorder: const Color(0xFF9A5A12),
      infoSubtle: const Color(0xFF0E2A55),
      infoSubtleFg: Brand.sky,
      infoBorder: const Color(0xFF2B5C9E),
      neutralSubtle: Brand.inkRaised,
      neutralSubtleFg: Brand.inkMuted,
      neutralBorder: Brand.inkLineStrong,
    )
    .withBrand(brand: Brand.sky, brandHover: Colors.white, brandFg: Brand.navy950, brandSubtle: const Color(0xFF0E2A55), brandSubtleFg: Brand.sky);

XfamColors xc(BuildContext context) => Theme.of(context).extension<XfamColors>()!;
