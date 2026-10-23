import 'package:flutter/material.dart';

/// Plays a pre-rendered frame sequence (kit `assets/3d/renders/sequences`,
/// e.g. a 24-frame product turntable) — the mobile stand-in for a live 3D
/// viewer. Frames are precached before playback starts.
///
/// Shows [stillFrame] when [MediaQuery.disableAnimations] is set. Playback
/// runs on a ticker, so it pauses automatically when the route is hidden
/// ([TickerMode]).
class AnimatedIllustration extends StatefulWidget {
  const AnimatedIllustration({
    super.key,
    required this.frames,
    this.fps = 12,
    this.loop = true,
    this.stillFrame = 0,
    this.semanticLabel,
    this.width,
    this.height,
    this.fit = BoxFit.contain,
  }) : assert(frames.length > 0, 'frames must not be empty');

  final List<ImageProvider> frames;
  final double fps;
  final bool loop;

  /// Frame index shown under reduced motion and before precaching finishes.
  final int stillFrame;
  final String? semanticLabel;
  final double? width;
  final double? height;
  final BoxFit fit;

  @override
  State<AnimatedIllustration> createState() => _AnimatedIllustrationState();
}

class _AnimatedIllustrationState extends State<AnimatedIllustration> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this);
  bool _ready = false;

  Duration get _cycle => Duration(microseconds: (widget.frames.length / widget.fps * 1e6).round());

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_ready) _precache();
    _sync();
  }

  @override
  void didUpdateWidget(AnimatedIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.frames != widget.frames) {
      _ready = false;
      _precache();
    }
    _sync();
  }

  Future<void> _precache() async {
    // A frame that fails to decode must not block playback; Image shows its own error state.
    await Future.wait(widget.frames.map((f) => precacheImage(f, context, onError: (_, _) {})));
    if (!mounted) return;
    setState(() => _ready = true);
    _sync();
  }

  void _sync() {
    final animate = _ready && widget.frames.length > 1 && !MediaQuery.disableAnimationsOf(context);
    _controller.duration = _cycle;
    if (animate && !_controller.isAnimating) {
      widget.loop ? _controller.repeat() : _controller.forward(from: 0);
    } else if (!animate && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final still = widget.stillFrame.clamp(0, widget.frames.length - 1);
    return Semantics(
      label: widget.semanticLabel,
      image: widget.semanticLabel != null,
      excludeSemantics: widget.semanticLabel == null,
      child: SizedBox(
        width: widget.width,
        height: widget.height,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final index = _controller.isAnimating || _controller.value > 0
                ? (_controller.value * widget.frames.length).floor().clamp(0, widget.frames.length - 1)
                : still;
            return Image(
              image: widget.frames[index],
              fit: widget.fit,
              gaplessPlayback: true,
              excludeFromSemantics: true,
            );
          },
        ),
      ),
    );
  }
}
