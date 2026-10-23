import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/theme/xfam_theme.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Renders IBAN / card / reference identifiers in JetBrains Mono, grouped
/// into 4-character blocks, LTR-isolated inside RTL layouts, with an
/// optional masked display and a copy action.
class IdentifierText extends StatelessWidget {
  const IdentifierText(
    this.value, {
    super.key,
    this.groupSize = 4,
    this.masked = false,
    this.visibleTail = 4,
    this.copyable = false,
    this.style,
    this.semanticLabel,
    this.copyActionLabel = 'Copy',
    this.copiedMessage = 'Copied',
  });

  final String value;
  final int groupSize;

  /// Shows only the last [visibleTail] characters, masking the rest with `•`.
  final bool masked;
  final int visibleTail;
  final bool copyable;
  final TextStyle? style;
  final String? semanticLabel;

  /// Caller-supplied localized strings for the copy button and confirmation.
  final String copyActionLabel;
  final String copiedMessage;

  String get _displayValue {
    if (!masked || value.length <= visibleTail) return value;
    final maskedLength = value.length - visibleTail;
    return '${'•' * maskedLength}${value.substring(maskedLength)}';
  }

  String get _grouped {
    final source = _displayValue;
    final buffer = StringBuffer();
    for (var i = 0; i < source.length; i++) {
      if (i > 0 && i % groupSize == 0) buffer.write(' ');
      buffer.write(source[i]);
    }
    return buffer.toString();
  }

  @override
  Widget build(BuildContext context) {
    final baseStyle = (style ?? Theme.of(context).textTheme.bodyLarge)
        ?.copyWith(fontFamily: XfamFonts.mono)
        .tabularFigures;
    final text = Text(
      _grouped,
      style: baseStyle,
      semanticsLabel: semanticLabel ?? (masked ? 'masked identifier' : value),
    );

    final content = Directionality(
      textDirection: TextDirection.ltr,
      child: text,
    );
    if (!copyable) return content;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(child: content),
        const SizedBox(width: XfamSpace.s1),
        Semantics(
          button: true,
          label: copyActionLabel,
          child: IconButton(
            iconSize: XfamSize.iconSm,
            visualDensity: VisualDensity.compact,
            icon: const XfamIcon('copy'),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: value));
              if (context.mounted) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text(copiedMessage)));
              }
            },
          ),
        ),
      ],
    );
  }
}
