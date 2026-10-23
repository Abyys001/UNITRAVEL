import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Hero illustration slot for pre-rendered 3D art (kit `assets/3d/renders`):
/// the image floats gently up and down. Pre-rendered images replace a 3D
/// runtime on mobile — cheaper and smoother on low-end Android.
///
/// Static when [MediaQuery.disableAnimations] is set or [float] is false.
class HeroArtwork extends StatefulWidget {
  const HeroArtwork({
    super.key,
    required this.image,
    this.semanticLabel,
    this.float = true,
    this.amplitude = 6,
    this.period = const Duration(seconds: 4),
    this.fit = BoxFit.contain,
  });

  final ImageProvider image;
  final String? semanticLabel;
  final bool float;

  /// Vertical travel in logical px.
  final double amplitude;
  final Duration period;
  final BoxFit fit;

  @override
  State<HeroArtwork> createState() => _HeroArtworkState();
}

class _HeroArtworkState extends State<HeroArtwork> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: widget.period);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(HeroArtwork oldWidget) {
    super.didUpdateWidget(oldWidget);
    _controller.duration = widget.period;
    _sync();
  }

  void _sync() {
    final animate = widget.float && !MediaQuery.disableAnimationsOf(context);
    if (animate && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!animate && _controller.isAnimating) {
      _controller
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = Image(image: widget.image, fit: widget.fit, excludeFromSemantics: true);
    return Semantics(
      label: widget.semanticLabel,
      image: widget.semanticLabel != null,
      excludeSemantics: widget.semanticLabel == null,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => Transform.translate(
          offset: Offset(0, math.sin(_controller.value * 2 * math.pi) * widget.amplitude),
          child: child,
        ),
        child: image,
      ),
    );
  }
}
