/// Tiny helpers for reading API JSON defensively (the API is the source of truth;
/// unknown extra fields are ignored, missing optional ones become null).
typedef Json = Map<String, dynamic>;

extension JsonRead on Map<String, dynamic> {
  String str(String k, [String d = '']) => this[k] is String ? this[k] as String : d;
  String? strOrNull(String k) => this[k] is String ? this[k] as String : null;
  int integer(String k, [int d = 0]) => this[k] is num ? (this[k] as num).toInt() : d;
  int? intOrNull(String k) => this[k] is num ? (this[k] as num).toInt() : null;
  bool flag(String k, [bool d = false]) => this[k] is bool ? this[k] as bool : d;
  Json obj(String k) => this[k] is Map<String, dynamic> ? this[k] as Json : <String, dynamic>{};
  Json? objOrNull(String k) => this[k] is Map<String, dynamic> ? this[k] as Json : null;
  List<Json> objs(String k) => this[k] is List
      ? (this[k] as List).whereType<Map<String, dynamic>>().toList()
      : const [];
  List<String> strs(String k) =>
      this[k] is List ? (this[k] as List).whereType<String>().toList() : const [];
}

DateTime? parseDate(Object? v) => v is String ? DateTime.tryParse(v) : null;

/// Integer minor units + ISO-4217 (ch. 19.3).
class Money {
  const Money(this.amountMinor, this.currency);
  final int amountMinor;
  final String currency;

  static Money? from(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    return Money(v.integer('amountMinor'), v.str('currency', 'GBP'));
  }
}
