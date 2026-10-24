import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/tracking.dart';
import 'package:unitravel_mobile/features/cargo/tracking_timeline.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/l10n/app_localizations_en.dart';
import 'package:unitravel_mobile/l10n/app_localizations_fa.dart';
import 'package:unitravel_mobile/models/shipments.dart';

const codes = ['PICKED_UP', 'RECEIVED', 'DEPARTED', 'ARRIVED', 'AT_CUSTOMS', 'CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'HELD', 'DAMAGED', 'RETURNED', 'NOTE'];

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
  });

  test('every event code has a translated label that is not the raw code, and fa differs from en', () {
    final en = AppL10nEn();
    final fa = AppL10nFa();
    for (final c in codes) {
      final a = trackingLabel(en, c);
      final b = trackingLabel(fa, c);
      expect(a, isNot(c), reason: c);
      expect(a.contains('_'), isFalse, reason: c);
      expect(b, isNot(a), reason: c);
      expect(RegExp(r'[؀-ۿ]').hasMatch(b), isTrue, reason: c);
    }
    expect(trackingLabel(en, 'AT_CUSTOMS'), 'At customs');
    expect(trackingLabel(fa, 'AT_CUSTOMS'), 'در گمرک');
    expect(trackingLabel(en, 'SOMETHING_NEW'), 'Update');
  });

  test('shipment JSON reads the effective timeline, estimate and summary', () {
    final s = ShipmentItem.fromJson({
      'ref': 'UT-C-7Q2K9M',
      'status': 'IN_TRANSIT',
      'statusLabel': 'In transit',
      'laneLabel': 'UK → Türkiye',
      'awbNumber': '176-12345675',
      'estimatedDeliveryAt': '2026-11-05T10:00:00.000Z',
      'timeline': [
        {'id': 'a', 'eventCode': 'AT_CUSTOMS', 'label': 'At customs', 'location': 'IST', 'occurredAt': '2026-11-02T10:00:00.000Z', 'corrected': true},
      ],
    });
    expect(s.timeline.single.corrected, isTrue);
    expect(s.estimatedDeliveryAt, isNotNull);
    final sum = ShipmentSummary.fromJson({'total': 2, 'inTransit': 1, 'delivered': 1, 'next': null});
    expect(sum.nextRef, isNull);
    expect(sum.total, 2);
  });

  for (final lang in ['en', 'fa']) {
    testWidgets('timeline shows translated labels in $lang and never the raw code', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
          child: MaterialApp(
            locale: Locale(lang),
            supportedLocales: AppL10n.supportedLocales,
            localizationsDelegates: AppL10n.localizationsDelegates,
            home: Scaffold(
              body: TrackingTimeline(
                events: [
                  TrackEvent(id: '1', code: 'RECEIVED', location: 'London hub', occurredAt: DateTime.utc(2026, 11, 1, 9), description: null, corrected: false),
                  TrackEvent(
                    id: '2',
                    code: 'AT_CUSTOMS',
                    location: 'IST customs',
                    occurredAt: DateTime.utc(2026, 11, 2, 9),
                    description: null,
                    corrected: true,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(lang == 'en' ? 'At customs' : 'در گمرک'), findsOneWidget);
      expect(find.text(lang == 'en' ? 'Received at our partner' : 'نزد شریک ما دریافت شد'), findsOneWidget);
      expect(find.text(lang == 'en' ? 'Updated' : 'اصلاح‌شده'), findsOneWidget);
      expect(find.textContaining('AT_CUSTOMS'), findsNothing);
    });
  }
}
