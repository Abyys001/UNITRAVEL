import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/finance/money_text.dart';
import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/theme/xfam_theme.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Buy/sell exchange rate card with an optional change indicator and
/// updated-at label; switches to a muted "stale" presentation when
/// [isStale] is true (e.g. rate older than the tenant's refresh SLA).
class RateCard extends StatelessWidget {
  const RateCard({
    super.key,
    required this.pairLabel,
    required this.buy,
    required this.sell,
    this.changePercent,
    this.updatedAtLabel,
    this.isStale = false,
    this.staleLabel = 'Rate may be outdated',
    this.buyLabel = 'Buy',
    this.sellLabel = 'Sell',
  });

  final String pairLabel;
  final Money buy;
  final Money sell;

  /// Signed percent change, e.g. `1.2` or `-0.4`; `null` hides the row.
  final double? changePercent;
  final String? updatedAtLabel;
  final bool isStale;
  final String staleLabel;
  final String buyLabel;
  final String sellLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;
    final opacity = isStale ? 0.6 : 1.0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(XfamSpace.s4),
        child: Opacity(
          opacity: opacity,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(pairLabel, style: textTheme.titleMedium),
                  if (changePercent != null)
                    _ChangeBadge(percent: changePercent!, colors: colors),
                ],
              ),
              const SizedBox(height: XfamSpace.s3),
              Row(
                children: [
                  Expanded(
                    child: _RateColumn(label: buyLabel, money: buy),
                  ),
                  Expanded(
                    child: _RateColumn(label: sellLabel, money: sell),
                  ),
                ],
              ),
              if (updatedAtLabel != null || isStale) ...[
                const SizedBox(height: XfamSpace.s2),
                Row(
                  children: [
                    if (isStale) ...[
                      XfamIcon(
                        'clock',
                        size: XfamSize.iconSm,
                        color: colors.warning,
                      ),
                      const SizedBox(width: XfamSpace.s1),
                      Expanded(
                        child: Text(
                          staleLabel,
                          style: textTheme.labelMedium?.copyWith(
                            color: colors.warning,
                          ),
                        ),
                      ),
                    ] else if (updatedAtLabel != null)
                      Text(
                        updatedAtLabel!,
                        style: textTheme.labelMedium?.copyWith(
                          color: colors.fgSubtle,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _RateColumn extends StatelessWidget {
  const _RateColumn({required this.label, required this.money});

  final String label;
  final Money money;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(
            context,
          ).textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
        ),
        const SizedBox(height: XfamSpace.s0_5),
        MoneyText(money, style: Theme.of(context).textTheme.titleLarge),
      ],
    );
  }
}

class _ChangeBadge extends StatelessWidget {
  const _ChangeBadge({required this.percent, required this.colors});

  final double percent;
  final XfamColors colors;

  @override
  Widget build(BuildContext context) {
    final isUp = percent >= 0;
    final color = isUp ? colors.marketUp : colors.marketDown;
    final text = '${isUp ? '+' : ''}${percent.toStringAsFixed(2)}%';
    return Semantics(
      label:
          '${isUp ? 'Up' : 'Down'} ${percent.abs().toStringAsFixed(2)} percent',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: XfamSpace.s2,
          vertical: XfamSpace.s0_5,
        ),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(XfamRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isUp ? Icons.arrow_upward : Icons.arrow_downward,
              size: XfamSize.iconSm,
              color: color,
            ),
            Text(
              text,
              style: Theme.of(
                context,
              ).textTheme.labelMedium?.copyWith(color: color).tabularFigures,
            ),
          ],
        ),
      ),
    );
  }
}
