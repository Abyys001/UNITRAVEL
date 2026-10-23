import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Centered empty-state placeholder (no data / no results), with an optional
/// action button.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.description,
    this.iconName = 'inbox',
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? description;
  final String iconName;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(XfamSpace.s8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            XfamIcon(
              iconName,
              size: XfamSize.iconLg * 1.5,
              color: colors.fgSubtle,
            ),
            const SizedBox(height: XfamSpace.s4),
            Text(
              title,
              style: textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            if (description != null) ...[
              const SizedBox(height: XfamSpace.s1),
              Text(
                description!,
                style: textTheme.bodyMedium?.copyWith(color: colors.fgMuted),
                textAlign: TextAlign.center,
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: XfamSpace.s4),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}
