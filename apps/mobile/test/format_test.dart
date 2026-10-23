import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:unitravel_mobile/core/format.dart';
import 'package:unitravel_mobile/models/json.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
  });

  group('Jalali formatting', () {
    test('Nowruz 1403 is 20 March 2024', () {
      expect(formatJalaliDate(DateTime(2024, 3, 20), 'en'), '1 Farvardin 1403');
      expect(formatJalaliDate(DateTime(2024, 3, 20), 'fa'), '۱ فروردین ۱۴۰۳');
    });

    test('10 December 2026 is 19 Azar 1405', () {
      expect(formatJalaliDate(DateTime(2026, 12, 10), 'en'), '19 Azar 1405');
      expect(formatJalaliDate(DateTime(2026, 12, 10), 'fa'), '۱۹ آذر ۱۴۰۵');
    });

    test('leap day and year end', () {
      expect(formatJalaliDate(DateTime(2025, 3, 20), 'en'), '30 Esfand 1403');
      expect(formatJalaliDate(DateTime(2025, 3, 21), 'en'), '1 Farvardin 1404');
    });

    test('formatDate picks the calendar', () {
      final d = DateTime(2026, 12, 10);
      expect(formatDate(d, lang: 'en', jalali: true), '19 Azar 1405');
      expect(formatDate(d, lang: 'en', jalali: false), 'Dec 10, 2026');
      expect(formatDate(d, lang: 'fa', jalali: false), contains('۲۰۲۶'));
    });

    test('ISO date strings from the API', () {
      expect(formatIsoDate('2026-12-10', lang: 'en', jalali: true), '19 Azar 1405');
      expect(formatIsoDate(null, lang: 'en', jalali: true), '');
      expect(formatIsoDate('garbage', lang: 'en', jalali: true), '');
    });
  });

  group('digits', () {
    test('round trip between Latin and Persian digits', () {
      expect(toPersianDigits('0912 345'), '۰۹۱۲ ۳۴۵');
      expect(toLatinDigits('۰۹۱۲ ۳۴۵'), '0912 345');
      expect(toLatinDigits('٠١٢٣'), '0123');
    });
  });

  group('money and time', () {
    test('minor units, no floats', () {
      expect(formatMoney(const Money(8100, 'GBP'), 'en'), '£81');
      expect(formatMoney(const Money(8150, 'GBP'), 'en'), '£81.50');
      expect(formatMoney(const Money(12345, 'XYZ'), 'en'), contains('XYZ'));
    });

    test('local time and day offset come from the segment strings', () {
      expect(localTime('2026-12-11T05:20', 'en'), '05:20');
      expect(localTime('2026-12-11T05:20', 'fa'), '۰۵:۲۰');
      expect(dayOffset('2026-12-11T23:10', '2026-12-12T06:00'), 1);
    });
  });
}
