import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Dismissible-height banner shown when the app detects it's offline. Driven
/// by [isOffline] (bool or `StreamBuilder<bool>` value) — the kit takes no
/// `connectivity_plus` dependency; see README.md for the app-side package.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({
    super.key,
    required this.isOffline,
    this.label = "You're offline",
  });

  final bool isOffline;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return AnimatedSize(
      duration: XfamDuration.base,
      curve: XfamEasing.standard,
      alignment: Alignment.topCenter,
      child: !isOffline
          ? const SizedBox(width: double.infinity)
          : Semantics(
              liveRegion: true,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: XfamSpace.s4,
                  vertical: XfamSpace.s2,
                ),
                color: colors.warningSubtle,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    XfamIcon(
                      'wifi-off',
                      size: XfamSize.iconSm,
                      color: colors.warningSubtleFg,
                    ),
                    const SizedBox(width: XfamSpace.s2),
                    Expanded(
                      child: Text(
                        label,
                        style: Theme.of(context).textTheme.labelMedium
                            ?.copyWith(color: colors.warningSubtleFg),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
