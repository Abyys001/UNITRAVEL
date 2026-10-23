import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Compact "Step N of M" header for a multi-step form flow (KYC, request
/// creation), with a thin progress track — distinct from [RequestProgress],
/// which tracks the request's server-side lifecycle rather than an in-flight
/// local wizard.
class WizardStepper extends StatelessWidget {
  const WizardStepper({
    super.key,
    required this.stepIndex,
    required this.stepCount,
    required this.title,
    this.stepLabelBuilder,
  });

  final int stepIndex;
  final int stepCount;
  final String title;

  /// Defaults to `'Step {n} of {m}'`; override for localization.
  final String Function(int stepIndex, int stepCount)? stepLabelBuilder;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;
    final progress = stepCount == 0 ? 0.0 : (stepIndex + 1) / stepCount;
    final stepLabel =
        stepLabelBuilder?.call(stepIndex, stepCount) ??
        'Step ${stepIndex + 1} of $stepCount';

    return Semantics(
      label: '$stepLabel: $title',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            stepLabel,
            style: textTheme.labelMedium?.copyWith(color: colors.fgSubtle),
          ),
          const SizedBox(height: XfamSpace.s0_5),
          Text(title, style: textTheme.titleLarge),
          const SizedBox(height: XfamSpace.s3),
          ClipRRect(
            borderRadius: BorderRadius.circular(XfamRadius.full),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: XfamSpace.s1,
              backgroundColor: colors.border,
              valueColor: AlwaysStoppedAnimation(colors.brand),
            ),
          ),
        ],
      ),
    );
  }
}
