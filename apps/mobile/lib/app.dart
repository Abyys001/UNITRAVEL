import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/providers.dart';
import 'core/session.dart';
import 'l10n/app_localizations.dart';
import 'router.dart';
import 'ui/theme.dart';

class UniTravelApp extends ConsumerWidget {
  const UniTravelApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider);
    // The dark palette is designed and checked for admin mode; customers stay on the light theme (no toggle for them).
    final mode = ref.watch(sessionProvider.select((s) => s.isAdminMode)) ? ref.watch(themeModeProvider) : ThemeMode.light;
    return MaterialApp.router(
      title: 'UniTravel',
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(routerProvider),
      locale: locale,
      supportedLocales: AppL10n.supportedLocales,
      localizationsDelegates: const [
        AppL10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: buildAppTheme(locale),
      darkTheme: buildAppTheme(locale, brightness: Brightness.dark),
      themeMode: mode,
    );
  }
}
