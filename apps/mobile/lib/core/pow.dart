import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

/// ALTCHA-style proof of work asked for by the API (`428 CHALLENGE_REQUIRED`).
/// Finds n in 0..maxnumber with sha256(salt + n) == challenge and returns the
/// base64 payload the API expects in `challenge`.
String? solvePowChallenge(Map<String, dynamic> c) {
  final salt = c['salt'] as String;
  final target = c['challenge'] as String;
  final max = (c['maxnumber'] as num).toInt();
  for (var n = 0; n <= max; n++) {
    if (sha256.convert(utf8.encode('$salt$n')).toString() == target) {
      return base64.encode(
        utf8.encode(
          jsonEncode({
            'algorithm': c['algorithm'],
            'challenge': target,
            'number': n,
            'salt': salt,
            'signature': c['signature'],
          }),
        ),
      );
    }
  }
  return null;
}

/// Runs the search off the UI thread where isolates exist (not on web).
Future<String?> solvePow(Map<String, dynamic> c) => compute(solvePowChallenge, c);
