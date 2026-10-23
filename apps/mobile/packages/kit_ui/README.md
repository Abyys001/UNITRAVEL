# kit_ui — XFAM Flutter UI kit

Shared theme, finance, workflow, forms, feedback, navigation and overlay
widgets for the XFAM customer and staff apps, built on the generated
`XfamTokens`/`XfamColors`/`XfamStatus` design tokens.

State-management agnostic: every widget is a plain `StatelessWidget`/
`StatefulWidget` driven by callbacks and values. No `Riverpod`, `Dio` or
`go_router` dependency — apps wire this package into their own MVVM/Riverpod
stack (see `sources/mobile/flutter-structure` for that pattern).

## Adding it to an app

This is a path dependency, not a published package — copy the kit's copy in,
or point at it directly during development:

```yaml
# apps/customer/pubspec.yaml
dependencies:
  kit_ui:
    path: ../../engineering-kit/components/flutter
```

For a shipped app, copy `components/flutter/` into the app repo (e.g.
`packages/kit_ui/`) and adapt from there — never edit the kit copy for one
project (see the kit root `README.md`, "Promoting code into the kit").

## Fonts

The kit ships no font *files* (never copy binaries into the package); it only
requires the family names in `XfamFonts` to exist in the consuming app's
`pubspec.yaml`, pointed at the kit's `fonts/` directory:

```yaml
flutter:
  fonts:
    - family: Inter
      fonts:
        - asset: ../../engineering-kit/fonts/inter/Inter-Regular.ttf
        - asset: ../../engineering-kit/fonts/inter/Inter-Medium.ttf
          weight: 500
        - asset: ../../engineering-kit/fonts/inter/Inter-SemiBold.ttf
          weight: 600
        - asset: ../../engineering-kit/fonts/inter/Inter-Bold.ttf
          weight: 700
    - family: Vazirmatn
      fonts:
        - asset: ../../engineering-kit/fonts/vazirmatn/Vazirmatn-Regular.ttf
        - asset: ../../engineering-kit/fonts/vazirmatn/Vazirmatn-Medium.ttf
          weight: 500
        - asset: ../../engineering-kit/fonts/vazirmatn/Vazirmatn-SemiBold.ttf
          weight: 600
        - asset: ../../engineering-kit/fonts/vazirmatn/Vazirmatn-Bold.ttf
          weight: 700
    - family: IBM Plex Sans Arabic
      fonts:
        - asset: ../../engineering-kit/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.ttf
        - asset: ../../engineering-kit/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Medium.ttf
          weight: 500
        - asset: ../../engineering-kit/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.ttf
          weight: 600
        - asset: ../../engineering-kit/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Bold.ttf
          weight: 700
    - family: JetBrains Mono
      fonts:
        # Variable font — select weight at use-site with FontVariation('wght', …),
        # e.g. IdentifierText / IbanField / CardNumberField already do this via
        # the tabularFigures + fontFamily: XfamFonts.mono style.
        - asset: ../../engineering-kit/fonts/jetbrains-mono/JetBrainsMono[wght].ttf
```

`buildXfamTheme` picks `Inter` for Latin locales and `Vazirmatn` (falling
back to `IBM Plex Sans Arabic`, then `Inter`) for `fa`/`ar`, per
`XfamFonts`/`XfamFontFallback`.

## Assets (currency flags)

The kit ships no SVGs either — copy `assets/flags/circle-flags/*.svg` and
`currencies.json` from the kit root into the app:

```yaml
flutter:
  assets:
    - assets/flags/circle-flags/
```

```dart
final catalogJson = jsonDecode(await rootBundle.loadString('assets/flags/circle-flags/currencies.json'));
final catalog = CurrencyFlagCatalog.fromJson(catalogJson as Map<String, dynamic>);
```

`CurrencyFlag`, `CurrencyPicker`, `CurrencyPairRow` and
`ExchangeCalculatorCard` all take a `CurrencyFlagCatalog`.

## Theme setup with locale switching

```dart
class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) {
        final locale = ref.watch(localeProvider); // app-owned, e.g. Riverpod
        return MaterialApp.router(
          theme: buildXfamTheme(brightness: Brightness.light, locale: locale),
          darkTheme: buildXfamTheme(brightness: Brightness.dark, locale: locale),
          locale: locale,
          supportedLocales: const [
            Locale('en'), Locale('fa'), Locale('ar'),
            Locale('de'), Locale('es'), Locale('fr'), Locale('tr'),
          ],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          routerConfig: router,
        );
      },
    );
  }
}
```

Tenant branding: `XfamColors.light.withBrand(...)` (from `XfamBrand.fromSeed`)
passed as `buildXfamTheme(..., colors: tenantColors)`.

## go_router shell integration

`AdaptiveScaffold` takes a `bodyBuilder` and plain index callbacks, so it
drops directly into a `StatefulNavigationShell`:

```dart
StatefulShellRoute.indexedStack(
  builder: (context, state, shell) => AdaptiveScaffold(
    destinations: const [
      XfamDestination(icon: Icon(LucideIcons.house), selectedIcon: Icon(LucideIcons.house), label: 'Home'),
      XfamDestination(icon: Icon(LucideIcons.receipt), selectedIcon: Icon(LucideIcons.receipt), label: 'Requests'),
    ],
    selectedIndex: shell.currentIndex,
    onDestinationSelected: shell.goBranch,
    bodyBuilder: (context) => shell,
  ),
  branches: [...],
)
```

## Dependencies

| Package | Version | License | Publisher/repo | Why |
|---|---|---|---|---|
| `intl` | `^0.20.0` | BSD-3 (dart-lang) | `dart-lang/i18n` | `Money`/`AmountField` locale grouping and currency formatting; the standard Dart choice. |
| `flutter_svg` | `^2.3.0` | BSD-3/MIT (flutter.dev) | `flutter/packages` | Renders the app-supplied circle-flags SVGs (`CurrencyFlag`); official Flutter-team package. |
| `lucide_icons_flutter` | `^3.1.0` | MIT | `vqh2602/lucide-flutter-main` (community fork of `lucide.dev`) | See "Icon package evaluation" below. |
| `flutter_lints` (dev) | `^6.0.0` | BSD-3 (flutter.dev) | `flutter/packages` | Base lint set, extended in `analysis_options.yaml`. |
| `flutter_localizations` (dev) | SDK | BSD-3 (flutter.dev) | Flutter SDK | Widget-test harness only (`test/support/pump_app.dart`); apps already depend on it for `MaterialApp` localization. |

Versions/licenses verified against the pub.dev mirror (`pub.flutter-io.cn`)
and each package's `LICENSE` file on 2026-09-28.

### Icon package evaluation

Needed: full coverage of the 20 Lucide names in `XfamStatus.icon` plus a
handful more used by workflow/forms/feedback/overlays widgets, a permissive
license, and active maintenance.

- **`lucide_icons_flutter` 3.1.20 (chosen)** — MIT. 75 published versions,
  latest 2026-09-15 (actively maintained). Bundles its own bitmap-free
  `Lucide` icon font (`fontPackage`), so no extra asset wiring. Covers every
  name this kit uses (`lib/src/icons/xfam_icons.dart` has the full map).
  Repository (`vqh2602/lucide-flutter-main`) is a community mirror, not the
  `lucide-icons` org itself — noted as a gap below.
- **`lucide_icons` 0.257.0 (rejected)** — ISC, repository *is* the official
  `lucide-icons/lucide` monorepo, but the pub package hasn't been published
  since 2023-06-29 (3+ years stale) — its icon set predates several names
  this kit needs to track as Lucide adds icons.
- **`phosphor_flutter`** — evaluated, not added. No widget in this kit uses a
  Phosphor icon yet; add it only when one does (per the kit's dependency
  policy), pinned to a version verified the same way.

### OTP field: native vs. `pinput`

Evaluated `pinput` 6.0.2 (MIT, actively maintained). Built `OtpField` natively
instead (`lib/src/forms/otp_field.dart`, ~180 lines) because the kit needs
tight, kit-owned control over two things a generic pin widget doesn't give
for free: RTL box order via `Directionality` and Persian/Arabic-Indic digit
normalisation on paste/autofill (`normalizeDigitsToAscii`, shared with
`AmountField`). That's a small, self-contained widget — not worth a
dependency for one caller.

### Skeleton loading: native vs. `skeletonizer`

Evaluated `skeletonizer` 3.0.0 (MIT, actively maintained). Built
`SkeletonBox`/`SkeletonList` natively (`lib/src/feedback/skeleton.dart`)
because `skeletonizer` wraps *arbitrary* widget subtrees via bone-painting —
more machinery than the two fixed shapes (`SkeletonBox`, `SkeletonList`) this
kit needs. Both respect `MediaQuery.disableAnimations`.

### App-owned packages (not kit dependencies)

The kit deliberately takes no dependency on these — it exposes the
integration point (a callback, a bool/stream, a status enum) and the app
picks the implementation:

| Concern | Kit integration point | Recommended app package |
|---|---|---|
| Picking a photo/document | `DocumentPickerTile.onPick` | `image_picker` (^1.2.0, BSD-3) and/or `file_picker` (^13.1.0, MIT) |
| Connectivity | `OfflineBanner.isOffline` | `connectivity_plus` (^7.3.0, BSD-3) |
| Navigation | `AdaptiveScaffold.onDestinationSelected` | `go_router` (already a stack dependency) |

## Widget catalog

| Widget | Group | Purpose | RTL | Dark |
|---|---|---|---|---|
| `buildXfamTheme` | theme | Material 3 `ThemeData` from `XfamColors` + script-aware type ramp | script-aware line-height | ✓ (pass `Brightness.dark`) |
| `XfamBrand.fromSeed` | theme | Tenant brand palette from one seed color, WCAG AA-checked | n/a | ✓ |
| `XfamIcon` / `lucideIcon` | icons | Named Lucide icon, auto-mirrors directional icons under RTL | ✓ | ✓ |
| `Money` / `MoneyText` | finance | Decimal-string amount + locale-formatted, LTR-isolated display | ✓ isolated | ✓ |
| `AmountField` | finance | Grouped decimal input, Persian/Arabic-Indic digit entry | ✓ | ✓ |
| `CurrencyFlag` / `CurrencyFlagCatalog` | finance | App-asset circle flag by currency code | n/a | ✓ |
| `CurrencyPicker` | finance | Searchable currency bottom sheet | ✓ | ✓ |
| `CurrencyPairRow` | finance | From/to currency chips + swap | ✓ | ✓ |
| `RateCard` | finance | Buy/sell rate, change badge, stale state | ✓ | ✓ |
| `ExchangeCalculatorCard` | finance | Presentational send/receive calculator | ✓ | ✓ |
| `FeeBreakdown` / `PaymentSummaryCard` | finance | Itemized fees + total, payment review summary | ✓ | ✓ |
| `IdentifierText` | finance | IBAN/card/reference, mono, grouped, maskable, copyable | ✓ isolated | ✓ |
| `StatusBadge` | workflow | `XfamStatus` → tone pill + icon + caller label | ✓ | ✓ |
| `RequestProgress` | workflow | `XfamPhase` tracker (complete/current/error) | ✓ | ✓ |
| `WizardStepper` | workflow | "Step N of M" header + progress track | ✓ | ✓ |
| `TimelineList` | workflow | Vertical audit/activity timeline | ✓ | ✓ |
| `SlaIndicator` | workflow | Tone-shifting deadline chip | ✓ | ✓ |
| `ApprovalActionBar` | workflow | Approve/reject(reason required)/request-info bar | ✓ | ✓ |
| `ConfirmSheet` | workflow | Confirm/cancel bottom sheet, dangerous variant | ✓ | ✓ |
| `OtpField` | forms | Native N-box OTP input, paste/autofill aware | ✓ | ✓ |
| `FormSection` | forms | Labelled field group | ✓ | ✓ |
| `DocumentPickerTile` | forms | Upload tile (empty/uploading/done/error) | ✓ | ✓ |
| `IbanField` / `CardNumberField` | forms | Grouped, LTR-forced identifier inputs | forced LTR | ✓ |
| `EmptyState` / `ErrorState` | feedback | Centered placeholder + action | ✓ | ✓ |
| `OfflineBanner` | feedback | App-driven offline banner | ✓ | ✓ |
| `SkeletonBox` / `SkeletonList` | feedback | Native shimmer loading placeholders | ✓ | ✓ |
| `showXfamSnackBar` | feedback | Tone-colored snack bar helper | ✓ | ✓ |
| `AdaptiveScaffold` | navigation | Bottom bar (compact) / rail (medium+) per `XfamBreakpoint` | ✓ | ✓ |
| `showXfamBottomSheet` | overlays | Themed modal sheet (drag handle, safe area, keyboard-aware) | ✓ | ✓ |

## Known gaps

- `showXfamDialog`: not added. `ThemeData.dialogTheme` (set by
  `buildXfamTheme`) already gives plain `AlertDialog`/`showDialog` consistent
  radius and color; `ConfirmSheet` covers the confirm/cancel/dangerous case.
  Add a wrapper only when a real desktop/tablet dialog need shows up.
- No `example/` gallery app — skipped per instructions (no platform
  scaffolding in the kit); the widget tests double as usage examples.
- `lib/src/tokens/xfam_tokens.dart` is generated by `tokens/build.mjs` (which runs `dart format` on it);
  never hand-edit it — change `tokens/xfam-tokens.json` and rebuild.
- `lucide_icons_flutter`'s repository is a community fork
  (`vqh2602/lucide-flutter-main`), not the `lucide-icons` GitHub org — track
  `lucide_icons` (the org-owned package) for a future re-evaluation if it
  resumes publishing.

## Validation

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze   # 0 issues
flutter test      # 30 passing
```
