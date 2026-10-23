import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Centered error placeholder with a retry action.
class ErrorState extends StatelessWidget {
  const ErrorState({
    super.key,
    required this.title,
    this.description,
    this.retryLabel = 'Retry',
    this.onRetry,
  });

  final String title;
  final String? description;
  final String retryLabel;
  final VoidCallback? onRetry;

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
              'alert-triangle',
              size: XfamSize.iconLg * 1.5,
              color: colors.danger,
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
            if (onRetry != null) ...[
              const SizedBox(height: XfamSpace.s4),
              OutlinedButton(onPressed: onRetry, child: Text(retryLabel)),
            ],
          ],
        ),
      ),
    );
  }
}
