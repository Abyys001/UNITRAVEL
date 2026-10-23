import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:kit_ui/src/finance/amount_field.dart'
    show normalizeDigitsToAscii;
import 'package:kit_ui/src/theme/xfam_theme.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Native OTP/PIN input: [length] single-digit boxes, auto-advances focus,
/// backspace steps back, supports pasting the full code into any box, and
/// normalises Persian/Arabic-Indic digit entry to ASCII.
///
/// Built natively rather than on `pinput` (evaluated: 6.0.2, MIT, actively
/// maintained) because the kit needs tight control over RTL box order and
/// locale-digit normalisation that a generic pin widget doesn't give for
/// free, and the native implementation is ~120 lines with no extra
/// dependency — see README.md for the full comparison.
class OtpField extends StatefulWidget {
  const OtpField({
    super.key,
    required this.length,
    required this.onCompleted,
    this.onChanged,
    this.autofocus = true,
    this.errorText,
  });

  final int length;
  final ValueChanged<String> onCompleted;
  final ValueChanged<String>? onChanged;
  final bool autofocus;
  final String? errorText;

  @override
  State<OtpField> createState() => _OtpFieldState();
}

class _OtpFieldState extends State<OtpField> {
  late final List<TextEditingController> _controllers = List.generate(
    widget.length,
    (_) => TextEditingController(),
  );
  late final List<FocusNode> _focusNodes = List.generate(
    widget.length,
    (_) => FocusNode(),
  );

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  String get _code => _controllers.map((c) => c.text).join();

  void _notify() {
    final code = _code;
    widget.onChanged?.call(code);
    if (code.length == widget.length) {
      FocusScope.of(context).unfocus();
      widget.onCompleted(code);
    }
  }

  void _handleInput(int index, String rawValue) {
    final ascii = normalizeDigitsToAscii(rawValue);
    if (ascii.length > 1) {
      // Pasted or autofilled: distribute digits starting at this box.
      for (var i = 0; i < ascii.length && index + i < widget.length; i++) {
        _controllers[index + i].text = ascii[i];
      }
      final nextIndex = (index + ascii.length).clamp(0, widget.length - 1);
      _focusNodes[nextIndex].requestFocus();
      _notify();
      return;
    }
    _controllers[index].text = ascii;
    if (ascii.isNotEmpty && index < widget.length - 1) {
      _focusNodes[index + 1].requestFocus();
    }
    _notify();
  }

  void _handleBackspace(int index) {
    if (_controllers[index].text.isEmpty && index > 0) {
      _focusNodes[index - 1].requestFocus();
      _controllers[index - 1].clear();
      _notify();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final hasError = widget.errorText != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Directionality(
          textDirection: TextDirection.ltr,
          child: Semantics(
            label: 'One-time passcode, ${widget.length} digits',
            textField: true,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < widget.length; i++) ...[
                  if (i > 0) const SizedBox(width: XfamSpace.s2),
                  _OtpBox(
                    controller: _controllers[i],
                    focusNode: _focusNodes[i],
                    autofocus: widget.autofocus && i == 0,
                    hasError: hasError,
                    colors: colors,
                    onChanged: (v) => _handleInput(i, v),
                    onBackspace: () => _handleBackspace(i),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (widget.errorText != null) ...[
          const SizedBox(height: XfamSpace.s2),
          Text(
            widget.errorText!,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(color: colors.danger),
          ),
        ],
      ],
    );
  }
}

class _OtpBox extends StatelessWidget {
  const _OtpBox({
    required this.controller,
    required this.focusNode,
    required this.autofocus,
    required this.hasError,
    required this.colors,
    required this.onChanged,
    required this.onBackspace,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool autofocus;
  final bool hasError;
  final XfamColors colors;
  final ValueChanged<String> onChanged;
  final VoidCallback onBackspace;

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.backspace) {
          onBackspace();
        }
        return KeyEventResult.ignored;
      },
      child: SizedBox(
        width: XfamSize.controlLg,
        height: XfamSize.controlLg,
        child: TextField(
          controller: controller,
          focusNode: focusNode,
          autofocus: autofocus,
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          style: Theme.of(context).textTheme.titleLarge?.tabularFigures,
          inputFormatters: [LengthLimitingTextInputFormatter(8)],
          decoration: InputDecoration(
            counterText: '',
            contentPadding: EdgeInsets.zero,
            filled: true,
            fillColor: colors.surfaceSunken,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(XfamRadius.sm),
              borderSide: BorderSide.none,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(XfamRadius.sm),
              borderSide: BorderSide(
                color: hasError ? colors.danger : colors.border,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(XfamRadius.sm),
              borderSide: BorderSide(
                color: hasError ? colors.danger : colors.ring,
                width: 2,
              ),
            ),
          ),
          onChanged: onChanged,
        ),
      ),
    );
  }
}
