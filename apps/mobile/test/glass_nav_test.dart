import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:unitravel_mobile/ui/glass_nav_bar.dart';
import 'package:unitravel_mobile/ui/theme.dart';
import 'package:unitravel_mobile/ui/widgets.dart';

const _items = [
  GlassNavItem(icon: Icon(Icons.home_outlined), label: 'One'),
  GlassNavItem(icon: Icon(Icons.search), label: 'Two'),
  GlassNavItem(icon: Icon(Icons.person_outline), label: 'Three'),
];

Widget _host({
  int selected = 0,
  ValueChanged<int>? onSelected,
  TextDirection dir = TextDirection.ltr,
  bool highContrast = false,
  bool disableAnimations = false,
  void Function(double bottom)? onBodyInset,
}) => MaterialApp(
  theme: buildAppTheme(const Locale('en')),
  home: Directionality(
    textDirection: dir,
    child: MediaQuery(
      data: MediaQueryData(
        size: const Size(390, 800),
        highContrast: highContrast,
        disableAnimations: disableAnimations,
      ),
      child: Scaffold(
        extendBody: true,
        body: Builder(
          builder: (ctx) {
            onBodyInset?.call(MediaQuery.paddingOf(ctx).bottom);
            return const SizedBox.expand();
          },
        ),
        bottomNavigationBar: GlassNavBar(
          items: _items,
          selectedIndex: selected,
          onSelected: onSelected ?? (_) {},
        ),
      ),
    ),
  ),
);

void main() {
  testWidgets('one blur layer; body inset covers the bar', (tester) async {
    double? inset;
    await tester.pumpWidget(_host(onBodyInset: (b) => inset = b));
    expect(
      find.byWidgetPredicate(
        (w) => w is BackdropFilter && w.filter is ImageFilter,
      ),
      findsOneWidget,
    );
    final bar = tester.getRect(find.byType(GlassPanel));
    expect(bar.height, 64);
    expect(inset, greaterThanOrEqualTo(64 + 12));
  });

  testWidgets('taps report the index; targets are at least 48dp', (
    tester,
  ) async {
    int? tapped;
    await tester.pumpWidget(_host(onSelected: (i) => tapped = i));
    await tester.tap(find.text('Three'));
    expect(tapped, 2);
    for (var i = 0; i < 3; i++) {
      final size = tester.getSize(find.byKey(Key('nav-tab-$i')));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
  });

  testWidgets('RTL mirrors tab order and the indicator', (tester) async {
    await tester.pumpWidget(_host(dir: TextDirection.rtl, selected: 0));
    expect(
      tester.getCenter(find.text('One')).dx,
      greaterThan(tester.getCenter(find.text('Three')).dx),
    );
    final indicator = tester.getCenter(
      find
          .descendant(
            of: find.byType(AnimatedAlign),
            matching: find.byType(DecoratedBox),
          )
          .first,
    );
    expect(indicator.dx, greaterThan(195));
  });

  testWidgets('indicator slides over 250ms', (tester) async {
    await tester.pumpWidget(_host(selected: 0));
    final finder = find
        .descendant(
          of: find.byType(AnimatedAlign),
          matching: find.byType(DecoratedBox),
        )
        .first;
    final x0 = tester.getCenter(finder).dx;
    await tester.pumpWidget(_host(selected: 2));
    await tester.pump(const Duration(milliseconds: 100));
    final mid = tester.getCenter(finder).dx;
    await tester.pumpAndSettle();
    final x1 = tester.getCenter(finder).dx;
    expect(mid, greaterThan(x0));
    expect(mid, lessThan(x1));
  });

  testWidgets('semantics: selected tab is a selected button', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(_host(selected: 1));
    expect(
      tester.getSemantics(find.byKey(const Key('nav-tab-1'))),
      matchesSemantics(
        isSelected: true,
        isButton: true,
        hasSelectedState: true,
        hasTapAction: true,
        hasFocusAction: true,
        isFocusable: true,
        label: 'Two',
        hint: 'Tab 2 of 3',
      ),
    );
    handle.dispose();
  });

  for (final c in [(true, false), (false, true)]) {
    testWidgets(
      'opaque fallback highContrast=${c.$1} disableAnimations=${c.$2}',
      (tester) async {
        await tester.pumpWidget(
          _host(highContrast: c.$1, disableAnimations: c.$2),
        );
        expect(find.byType(BackdropFilter), findsNothing);
      },
    );
  }

  testWidgets('showGlassSheet: single blur layer, content tappable', (
    tester,
  ) async {
    String? picked;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(const Locale('en')),
        home: Builder(
          builder: (ctx) => TextButton(
            onPressed: () async => picked = await showGlassSheet<String>(
              context: ctx,
              builder: (c) => ListTile(
                title: const Text('Pick me'),
                onTap: () => Navigator.pop(c, 'ok'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byType(BackdropFilter), findsOneWidget);
    await tester.tap(find.text('Pick me'));
    await tester.pumpAndSettle();
    expect(picked, 'ok');
  });
}
