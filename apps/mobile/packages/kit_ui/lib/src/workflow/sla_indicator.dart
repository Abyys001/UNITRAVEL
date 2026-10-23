import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Compact SLA/deadline chip: tone shifts neutral → warning → danger as the
/// deadline approaches or is breached. The kit does no time math — pass the
/// already-formatted [label] (e.g. `'2h 14m left'`) and [tone].
class SlaIndicator extends StatelessWidget {
  const SlaIndicator({
    super.key,
    required this.label,
    this.tone = XfamTone.neutral,
    this.dense = false,
  });

  final String label;
  final XfamTone tone;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final (Color fg, Color bg, String icon) = switch (tone) {
      XfamTone.danger => (
        colors.dangerSubtleFg,
        colors.dangerSubtle,
        'clock-alert',
      ),
      XfamTone.warning => (
        colors.warningSubtleFg,
        colors.warningSubtle,
        'clock-alert',
      ),
      XfamTone.success => (
        colors.successSubtleFg,
        colors.successSubtle,
        'clock',
      ),
      XfamTone.info => (colors.infoSubtleFg, colors.infoSubtle, 'clock'),
      XfamTone.neutral => (
        colors.neutralSubtleFg,
        colors.neutralSubtle,
        'clock',
      ),
    };

    return Semantics(
      label: 'Time remaining: $label',
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: XfamSpace.s2,
          vertical: dense ? XfamSpace.s0_5 : XfamSpace.s1,
        ),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(XfamRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            XfamIcon(icon, size: XfamSize.iconSm, color: fg),
            const SizedBox(width: XfamSpace.s1),
            Text(
              label,
              style:
                  (dense
                          ? Theme.of(context).textTheme.labelSmall
                          : Theme.of(context).textTheme.labelMedium)
                      ?.copyWith(color: fg),
            ),
          ],
        ),
      ),
    );
  }
}
