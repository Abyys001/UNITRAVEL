import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/currency_flag.dart';
import 'package:kit_ui/src/finance/currency_flag_catalog.dart';
import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// From/to currency pair with a swap action, e.g. for an exchange
/// calculator's currency row.
class CurrencyPairRow extends StatelessWidget {
  const CurrencyPairRow({
    super.key,
    required this.fromCode,
    required this.toCode,
    required this.catalog,
    required this.onTapFrom,
    required this.onTapTo,
    this.onSwap,
    this.swapLabel = 'Swap currencies',
  });

  final String fromCode;
  final String toCode;
  final CurrencyFlagCatalog catalog;
  final VoidCallback onTapFrom;
  final VoidCallback onTapTo;
  final VoidCallback? onSwap;
  final String swapLabel;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _CurrencyChip(
            code: fromCode,
            catalog: catalog,
            onTap: onTapFrom,
          ),
        ),
        SizedBox(
          width: XfamSize.touchTarget,
          height: XfamSize.touchTarget,
          child: onSwap == null
              ? null
              : Semantics(
                  button: true,
                  label: swapLabel,
                  child: IconButton(
                    icon: const XfamIcon('arrow-left-right'),
                    onPressed: onSwap,
                  ),
                ),
        ),
        Expanded(
          child: _CurrencyChip(code: toCode, catalog: catalog, onTap: onTapTo),
        ),
      ],
    );
  }
}

class _CurrencyChip extends StatelessWidget {
  const _CurrencyChip({
    required this.code,
    required this.catalog,
    required this.onTap,
  });

  final String code;
  final CurrencyFlagCatalog catalog;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return Material(
      color: colors.surfaceSunken,
      borderRadius: BorderRadius.circular(XfamRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(XfamRadius.sm),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: XfamSpace.s3,
            vertical: XfamSpace.s2,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CurrencyFlag(
                currencyCode: code,
                catalog: catalog,
                size: XfamSize.flagSm,
              ),
              const SizedBox(width: XfamSpace.s2),
              Text(code, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(width: XfamSpace.s1),
              const XfamIcon('chevron-down', size: XfamSize.iconSm),
            ],
          ),
        ),
      ),
    );
  }
}
