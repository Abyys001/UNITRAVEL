import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Shows a tone-colored snack bar using [XfamColors] (theme's
/// [SnackBarThemeData] already covers the neutral case — this adds
/// success/warning/danger backgrounds and a matching icon).
ScaffoldFeatureController<SnackBar, SnackBarClosedReason> showXfamSnackBar(
  BuildContext context, {
  required String message,
  XfamTone tone = XfamTone.neutral,
  String? actionLabel,
  VoidCallback? onAction,
  Duration duration = const Duration(seconds: 4),
}) {
  final colors = Theme.of(context).extension<XfamColors>()!;
  final (Color bg, Color fg, String? icon) = switch (tone) {
    XfamTone.success => (colors.success, colors.successFg, 'circle-check'),
    XfamTone.warning => (colors.warning, colors.warningFg, 'circle-help'),
    XfamTone.danger => (colors.danger, colors.dangerFg, 'circle-x'),
    XfamTone.info => (colors.info, colors.infoFg, 'circle-help'),
    XfamTone.neutral => (colors.fg, colors.surface, null),
  };

  return ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      backgroundColor: bg,
      duration: duration,
      content: Row(
        children: [
          if (icon != null) ...[
            XfamIcon(icon, size: XfamSize.iconSm, color: fg),
            const SizedBox(width: XfamSpace.s2),
          ],
          Expanded(
            child: Text(message, style: TextStyle(color: fg)),
          ),
        ],
      ),
      action: actionLabel == null
          ? null
          : SnackBarAction(
              label: actionLabel,
              textColor: fg,
              onPressed: onAction ?? () {},
            ),
    ),
  );
}
