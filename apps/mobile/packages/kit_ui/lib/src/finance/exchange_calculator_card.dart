import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/amount_field.dart';
import 'package:kit_ui/src/finance/currency_flag_catalog.dart';
import 'package:kit_ui/src/finance/currency_pair_row.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/finance/money_text.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Presentational exchange calculator: currency pair + send amount input +
/// computed receive amount + rate label. Holds no conversion logic — the
/// app owns rates and recomputes [receiveAmount] on [onSendAmountChanged].
class ExchangeCalculatorCard extends StatelessWidget {
  const ExchangeCalculatorCard({
    super.key,
    required this.fromCode,
    required this.toCode,
    required this.catalog,
    required this.onTapFrom,
    required this.onTapTo,
    required this.sendLabel,
    required this.receiveLabel,
    required this.onSendAmountChanged,
    required this.receiveAmount,
    this.sendInitialValue,
    this.onSwap,
    this.rateLabel,
    this.maxDecimals = 2,
  });

  final String fromCode;
  final String toCode;
  final CurrencyFlagCatalog catalog;
  final VoidCallback onTapFrom;
  final VoidCallback onTapTo;
  final VoidCallback? onSwap;
  final String sendLabel;
  final String receiveLabel;
  final ValueChanged<String> onSendAmountChanged;
  final String? sendInitialValue;
  final Money receiveAmount;
  final String? rateLabel;
  final int maxDecimals;

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
            CurrencyPairRow(
              fromCode: fromCode,
              toCode: toCode,
              catalog: catalog,
              onTapFrom: onTapFrom,
              onTapTo: onTapTo,
              onSwap: onSwap,
            ),
            const SizedBox(height: XfamSpace.s3),
            Text(
              sendLabel,
              style: textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
            ),
            AmountField(
              currency: fromCode,
              initialValue: sendInitialValue,
              maxDecimals: maxDecimals,
              onChanged: onSendAmountChanged,
            ),
            const SizedBox(height: XfamSpace.s3),
            Text(
              receiveLabel,
              style: textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
            ),
            const SizedBox(height: XfamSpace.s1),
            MoneyText(receiveAmount, style: textTheme.headlineSmall),
            if (rateLabel != null) ...[
              const SizedBox(height: XfamSpace.s2),
              Text(
                rateLabel!,
                style: textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
