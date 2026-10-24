import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

import 'theme.dart';

/// Night-flight header: brand gradient, cyan/orange route arcs, a dashed flight
/// path ending in a pin, and an orange ribbon curve on the bottom edge.
class RouteArcsHeader extends StatelessWidget {
  const RouteArcsHeader({super.key, required this.child, this.height = 200});
  final Widget child;
  final double height;

  /// Depth of the curved bottom edge; content is kept clear of it.
  static const ribbonDepth = 34.0;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: Stack(
      children: [
        Positioned.fill(child: ExcludeSemantics(child: CustomPaint(painter: _HeaderPainter()))),
        Positioned.fill(child: Padding(padding: const EdgeInsets.fromLTRB(20, 20, 20, 20 + ribbonDepth * 0.6), child: child)),
      ],
    ),
  );
}

class _HeaderPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    const depth = RouteArcsHeader.ribbonDepth;
    final body = Path()
      ..moveTo(0, 0)
      ..lineTo(w, 0)
      ..lineTo(w, h - depth)
      ..quadraticBezierTo(w * 0.5, h + 8, 0, h - depth * 0.45)
      ..close();
    final rect = Offset.zero & size;
    canvas.save();
    canvas.clipPath(body);
    canvas.drawRect(rect, Paint()..shader = Brand.gradient.createShader(rect));
    final faint = Paint()
      ..color = Brand.cyan.withValues(alpha: 0.16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var i = 1; i < 6; i++) {
      canvas.drawCircle(Offset(w * 0.88, h * 0.3), i * 46.0, faint);
    }
    // Decoration stays in the upper-right band, clear of the logo and headline copy.
    final arc = Paint()
      ..color = Brand.cyan.withValues(alpha: 0.7)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(
      Path()
        ..moveTo(w * 0.68, h * 0.5)
        ..quadraticBezierTo(w * 0.84, h * 0.2, w * 0.99, h * 0.34),
      arc,
    );
    canvas.restore();

    // Orange ribbon hugging the edge.
    final ribbon = Path()
      ..moveTo(w, h - depth)
      ..quadraticBezierTo(w * 0.5, h + 8, 0, h - depth * 0.45)
      ..lineTo(0, h - depth * 0.45 + 6)
      ..quadraticBezierTo(w * 0.5, h + 14, w, h - depth + 6)
      ..close();
    canvas.drawPath(ribbon, Paint()..color = Brand.orange);

    // Dashed flight path with an orange pin at its end.
    final start = Offset(w * 0.68, h * 0.5);
    final tip = Offset(w * 0.88, h * 0.42);
    final path = Path()
      ..moveTo(start.dx, start.dy)
      ..quadraticBezierTo(w * 0.78, h * 0.55, tip.dx, tip.dy);
    final dash = Paint()
      ..color = Brand.orange.withValues(alpha: 0.9)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round;
    for (final PathMetric m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 12) {
        canvas.drawPath(m.extractPath(d, (d + 6).clamp(0, m.length)), dash);
      }
    }
    final pin = Paint()..color = Brand.orange;
    canvas.drawPath(
      Path()
        ..moveTo(tip.dx, tip.dy)
        ..lineTo(tip.dx - 6, tip.dy - 11)
        ..lineTo(tip.dx + 6, tip.dy - 11)
        ..close(),
      pin,
    );
    canvas.drawCircle(Offset(tip.dx, tip.dy - 14), 8, pin);
    canvas.drawCircle(Offset(tip.dx, tip.dy - 14), 3, Paint()..color = Brand.navy950);
    canvas.drawCircle(start, 3.5, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
