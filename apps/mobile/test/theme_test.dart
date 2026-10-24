import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kit_ui/kit_ui.dart' show XfamColors;
import 'package:unitravel_mobile/ui/theme.dart';

double _lum(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

double contrast(Color a, Color b) {
  final x = _lum(a), y = _lum(b);
  return (math.max(x, y) + 0.05) / (math.min(x, y) + 0.05);
}

void main() {
  for (final brightness in Brightness.values) {
    test('${brightness.name} theme: every text / surface pair passes WCAG AA (4.5:1)', () {
      final theme = buildAppTheme(const Locale('en'), brightness: brightness);
      final c = theme.extension<XfamColors>()!;
      final pairs = <String, (Color, Color)>{
        'fg on bg': (c.fg, c.bg),
        'fg on surface': (c.fg, c.surface),
        'fg on raised': (c.fg, c.surfaceRaised),
        'muted on bg': (c.fgMuted, c.bg),
        'muted on surface': (c.fgMuted, c.surface),
        'muted on raised': (c.fgMuted, c.surfaceRaised),
        'subtle on bg': (c.fgSubtle, c.bg),
        'subtle on surface': (c.fgSubtle, c.surface),
        'danger on surface': (c.danger, c.surface),
        'danger on bg': (c.danger, c.bg),
        'success on surface': (c.success, c.surface),
        'success chip': (c.successSubtleFg, c.successSubtle),
        'danger chip': (c.dangerSubtleFg, c.dangerSubtle),
        'warning chip': (c.warningSubtleFg, c.warningSubtle),
        'info chip': (c.infoSubtleFg, c.infoSubtle),
        'neutral chip': (c.neutralSubtleFg, c.neutralSubtle),
        'brand chip': (c.brandSubtleFg, c.brandSubtle),
        'solid success chip': (c.successFg, c.success),
        'brand on surface': (c.brand, c.surface),
        'accent text on surface': (accentTextFor(brightness), c.surface),
        'filled button': (Brand.navy950, Brand.orange),
        'hero muted text': (Brand.onDarkMuted, Brand.navy800),
        'hero white text': (Colors.white, Brand.navy800),
        'hero sla breach text': (const Color(0xFFFFB4AC), Brand.navy800),
        'hero deadline text': (Brand.orange300, Brand.navy800),
        'hero new text': (Brand.sky, Brand.navy800),
      };
      final failures = <String>[];
      pairs.forEach((name, p) {
        final r = contrast(p.$1, p.$2);
        if (r < 4.5) failures.add('$name ${r.toStringAsFixed(2)}');
      });
      expect(failures, isEmpty);
    });
  }
}

Color accentTextFor(Brightness b) => b == Brightness.dark ? Brand.orange300 : Brand.orange700;
