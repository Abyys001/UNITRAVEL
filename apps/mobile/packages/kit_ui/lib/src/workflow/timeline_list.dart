import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

class TimelineEntry {
  const TimelineEntry({
    required this.title,
    this.subtitle,
    this.timestampLabel,
    this.tone = XfamTone.neutral,
    this.iconName = 'circle',
  });

  final String title;
  final String? subtitle;
  final String? timestampLabel;
  final XfamTone tone;
  final String iconName;
}

/// Vertical activity/audit timeline with a connector line and tone-colored
/// markers.
class TimelineList extends StatelessWidget {
  const TimelineList({super.key, required this.entries});

  final List<TimelineEntry> entries;

  Color _toneColor(XfamColors colors, XfamTone tone) => switch (tone) {
    XfamTone.neutral => colors.fgSubtle,
    XfamTone.info => colors.info,
    XfamTone.warning => colors.warning,
    XfamTone.success => colors.success,
    XfamTone.danger => colors.danger,
  };

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < entries.length; i++)
          Semantics(
            label: [
              entries[i].title,
              entries[i].subtitle,
              entries[i].timestampLabel,
            ].whereType<String>().join(', '),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    children: [
                      XfamIcon(
                        entries[i].iconName,
                        size: XfamSize.iconMd,
                        color: _toneColor(colors, entries[i].tone),
                      ),
                      if (i != entries.length - 1)
                        Expanded(
                          child: Container(width: 2, color: colors.border),
                        ),
                    ],
                  ),
                  const SizedBox(width: XfamSpace.s3),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: XfamSpace.s4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  entries[i].title,
                                  style: textTheme.bodyLarge,
                                ),
                              ),
                              if (entries[i].timestampLabel != null)
                                Text(
                                  entries[i].timestampLabel!,
                                  style: textTheme.labelMedium?.copyWith(
                                    color: colors.fgSubtle,
                                  ),
                                ),
                            ],
                          ),
                          if (entries[i].subtitle != null)
                            Padding(
                              padding: const EdgeInsets.only(
                                top: XfamSpace.s0_5,
                              ),
                              child: Text(
                                entries[i].subtitle!,
                                style: textTheme.bodyMedium?.copyWith(
                                  color: colors.fgMuted,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
