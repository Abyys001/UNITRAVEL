import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Shimmering placeholder box for loading states. Native implementation
/// (evaluated `skeletonizer` 3.0.0, MIT, actively maintained — rejected: it
/// wraps arbitrary widget subtrees via bone-painting, heavier than the two
/// fixed shapes this kit needs; see README.md). Respects
/// `MediaQuery.disableAnimations` by rendering a static box instead of
/// animating the shimmer sweep.
class SkeletonBox extends StatefulWidget {
  const SkeletonBox({
    super.key,
    this.width,
    this.height = XfamSpace.s4,
    this.borderRadius,
  });

  final double? width;
  final double height;
  final BorderRadius? borderRadius;

  @override
  State<SkeletonBox> createState() => _SkeletonBoxState();
}

class _SkeletonBoxState extends State<SkeletonBox>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final radius = widget.borderRadius ?? BorderRadius.circular(XfamRadius.sm);
    final disableAnimations =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    if (disableAnimations) {
      return Semantics(
        label: 'Loading',
        child: Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: colors.neutralSubtle,
            borderRadius: radius,
          ),
        ),
      );
    }

    return Semantics(
      label: 'Loading',
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return ClipRRect(
            borderRadius: radius,
            child: ShaderMask(
              shaderCallback: (bounds) => LinearGradient(
                colors: [
                  colors.neutralSubtle,
                  colors.border,
                  colors.neutralSubtle,
                ],
                stops: const [0.35, 0.5, 0.65],
                begin: Alignment(-1 - _controller.value * 2, 0),
                end: Alignment(1 - _controller.value * 2, 0),
              ).createShader(bounds),
              child: Container(
                width: widget.width,
                height: widget.height,
                color: colors.neutralSubtle,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A vertical stack of [SkeletonBox] rows for list/card loading states.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    this.rowCount = 3,
    this.rowHeight = XfamSize.rowDefault,
    this.spacing = XfamSpace.s3,
  });

  final int rowCount;
  final double rowHeight;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < rowCount; i++) ...[
          if (i > 0) SizedBox(height: spacing),
          SkeletonBox(height: rowHeight),
        ],
      ],
    );
  }
}
