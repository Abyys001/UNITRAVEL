import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_presets.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Tabular-figure helper for amounts, rates and identifiers.
extension XfamTabularFigures on TextStyle {
  TextStyle get tabularFigures =>
      copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
}

/// Locale scripts the kit ships type ramps for. Anything else falls back to [latin].
enum _Script { latin, fa, ar }

_Script _scriptFor(Locale locale) {
  switch (locale.languageCode) {
    case 'fa':
      return _Script.fa;
    case 'ar':
      return _Script.ar;
    default:
      return _Script.latin;
  }
}

/// Builds a Material 3 [ThemeData] from [XfamColors] tokens, script-aware
/// type ramp (Inter for Latin, Vazirmatn/IBM Plex Sans Arabic for fa/ar) and
/// XFAM component defaults (48dp controls, token radii).
///
/// `colors` defaults to [XfamColors.light]/[XfamColors.dark] by [brightness];
/// pass a tenant-branded copy (`XfamColors.light.withBrand(...)`) to re-skin.
/// A [preset] (see [XfamPresets]) swaps colours, radii, touch-target size and
/// the Latin typeface for a panel type; explicit `colors` still win.
ThemeData buildXfamTheme({
  required Brightness brightness,
  required Locale locale,
  XfamColors? colors,
  XfamPreset? preset,
}) {
  final xfamColors =
      colors ??
      preset?.colorsFor(brightness) ??
      (brightness == Brightness.dark ? XfamColors.dark : XfamColors.light);
  final radiusSm = preset?.radiusSm ?? XfamRadius.sm;
  final radiusMd = preset?.radiusMd ?? XfamRadius.md;
  final radiusLg = preset?.radiusLg ?? XfamRadius.lg;
  final touchTarget = preset?.touchTarget ?? XfamSize.touchTarget;
  final script = _scriptFor(locale);
  final isRtl = script != _Script.latin;

  final colorScheme = ColorScheme(
    brightness: brightness,
    primary: xfamColors.brand,
    onPrimary: xfamColors.brandFg,
    primaryContainer: xfamColors.brandSubtle,
    onPrimaryContainer: xfamColors.brandSubtleFg,
    secondary: xfamColors.neutralSubtleFg,
    onSecondary: xfamColors.fg,
    secondaryContainer: xfamColors.neutralSubtle,
    onSecondaryContainer: xfamColors.neutralSubtleFg,
    error: xfamColors.danger,
    onError: xfamColors.dangerFg,
    errorContainer: xfamColors.dangerSubtle,
    onErrorContainer: xfamColors.dangerSubtleFg,
    surface: xfamColors.surface,
    onSurface: xfamColors.fg,
    surfaceContainerLowest: xfamColors.surfaceSunken,
    surfaceContainerLow: xfamColors.surfaceSunken,
    surfaceContainer: xfamColors.surface,
    surfaceContainerHigh: xfamColors.surfaceRaised,
    surfaceContainerHighest: xfamColors.surfaceRaised,
    onSurfaceVariant: xfamColors.fgMuted,
    outline: xfamColors.border,
    outlineVariant: xfamColors.borderStrong,
    shadow: xfamColors.overlay,
    scrim: xfamColors.overlay,
    inverseSurface: xfamColors.fg,
    onInverseSurface: xfamColors.surface,
    inversePrimary: xfamColors.brandHover,
  );

  final fontFamily = switch (script) {
    _Script.latin => preset?.fontLatin ?? XfamFonts.sansLatin,
    _Script.fa => XfamFonts.sansFa,
    _Script.ar => XfamFonts.sansAr,
  };
  final fontFallback = switch (script) {
    _Script.latin => XfamFontFallback.sansLatin,
    _Script.fa => XfamFontFallback.sansFa,
    _Script.ar => XfamFontFallback.sansAr,
  };
  final lineHeight = isRtl ? XfamLineHeight.rtl : XfamLineHeight.latin;

  TextStyle style(double size, FontWeight weight, {double? height}) =>
      TextStyle(
        fontFamily: fontFamily,
        fontFamilyFallback: fontFallback,
        fontSize: size,
        fontWeight: weight,
        height: height ?? lineHeight,
        color: xfamColors.fg,
      );

  final textTheme = TextTheme(
    displaySmall: style(
      XfamFontSize.display,
      XfamFontWeight.bold,
      height: XfamLineHeight.tight,
    ),
    headlineSmall: style(
      XfamFontSize.titleLg,
      XfamFontWeight.semibold,
      height: XfamLineHeight.tight,
    ),
    titleLarge: style(XfamFontSize.titleLg, XfamFontWeight.semibold),
    titleMedium: style(XfamFontSize.title, XfamFontWeight.semibold),
    titleSmall: style(XfamFontSize.bodyLg, XfamFontWeight.medium),
    bodyLarge: style(XfamFontSize.bodyLg, XfamFontWeight.regular),
    bodyMedium: style(XfamFontSize.body, XfamFontWeight.regular),
    bodySmall: style(XfamFontSize.caption, XfamFontWeight.regular),
    labelLarge: style(XfamFontSize.body, XfamFontWeight.medium),
    labelMedium: style(XfamFontSize.caption, XfamFontWeight.medium),
    labelSmall: style(XfamFontSize.micro, XfamFontWeight.medium),
  );

  final shapeSm = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(radiusSm),
  );
  final shapeMd = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(radiusMd),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: xfamColors.bg,
    fontFamily: fontFamily,
    fontFamilyFallback: fontFallback,
    textTheme: textTheme,
    extensions: [xfamColors],
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 1,
      backgroundColor: xfamColors.surface,
      foregroundColor: xfamColors.fg,
      titleTextStyle: textTheme.titleLarge,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: Size(64, touchTarget),
        shape: shapeMd,
        textStyle: textTheme.labelLarge,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: Size(64, touchTarget),
        shape: shapeMd,
        side: BorderSide(color: xfamColors.border),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: Size(48, touchTarget),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: Size(touchTarget, touchTarget),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: xfamColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: shapeMd.copyWith(side: BorderSide(color: xfamColors.border)),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: xfamColors.surfaceSunken,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusSm),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusSm),
        borderSide: BorderSide(color: xfamColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusSm),
        borderSide: BorderSide(color: xfamColors.ring, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusSm),
        borderSide: BorderSide(color: xfamColors.danger),
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: XfamSpace.s4,
        vertical: XfamSpace.s3,
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: xfamColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(radiusLg),
        ),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: xfamColors.surface,
      shape: shapeMd,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: xfamColors.neutralSubtle,
      labelStyle: textTheme.labelMedium,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(XfamRadius.full),
      ),
      side: BorderSide.none,
      padding: const EdgeInsets.symmetric(
        horizontal: XfamSpace.s3,
        vertical: XfamSpace.s1,
      ),
    ),
    dividerTheme: DividerThemeData(
      color: xfamColors.border,
      space: 1,
      thickness: 1,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: xfamColors.fg,
      contentTextStyle: textTheme.bodyMedium?.copyWith(
        color: xfamColors.surface,
      ),
      behavior: SnackBarBehavior.floating,
      shape: shapeSm,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: xfamColors.surface,
      indicatorColor: xfamColors.brandSubtle,
      height: 64,
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: xfamColors.surface,
      indicatorColor: xfamColors.brandSubtle,
    ),
  );
}
