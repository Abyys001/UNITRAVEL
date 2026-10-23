import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:kit_ui/src/forms/formatters.dart';
import 'package:kit_ui/src/theme/xfam_theme.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// IBAN text field: uppercase, grouped in 4s, JetBrains Mono, LTR (IBANs are
/// always read left-to-right even inside RTL forms).
class IbanField extends StatelessWidget {
  const IbanField({
    super.key,
    required this.onChanged,
    this.controller,
    this.label = 'IBAN',
    this.enabled = true,
  });

  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: TextField(
        controller: controller,
        enabled: enabled,
        textCapitalization: TextCapitalization.characters,
        style: Theme.of(context).textTheme.bodyLarge
            ?.copyWith(fontFamily: XfamFonts.mono)
            .tabularFigures,
        inputFormatters: [IbanInputFormatter()],
        onChanged: onChanged,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}

/// Card-number text field: digits only, grouped in 4s, JetBrains Mono, LTR.
class CardNumberField extends StatelessWidget {
  const CardNumberField({
    super.key,
    required this.onChanged,
    this.controller,
    this.label = 'Card number',
    this.enabled = true,
  });

  final ValueChanged<String> onChanged;
  final TextEditingController? controller;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: TextField(
        controller: controller,
        enabled: enabled,
        keyboardType: TextInputType.number,
        style: Theme.of(context).textTheme.bodyLarge
            ?.copyWith(fontFamily: XfamFonts.mono)
            .tabularFigures,
        inputFormatters: [
          CardNumberInputFormatter(),
          LengthLimitingTextInputFormatter(23),
        ],
        onChanged: onChanged,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}
