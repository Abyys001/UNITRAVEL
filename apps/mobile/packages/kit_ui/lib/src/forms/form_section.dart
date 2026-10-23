import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Labelled group of form fields with an optional description and trailing
/// action (e.g. "Edit"), spaced on the 4pt grid.
class FormSection extends StatelessWidget {
  const FormSection({
    super.key,
    required this.title,
    required this.children,
    this.description,
    this.trailing,
    this.spacing = XfamSpace.s3,
  });

  final String title;
  final List<Widget> children;
  final String? description;
  final Widget? trailing;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: Text(title, style: textTheme.titleMedium)),
            ?trailing,
          ],
        ),
        if (description != null) ...[
          const SizedBox(height: XfamSpace.s1),
          Text(
            description!,
            style: textTheme.bodyMedium?.copyWith(color: colors.fgMuted),
          ),
        ],
        const SizedBox(height: XfamSpace.s3),
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) SizedBox(height: spacing),
          children[i],
        ],
      ],
    );
  }
}
