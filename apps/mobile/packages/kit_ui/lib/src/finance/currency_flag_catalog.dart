/// Mirrors the schema of `assets/flags/circle-flags/currencies.json` in the
/// kit (ISO 4217 currency → circle-flags file + display minor units). The
/// kit ships no assets of its own — apps copy `assets/flags/circle-flags/`
/// into their own asset bundle and parse the JSON with
/// [CurrencyFlagCatalog.fromJson]; see README.md.
class CurrencyEntry {
  const CurrencyEntry({required this.flag, required this.minorUnits});

  /// ISO 3166-1 alpha-2 country code, lower case (circle-flags file stem).
  final String flag;
  final int minorUnits;

  factory CurrencyEntry.fromJson(Map<String, dynamic> json) => CurrencyEntry(
    flag: json['flag'] as String,
    minorUnits: json['minorUnits'] as int,
  );
}

class CurrencyFlagCatalog {
  const CurrencyFlagCatalog({
    required this.currencies,
    this.fallbackFlag = 'xx',
  });

  final Map<String, CurrencyEntry> currencies;
  final String fallbackFlag;

  factory CurrencyFlagCatalog.fromJson(Map<String, dynamic> json) =>
      CurrencyFlagCatalog(
        fallbackFlag: json['fallbackFlag'] as String? ?? 'xx',
        currencies: (json['currencies'] as Map<String, dynamic>).map(
          (code, entry) => MapEntry(
            code,
            CurrencyEntry.fromJson(entry as Map<String, dynamic>),
          ),
        ),
      );

  String flagFor(String currencyCode) =>
      currencies[currencyCode]?.flag ?? fallbackFlag;

  int minorUnitsFor(String currencyCode) =>
      currencies[currencyCode]?.minorUnits ?? 2;
}
