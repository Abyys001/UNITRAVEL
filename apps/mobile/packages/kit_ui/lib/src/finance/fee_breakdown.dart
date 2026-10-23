import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/finance/money_text.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

class FeeLine {
  const FeeLine({
    required this.label,
    required this.amount,
    this.isDiscount = false,
  });

  final String label;
  final Money amount;
  final bool isDiscount;
}

/// Itemized fee list with a total row — sits inside [PaymentSummaryCard] or
/// [ExchangeCalculatorCard], or stands alone.
class FeeBreakdown extends StatelessWidget {
  const FeeBreakdown({
    super.key,
    required this.lines,
    required this.total,
    this.totalLabel = 'Total',
  });

  final List<FeeLine> lines;
  final Money total;
  final String totalLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final line in lines)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: XfamSpace.s1),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  line.label,
                  style: textTheme.bodyMedium?.copyWith(color: colors.fgMuted),
                ),
                MoneyText(
                  line.amount,
                  style: textTheme.bodyMedium,
                  tone: line.isDiscount ? XfamTone.success : null,
                ),
              ],
            ),
          ),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: XfamSpace.s2),
          child: Divider(height: 1),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(totalLabel, style: textTheme.titleSmall),
            MoneyText(total, style: textTheme.titleMedium),
          ],
        ),
      ],
    );
  }
}
