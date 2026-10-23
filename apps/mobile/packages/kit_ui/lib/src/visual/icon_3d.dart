import 'package:flutter/material.dart';

/// A pre-rendered 3D icon (kit `assets/icons-3d`, e.g. 3dicons or Fluent
/// Emoji) with a small tilt toward the pointer on hover and a press-down
/// scale. No 3D runtime: just an image.
///
/// Decorative by default; pass [semanticLabel] only when the icon is the sole
/// carrier of meaning. Motion is off when [MediaQuery.disableAnimations] is set.
class Icon3D extends StatefulWidget {
  const Icon3D({
    super.key,
    required this.image,
    this.size = 96,
    this.semanticLabel,
    this.tilt = true,
  });

  /// Use the 256 px asset for sizes up to 128 logical px (2x screens).
  final ImageProvider image;
  final double size;
  final String? semanticLabel;
  final bool tilt;

  @override
  State<Icon3D> createState() => _Icon3DState();
}

class _Icon3DState extends State<Icon3D> {
  Offset _pointer = Offset.zero; // -1..1 in both axes
  bool _pressed = false;

  void _onHover(PointerEvent event) {
    final half = widget.size / 2;
    setState(() {
      _pointer = Offset(
        ((event.localPosition.dx - half) / half).clamp(-1.0, 1.0),
        ((event.localPosition.dy - half) / half).clamp(-1.0, 1.0),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final still = MediaQuery.disableAnimationsOf(context) || !widget.tilt;
    final image = Image(
      image: widget.image,
      width: widget.size,
      height: widget.size,
      fit: BoxFit.contain,
      excludeFromSemantics: true,
    );
    final content = still
        ? image
        : MouseRegion(
            onHover: _onHover,
            onExit: (_) => setState(() => _pointer = Offset.zero),
            child: GestureDetector(
              onTapDown: (_) => setState(() => _pressed = true),
              onTapUp: (_) => setState(() => _pressed = false),
              onTapCancel: () => setState(() => _pressed = false),
              child: AnimatedScale(
                scale: _pressed ? 0.94 : 1,
                duration: const Duration(milliseconds: 120),
                child: TweenAnimationBuilder<Offset>(
                  tween: Tween(end: _pointer),
                  duration: const Duration(milliseconds: 180),
                  curve: Curves.easeOut,
                  builder: (context, p, child) => Transform(
                    alignment: Alignment.center,
                    transform: Matrix4.identity()
                      ..setEntry(3, 2, 0.0015)
                      ..rotateX(-p.dy * 0.2)
                      ..rotateY(p.dx * 0.2),
                    child: child,
                  ),
                  child: image,
                ),
              ),
            ),
          );
    return Semantics(
      label: widget.semanticLabel,
      image: widget.semanticLabel != null,
      excludeSemantics: widget.semanticLabel == null,
      child: SizedBox.square(dimension: widget.size, child: content),
    );
  }
}
