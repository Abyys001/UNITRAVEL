import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// A cached JSON document and when it was stored.
class CachedDoc {
  const CachedDoc(this.data, this.savedAt);
  final Object? data;
  final DateTime savedAt;
}

/// Persistent JSON cache for offline reads (requests list/detail).
class JsonCache {
  const JsonCache(this._prefs);
  final SharedPreferences _prefs;

  static const _prefix = 'ut.cache.';

  Future<void> put(String key, Object? data) => _prefs.setString(
    '$_prefix$key',
    jsonEncode({'at': DateTime.now().toUtc().toIso8601String(), 'data': data}),
  );

  CachedDoc? get(String key) {
    final raw = _prefs.getString('$_prefix$key');
    if (raw == null) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final at = DateTime.tryParse('${m['at']}');
      return at == null ? null : CachedDoc(m['data'], at);
    } catch (_) {
      return null;
    }
  }

  Future<void> clear() async {
    for (final k in _prefs.getKeys().where((k) => k.startsWith(_prefix)).toList()) {
      await _prefs.remove(k);
    }
  }
}
