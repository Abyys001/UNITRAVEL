import 'package:flutter/material.dart';

import 'package:kit_ui/src/overlays/xfam_bottom_sheet.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Confirmation bottom sheet; [ConfirmSheet.show] returns `true`/`false`/
/// `null` (dismissed). [isDangerous] swaps the confirm button to the danger
/// tone for destructive actions.
class ConfirmSheet extends StatelessWidget {
  const ConfirmSheet({
    super.key,
    required this.title,
    this.body,
    this.confirmLabel = 'Confirm',
    this.cancelLabel = 'Cancel',
    this.isDangerous = false,
  });

  final String title;
  final String? body;
  final String confirmLabel;
  final String cancelLabel;
  final bool isDangerous;

  static Future<bool?> show(
    BuildContext context, {
    required String title,
    String? body,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    bool isDangerous = false,
  }) {
    return showXfamBottomSheet<bool>(
      context: context,
      builder: (context) => ConfirmSheet(
        title: title,
        body: body,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        isDangerous: isDangerous,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        XfamSpace.s4,
        XfamSpace.s2,
        XfamSpace.s4,
        XfamSpace.s6,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(title, style: textTheme.titleLarge),
          if (body != null) ...[
            const SizedBox(height: XfamSpace.s2),
            Text(
              body!,
              style: textTheme.bodyMedium?.copyWith(color: colors.fgMuted),
            ),
          ],
          const SizedBox(height: XfamSpace.s5),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(cancelLabel),
                ),
              ),
              const SizedBox(width: XfamSpace.s3),
              Expanded(
                child: FilledButton(
                  style: isDangerous
                      ? FilledButton.styleFrom(
                          backgroundColor: colors.danger,
                          foregroundColor: colors.dangerFg,
                        )
                      : null,
                  onPressed: () => Navigator.of(context).pop(true),
                  child: Text(confirmLabel),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
