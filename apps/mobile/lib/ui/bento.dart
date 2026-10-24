import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Reduce-motion switch (OS "remove animations"): every decorative animation in the admin deck checks it.
bool reduceMotion(BuildContext context) => MediaQuery.maybeOf(context)?.disableAnimations ?? false;

/// Haptics are a no-op on platforms without a motor (web, desktop), so callers do not guard.
abstract final class Haptics {
  static void select() => HapticFeedback.selectionClick();
  static void tap() => HapticFeedback.lightImpact();
  static void success() => HapticFeedback.mediumImpact();
  static void warn() => HapticFeedback.heavyImpact();
}

/// One tile of the bento grid. Taps get a 48dp+ target through the caller's content padding.
class BentoTile extends StatelessWidget {
  const BentoTile({super.key, required this.child, this.onTap, this.gradient, this.padding = const EdgeInsets.all(16), this.semanticLabel, this.minHeight = 0});
  final Widget child;
  final VoidCallback? onTap;
  final Gradient? gradient;
  final EdgeInsetsGeometry padding;
  final String? semanticLabel;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    final c = xc(context);
    final radius = BorderRadius.circular(Brand.tileRadius);
    final tile = Material(
      color: gradient == null ? c.surface : Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: gradient == null ? c.border : Colors.transparent),
      ),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: gradient == null ? null : BoxDecoration(gradient: gradient, borderRadius: radius),
        child: InkWell(
          onTap: onTap == null
              ? null
              : () {
                  Haptics.select();
                  onTap!();
                },
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: minHeight),
            child: Padding(padding: padding, child: child),
          ),
        ),
      ),
    );
    if (semanticLabel == null) return tile;
    return Semantics(container: true, label: semanticLabel, button: onTap != null, excludeSemantics: true, onTap: onTap, child: tile);
  }
}

/// Gradient for the hero tile: the Night-flight navy ramp, white text passes AA on every stop.
const heroGradient = LinearGradient(
  begin: AlignmentDirectional.topStart,
  end: AlignmentDirectional.bottomEnd,
  colors: [Brand.navy950, Brand.navy900, Brand.navy800],
);

/// Small trend line over observed samples. Time always runs left to right, also in RTL.
class Sparkline extends StatelessWidget {
  const Sparkline({super.key, required this.values, required this.color, this.height = 28});
  final List<int> values;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final animate = !reduceMotion(context);
    return ExcludeSemantics(
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: SizedBox(
          height: height,
          width: double.infinity,
          child: TweenAnimationBuilder<double>(
            key: ValueKey(values.join(',')),
            tween: Tween(begin: animate ? 0 : 1, end: 1),
            duration: animate ? const Duration(milliseconds: 600) : Duration.zero,
            curve: Curves.easeOutCubic,
            builder: (_, t, _) => CustomPaint(painter: SparklinePainter(values, color, t)),
          ),
        ),
      ),
    );
  }
}

class SparklinePainter extends CustomPainter {
  SparklinePainter(this.values, this.color, this.progress);
  final List<int> values;
  final Color color;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final lo = values.reduce(math.min).toDouble();
    final hi = values.reduce(math.max).toDouble();
    final span = hi == lo ? 1.0 : hi - lo;
    const pad = 3.0;
    Offset at(int i) => Offset(
      pad + (size.width - pad * 2) * i / (values.length - 1),
      // A flat series sits mid-height rather than on the floor.
      hi == lo ? size.height / 2 : size.height - pad - (size.height - pad * 2) * (values[i] - lo) / span,
    );
    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      final a = at(i - 1), b = at(i);
      final mid = (a.dx + b.dx) / 2;
      path.cubicTo(mid, a.dy, mid, b.dy, b.dx, b.dy);
    }
    final metric = path.computeMetrics().first;
    final drawn = metric.extractPath(0, metric.length * progress);
    final tip = metric.getTangentForOffset(metric.length * progress)?.position ?? at(0);
    final area = Path.from(drawn)
      ..lineTo(tip.dx, size.height)
      ..lineTo(pad, size.height)
      ..close();
    canvas.drawPath(
      area,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: 0.28), color.withValues(alpha: 0)],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      drawn,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round,
    );
    if (progress >= 1) canvas.drawCircle(at(values.length - 1), 3, Paint()..color = color);
  }

  @override
  bool shouldRepaint(SparklinePainter old) => old.values != values || old.color != color || old.progress != progress;
}

class HealthSegment {
  const HealthSegment(this.label, this.value, this.color);
  final String label;
  final int value;
  final Color color;
}

/// Segmented bar of how open cases split across statuses. Colour is reinforcement only: the legend carries label and count.
class HealthBar extends StatelessWidget {
  const HealthBar({super.key, required this.segments, this.height = 12});
  final List<HealthSegment> segments;
  final double height;

  @override
  Widget build(BuildContext context) {
    final live = segments.where((s) => s.value > 0).toList();
    final c = xc(context);
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(height),
        child: SizedBox(
          height: height,
          child: live.isEmpty
              ? ColoredBox(color: c.neutralSubtle, child: const SizedBox.expand())
              : Row(
                  children: [
                    for (var i = 0; i < live.length; i++) ...[
                      if (i > 0) SizedBox(width: 2, child: ColoredBox(color: c.surface)),
                      Expanded(
                        flex: live[i].value,
                        child: ColoredBox(color: live[i].color),
                      ),
                    ],
                  ],
                ),
        ),
      ),
    );
  }
}

/// Forward chevron that points the reading direction (right in LTR, left in RTL).
IconData chevronIcon(BuildContext context) => Directionality.of(context) == TextDirection.rtl ? Icons.chevron_left : Icons.chevron_right;
