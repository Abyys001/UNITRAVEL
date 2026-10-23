import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:kit_ui/src/finance/money.dart';
import 'package:kit_ui/src/theme/xfam_theme.dart';

const Map<String, int> _persianToAscii = {
  '۰': 0,
  '۱': 1,
  '۲': 2,
  '۳': 3,
  '۴': 4,
  '۵': 5,
  '۶': 6,
  '۷': 7,
  '۸': 8,
  '۹': 9, //
};
const Map<String, int> _arabicIndicToAscii = {
  '٠': 0,
  '١': 1,
  '٢': 2,
  '٣': 3,
  '٤': 4,
  '٥': 5,
  '٦': 6,
  '٧': 7,
  '٨': 8,
  '٩': 9, //
};

/// Converts any mix of ASCII, Persian or Arabic-Indic digits (and `٫`/`,`/`.`
/// decimal marks) in [input] to a plain ASCII decimal string.
String normalizeDigitsToAscii(String input) {
  final buffer = StringBuffer();
  for (final char in input.characters) {
    if (char == '.' || char == '٫' || char == '،') {
      buffer.write('.');
      continue;
    }
    final digit =
        int.tryParse(char) ??
        _persianToAscii[char] ??
        _arabicIndicToAscii[char];
    if (digit != null) buffer.write(digit);
  }
  return buffer.toString();
}

/// Formats free-form amount input into a grouped, locale-digit display while
/// tracking a canonical ASCII decimal string (never a [double]) as the real
/// value, capped at [maxDecimals] fraction digits.
class _AmountInputFormatter extends TextInputFormatter {
  _AmountInputFormatter({
    required this.locale,
    required this.maxDecimals,
    required this.onValueChanged,
  });

  final Locale locale;
  final int maxDecimals;
  final ValueChanged<String> onValueChanged;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final ascii = normalizeDigitsToAscii(newValue.text);
    final parts = ascii.split('.');
    var integerPart = parts.first.replaceFirst(RegExp('^0+(?=.)'), '');
    var fractionPart = parts.length > 1 ? parts.sublist(1).join() : null;
    if (fractionPart != null && fractionPart.length > maxDecimals) {
      fractionPart = fractionPart.substring(0, maxDecimals);
    }
    if (integerPart.isEmpty) integerPart = '0';

    final canonical = fractionPart == null
        ? integerPart
        : '$integerPart.$fractionPart';
    onValueChanged(canonical);

    final grouped = NumberFormat.decimalPattern(
      locale.toLanguageTag(),
    ).format(int.tryParse(integerPart) ?? 0);
    var display = grouped;
    if (fractionPart != null) {
      final decimalSeparator = NumberFormat.decimalPattern(
        locale.toLanguageTag(),
      ).symbols.DECIMAL_SEP;
      display = '$grouped$decimalSeparator$fractionPart';
    }
    display = localizeDigits(display, locale);

    return TextEditingValue(
      text: display,
      selection: TextSelection.collapsed(offset: display.length),
    );
  }
}

/// Decimal amount input: normalises Persian/Arabic-Indic digits, applies
/// locale thousands grouping, caps fraction digits, and reports the value as
/// a canonical ASCII decimal [String] via [onChanged] — never a [double].
class AmountField extends StatefulWidget {
  const AmountField({
    super.key,
    required this.onChanged,
    this.initialValue,
    this.maxDecimals = 2,
    this.currency,
    this.label,
    this.controller,
    this.focusNode,
    this.autofocus = false,
    this.enabled = true,
  });

  final ValueChanged<String> onChanged;
  final String? initialValue;
  final int maxDecimals;
  final String? currency;
  final String? label;
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final bool autofocus;
  final bool enabled;

  @override
  State<AmountField> createState() => _AmountFieldState();
}

class _AmountFieldState extends State<AmountField> {
  late final TextEditingController _controller =
      widget.controller ?? TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context);
    return TextField(
      controller: _controller,
      focusNode: widget.focusNode,
      autofocus: widget.autofocus,
      enabled: widget.enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textAlign: TextAlign.end,
      style: Theme.of(context).textTheme.bodyLarge?.tabularFigures,
      inputFormatters: [
        _AmountInputFormatter(
          locale: locale,
          maxDecimals: widget.maxDecimals,
          onValueChanged: widget.onChanged,
        ),
      ],
      decoration: InputDecoration(
        labelText: widget.label,
        suffixText: widget.currency,
        suffixStyle: Theme.of(context).textTheme.bodyMedium,
      ),
    );
  }
}
