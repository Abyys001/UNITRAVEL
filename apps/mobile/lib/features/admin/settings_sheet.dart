import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../ui/bento.dart';
import '../../ui/widgets.dart';

/// Admin settings: appearance (light / dark / system, persisted) and language.
Future<void> showAdminSettings(BuildContext context) =>
    showModalBottomSheet<void>(context: context, isScrollControlled: true, useSafeArea: true, builder: (_) => const _SettingsSheet());

class _SettingsSheet extends ConsumerWidget {
  const _SettingsSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final theme = Theme.of(context);
    final mode = ref.watch(themeModeProvider);
    final lang = ref.watch(localeProvider).languageCode;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text(l.settingsTitle, style: theme.textTheme.titleLarge)),
            const SizedBox(height: 20),
            Text(l.appearance, style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            SegmentedButton<ThemeMode>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: ThemeMode.system, label: Text(l.themeSystem)),
                ButtonSegment(value: ThemeMode.light, label: Text(l.themeLight)),
                ButtonSegment(value: ThemeMode.dark, label: Text(l.themeDark)),
              ],
              selected: {mode},
              onSelectionChanged: (s) {
                Haptics.select();
                ref.read(themeModeProvider.notifier).set(s.first);
              },
            ),
            const SizedBox(height: 20),
            Text(l.languageLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: 'en', label: Text(l.langEnglish)),
                ButtonSegment(value: 'fa', label: Text(l.langPersian)),
              ],
              selected: {lang},
              onSelectionChanged: (s) {
                Haptics.select();
                ref.read(localeProvider.notifier).set(s.first);
              },
            ),
          ],
        ),
      ),
    );
  }
}
