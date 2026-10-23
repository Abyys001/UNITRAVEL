import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Renders an [XfamStatus] as a tone-colored pill: Lucide icon (from
/// [XfamStatus.icon]) + caller-supplied localized [label] (the kit never
/// hardcodes status copy — only wire values and presentation are fixed).
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.status,
    required this.label,
    this.dense = false,
  });

  final XfamStatus status;
  final String label;
  final bool dense;

  ({Color fg, Color bg}) _colorsFor(XfamColors colors) => switch (status.tone) {
    XfamTone.neutral => (fg: colors.neutralSubtleFg, bg: colors.neutralSubtle),
    XfamTone.info => (fg: colors.infoSubtleFg, bg: colors.infoSubtle),
    XfamTone.warning => (fg: colors.warningSubtleFg, bg: colors.warningSubtle),
    XfamTone.success => (fg: colors.successSubtleFg, bg: colors.successSubtle),
    XfamTone.danger => (fg: colors.dangerSubtleFg, bg: colors.dangerSubtle),
  };

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final tone = _colorsFor(colors);
    final textStyle =
        (dense
                ? Theme.of(context).textTheme.labelSmall
                : Theme.of(context).textTheme.labelMedium)
            ?.copyWith(color: tone.fg, fontWeight: XfamFontWeight.medium);

    return Semantics(
      label: '${status.name} status: $label',
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: XfamSpace.s2,
          vertical: dense ? XfamSpace.s0_5 : XfamSpace.s1,
        ),
        decoration: BoxDecoration(
          color: tone.bg,
          borderRadius: BorderRadius.circular(XfamRadius.full),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            XfamIcon(
              status.icon,
              size: dense ? XfamSize.iconSm : XfamSize.iconMd,
              color: tone.fg,
            ),
            const SizedBox(width: XfamSpace.s1),
            Text(label, style: textStyle),
          ],
        ),
      ),
    );
  }
}
