import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Derives a tenant brand group (brand / hover / fg / subtle / subtleFg) from a
/// single seed color, for [XfamColors.withBrand].
abstract final class XfamBrand {
  /// White foreground, used when it has enough contrast against [seed].
  static const _white = Color(0xFFFFFFFF);

  /// Slate-900 foreground, used otherwise.
  static const _slate900 = Color(0xFF0F172A);

  /// WCAG AA contrast ratio required for the brand foreground colour.
  static const double minContrast = 4.5;

  static ({
    Color brand,
    Color brandHover,
    Color brandFg,
    Color brandSubtle,
    Color brandSubtleFg,
  })
  fromSeed(Color seed, Brightness brightness) {
    final hsl = HSLColor.fromColor(seed);
    final isDark = brightness == Brightness.dark;

    final brand = isDark
        ? hsl.withLightness(_clamp(hsl.lightness + 0.12)).toColor()
        : seed;
    final brandHover = hsl
        .withLightness(_clamp(hsl.lightness + (isDark ? 0.08 : -0.08)))
        .toColor();
    final brandFg = _contrast(_white, brand) >= minContrast
        ? _white
        : _slate900;
    final brandSubtle = hsl
        .withLightness(_clamp(isDark ? 0.16 : 0.95))
        .withSaturation(_clamp(hsl.saturation * 0.6))
        .toColor();
    final brandSubtleFg = hsl
        .withLightness(_clamp(isDark ? 0.82 : 0.28))
        .toColor();

    return (
      brand: brand,
      brandHover: brandHover,
      brandFg: brandFg,
      brandSubtle: brandSubtle,
      brandSubtleFg: brandSubtleFg,
    );
  }

  static double _clamp(double v) => v.clamp(0.0, 1.0);

  /// WCAG relative-luminance contrast ratio between two colors.
  static double _contrast(Color a, Color b) {
    final la = _relativeLuminance(a);
    final lb = _relativeLuminance(b);
    final lighter = math.max(la, lb);
    final darker = math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  static double _relativeLuminance(Color color) {
    double channel(double v) => v <= 0.03928
        ? v / 12.92
        : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    final r = channel(color.r);
    final g = channel(color.g);
    final b = channel(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
}
