import 'package:flutter/widgets.dart' show Locale;
import 'package:intl/intl.dart';

/// Locales that render digits as Persian (fa) or Arabic-Indic (ar) by
/// default, matching XFAM's supported languages.
const Set<String> _persianDigitLocales = {'fa'};
const Set<String> _arabicIndicDigitLocales = {'ar'};

const List<String> _persianDigits = [
  '۰',
  '۱',
  '۲',
  '۳',
  '۴',
  '۵',
  '۶',
  '۷',
  '۸',
  '۹',
];
const List<String> _arabicIndicDigits = [
  '٠',
  '١',
  '٢',
  '٣',
  '٤',
  '٥',
  '٦',
  '٧',
  '٨',
  '٩',
];

/// Replaces ASCII 0-9 with Persian or Arabic-Indic digits per [locale],
/// unless [forceLatinDigits] is set. Used by [Money.format] and [AmountField].
String localizeDigits(
  String input,
  Locale locale, {
  bool forceLatinDigits = false,
}) {
  if (forceLatinDigits) return input;
  final digits = _persianDigitLocales.contains(locale.languageCode)
      ? _persianDigits
      : _arabicIndicDigitLocales.contains(locale.languageCode)
      ? _arabicIndicDigits
      : null;
  if (digits == null) return input;
  final buffer = StringBuffer();
  for (final rune in input.runes) {
    final code = rune - 0x30;
    buffer.write(
      code >= 0 && code <= 9 ? digits[code] : String.fromCharCode(rune),
    );
  }
  return buffer.toString();
}

/// Reverses [localizeDigits]: swaps Persian/Arabic-Indic digit glyphs back to
/// ASCII, leaving every other character (grouping/decimal marks, currency
/// text, bidi marks) untouched. `intl`'s CLDR data renders fa/ar currency
/// strings with native digits regardless of a Latin-locale request, so
/// [Money.format]'s `forceLatinDigits` has to undo that itself.
String _digitGlyphsToAscii(String input) {
  final buffer = StringBuffer();
  for (final rune in input.runes) {
    final char = String.fromCharCode(rune);
    final persianIndex = _persianDigits.indexOf(char);
    final arabicIndicIndex = _arabicIndicDigits.indexOf(char);
    if (persianIndex != -1) {
      buffer.write(persianIndex);
    } else if (arabicIndicIndex != -1) {
      buffer.write(arabicIndicIndex);
    } else {
      buffer.write(char);
    }
  }
  return buffer.toString();
}

/// A locale-independent minor-unit map: currency code → decimal places.
/// XFAM apps pass their own (from the currencies catalog); this only holds
/// the fallback used when a currency is missing from that map.
const int defaultMinorUnits = 2;

/// An exact monetary amount: [minorUnits] decimal places of [currency], held
/// as a decimal [String] (never a [double]) to avoid float rounding on money.
class Money {
  const Money({
    required this.amount,
    required this.currency,
    required this.minorUnits,
  });

  /// Decimal string, e.g. `'1234.50'`. Always uses `.` as the decimal point
  /// regardless of locale — localisation happens at format time.
  final String amount;
  final String currency;
  final int minorUnits;

  factory Money.fromMinorUnitsMap(
    String amount,
    String currency,
    Map<String, int> minorUnitsByCurrency,
  ) => Money(
    amount: amount,
    currency: currency,
    minorUnits: minorUnitsByCurrency[currency] ?? defaultMinorUnits,
  );

  double get _numericValue => double.tryParse(amount) ?? 0;

  /// Formats the amount with locale grouping/decimal symbols and, for fa/ar
  /// locales, localized digits (override with `forceLatinDigits: true`, e.g.
  /// for IDs or when displaying inside a Latin-only context).
  String format(
    Locale locale, {
    bool showCurrency = true,
    bool forceLatinDigits = false,
  }) {
    final pattern = NumberFormat.currency(
      locale: locale.toLanguageTag(),
      decimalDigits: minorUnits,
      symbol: showCurrency ? currency : '',
      customPattern: showCurrency ? null : '#,##0.${'0' * minorUnits}',
    );
    final formatted = pattern.format(_numericValue).trim();
    return forceLatinDigits
        ? _digitGlyphsToAscii(formatted)
        : localizeDigits(formatted, locale);
  }

  @override
  String toString() => '$amount $currency';

  @override
  bool operator ==(Object other) =>
      other is Money &&
      other.amount == amount &&
      other.currency == currency &&
      other.minorUnits == minorUnits;

  @override
  int get hashCode => Object.hash(amount, currency, minorUnits);
}
