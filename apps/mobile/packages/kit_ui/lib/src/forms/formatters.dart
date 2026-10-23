import 'package:flutter/services.dart';

/// Groups digits into 4-character blocks as the user types (`1234 5678 ...`),
/// for IBAN and card-number fields. Formatting only — no checksum/BIC
/// validation, which needs network lookups the kit doesn't do.
class GroupedDigitsInputFormatter extends TextInputFormatter {
  GroupedDigitsInputFormatter({this.groupSize = 4, this.maxLength});

  final int groupSize;
  final int? maxLength;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final raw = newValue.text.replaceAll(RegExp(r'\s'), '').toUpperCase();
    final capped = maxLength != null && raw.length > maxLength!
        ? raw.substring(0, maxLength)
        : raw;

    final buffer = StringBuffer();
    for (var i = 0; i < capped.length; i++) {
      if (i > 0 && i % groupSize == 0) buffer.write(' ');
      buffer.write(capped[i]);
    }
    final formatted = buffer.toString();

    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

/// IBAN input: uppercase, digits+letters, grouped in 4s, capped at the
/// longest published IBAN (34 characters).
class IbanInputFormatter extends GroupedDigitsInputFormatter {
  IbanInputFormatter() : super(groupSize: 4, maxLength: 34);

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final alnum = newValue.copyWith(
      text: newValue.text.replaceAll(RegExp('[^A-Za-z0-9]'), ''),
    );
    return super.formatEditUpdate(oldValue, alnum);
  }
}

/// Card number input: digits only, grouped in 4s, capped at 19 digits
/// (covers Visa/Mastercard/Amex/most PANs).
class CardNumberInputFormatter extends GroupedDigitsInputFormatter {
  CardNumberInputFormatter() : super(groupSize: 4, maxLength: 19);

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final digits = newValue.copyWith(
      text: newValue.text.replaceAll(RegExp('[^0-9]'), ''),
    );
    return super.formatEditUpdate(oldValue, digits);
  }
}
