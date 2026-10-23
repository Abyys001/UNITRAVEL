import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/theme/xfam_theme.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Renders a [Money] value with tabular figures, isolated as LTR even inside
/// an RTL layout (so `123.45 AED` doesn't visually reorder next to Arabic
/// text) via a nested [Directionality] rather than raw bidi control chars, so
/// screen readers still get a normal text node.
class MoneyText extends StatelessWidget {
  const MoneyText(
    this.money, {
    super.key,
    this.style,
    this.showCurrency = true,
    this.forceLatinDigits = false,
    this.tone,
    this.textAlign,
  });

  final Money money;
  final TextStyle? style;
  final bool showCurrency;
  final bool forceLatinDigits;

  /// Optional semantic tone (e.g. success/danger for a signed delta); resolves
  /// against [XfamColors] rather than being passed a raw [Color].
  final XfamTone? tone;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context);
    final baseStyle =
        (style ?? Theme.of(context).textTheme.bodyLarge)?.tabularFigures;
    final resolvedStyle = tone == null
        ? baseStyle
        : baseStyle?.copyWith(color: _toneColor(context, tone!));
    final text = money.format(
      locale,
      showCurrency: showCurrency,
      forceLatinDigits: forceLatinDigits,
    );

    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(
        text,
        style: resolvedStyle,
        textAlign: textAlign,
        semanticsLabel: text,
      ),
    );
  }

  Color _toneColor(BuildContext context, XfamTone tone) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return switch (tone) {
      XfamTone.success => colors.success,
      XfamTone.danger => colors.danger,
      XfamTone.warning => colors.warning,
      XfamTone.info => colors.info,
      XfamTone.neutral => colors.fg,
    };
  }
}
