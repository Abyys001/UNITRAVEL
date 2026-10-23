import 'package:flutter/material.dart';

import 'theme.dart';

/// Decorative night-chart backdrop: copper route arcs over navy (booklet cover).
class RouteArcsHeader extends StatelessWidget {
  const RouteArcsHeader({super.key, required this.child, this.height = 200});
  final Widget child;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    width: double.infinity,
    color: Brand.navy,
    child: Stack(
      children: [
        Positioned.fill(child: ExcludeSemantics(child: CustomPaint(painter: _ArcsPainter()))),
        Positioned.fill(child: Padding(padding: const EdgeInsets.all(20), child: child)),
      ],
    ),
  );
}

class _ArcsPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final dot = Paint()..color = Brand.copper;
    final line = Paint()
      ..color = Brand.copper.withValues(alpha: 0.55)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final faint = Paint()
      ..color = Colors.white.withValues(alpha: 0.07)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var i = 1; i < 6; i++) {
      canvas.drawCircle(Offset(size.width * 0.85, size.height * 1.1), i * 46.0, faint);
    }
    final pts = [
      Offset(size.width * 0.1, size.height * 0.46),
      Offset(size.width * 0.52, size.height * 0.2),
      Offset(size.width * 0.9, size.height * 0.4),
    ];
    for (var i = 0; i < pts.length - 1; i++) {
      final a = pts[i], b = pts[i + 1];
      final mid = Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2 - 30);
      canvas.drawPath(Path()..moveTo(a.dx, a.dy)..quadraticBezierTo(mid.dx, mid.dy, b.dx, b.dy), line);
    }
    for (final p in pts) {
      canvas.drawCircle(p, 3.5, dot);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
