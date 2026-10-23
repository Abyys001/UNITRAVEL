import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/fee_breakdown.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/finance/money_text.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Summary card for a payment/transfer review step: you-send amount,
/// itemized fees, recipient-gets amount, and optional footer (rate lock
/// countdown, disclaimer).
class PaymentSummaryCard extends StatelessWidget {
  const PaymentSummaryCard({
    super.key,
    required this.youSendLabel,
    required this.youSend,
    required this.fees,
    required this.recipientGetsLabel,
    required this.recipientGets,
    this.footer,
  });

  final String youSendLabel;
  final Money youSend;
  final List<FeeLine> fees;
  final String recipientGetsLabel;
  final Money recipientGets;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(XfamSpace.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  youSendLabel,
                  style: textTheme.bodyMedium?.copyWith(color: colors.fgMuted),
                ),
                MoneyText(youSend, style: textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: XfamSpace.s3),
            FeeBreakdown(
              lines: fees,
              total: recipientGets,
              totalLabel: recipientGetsLabel,
            ),
            if (footer != null) ...[
              const SizedBox(height: XfamSpace.s3),
              DefaultTextStyle.merge(
                style: textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
                child: footer!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
