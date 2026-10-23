import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

enum _StepState { complete, current, error, upcoming }

/// Horizontal phase tracker driven by [XfamPhase]: steps before
/// [currentPhase] render complete, [currentPhase] renders current (or error
/// when [hasError]), later steps render upcoming.
class RequestProgress extends StatelessWidget {
  const RequestProgress({
    super.key,
    required this.currentPhase,
    required this.labels,
    this.phases = XfamPhase.values,
    this.hasError = false,
  });

  final XfamPhase currentPhase;
  final Map<XfamPhase, String> labels;
  final List<XfamPhase> phases;
  final bool hasError;

  _StepState _stateFor(int index) {
    final currentIndex = phases.indexOf(currentPhase);
    if (index < currentIndex) return _StepState.complete;
    if (index == currentIndex) {
      return hasError ? _StepState.error : _StepState.current;
    }
    return _StepState.upcoming;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return Row(
      children: [
        for (var i = 0; i < phases.length; i++) ...[
          Expanded(
            child: _Step(
              label: labels[phases[i]] ?? phases[i].name,
              state: _stateFor(i),
              colors: colors,
            ),
          ),
          if (i != phases.length - 1)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: XfamSpace.s1),
              child: SizedBox(
                width: XfamSpace.s6,
                child: Divider(
                  height: 1,
                  thickness: 2,
                  color: _stateFor(i) == _StepState.complete
                      ? colors.success
                      : colors.border,
                ),
              ),
            ),
        ],
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.label, required this.state, required this.colors});

  final String label;
  final _StepState state;
  final XfamColors colors;

  @override
  Widget build(BuildContext context) {
    final (Color dotColor, Color fgColor, IconData? icon) = switch (state) {
      _StepState.complete => (colors.success, colors.success, Icons.check),
      _StepState.current => (colors.brand, colors.brand, null),
      _StepState.error => (colors.danger, colors.danger, Icons.close),
      _StepState.upcoming => (colors.border, colors.fgSubtle, null),
    };

    return Semantics(
      label: '$label: ${state.name}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: XfamSpace.s6,
            height: XfamSpace.s6,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: state == _StepState.upcoming
                  ? colors.surfaceSunken
                  : dotColor.withValues(alpha: 0.15),
              border: Border.all(color: dotColor, width: 2),
            ),
            child: icon != null
                ? Icon(icon, size: XfamSize.iconSm, color: dotColor)
                : state == _StepState.current
                ? Container(
                    width: XfamSpace.s2,
                    height: XfamSpace.s2,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: dotColor,
                    ),
                  )
                : null,
          ),
          const SizedBox(height: XfamSpace.s1),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: fgColor),
          ),
        ],
      ),
    );
  }
}
