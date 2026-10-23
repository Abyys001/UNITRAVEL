import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kit_ui/kit_ui.dart';

import '../core/errors_l10n.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';
import 'theme.dart';

extension L10nContext on BuildContext {
  AppL10n get l => AppL10n.of(this);
  String get lang => Localizations.localeOf(this).languageCode;
  bool get isFa => lang == 'fa';
}

/// Small pill. [solid] fills it, otherwise it is outlined; the label always
/// carries the meaning, colour is only reinforcement (DESIGN.md accessibility).
class ToneChip extends StatelessWidget {
  const ToneChip(this.label, {super.key, this.tone = XfamTone.neutral, this.solid = false, this.icon});
  final String label;
  final XfamTone tone;
  final bool solid;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = xc(context);
    final (fg, border, fill) = switch (tone) {
      XfamTone.success => (c.success, c.successBorder, c.successSubtle),
      XfamTone.danger => (c.danger, c.dangerBorder, c.dangerSubtle),
      XfamTone.warning => (Brand.copperDark, Brand.copper, c.warningSubtle),
      XfamTone.info => (c.infoSubtleFg, c.infoBorder, c.infoSubtle),
      XfamTone.neutral => (c.neutralSubtleFg, c.neutralBorder, c.neutralSubtle),
    };
    return Container(
      padding: const EdgeInsetsDirectional.fromSTEB(8, 3, 8, 3),
      decoration: BoxDecoration(
        color: solid ? (tone == XfamTone.success ? c.success : fill) : Colors.transparent,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: solid && tone == XfamTone.success ? Colors.white : fg), const SizedBox(width: 4)],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: solid && tone == XfamTone.success ? Colors.white : fg,
              fontWeight: FontWeight.w600,
              letterSpacing: context.isFa ? 0 : 0.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// Request status -> tone. Customer wording comes from the API's `statusLabel`.
XfamTone toneForStatus(String status) => switch (status) {
  'QUOTED' || 'AWAITING_CUSTOMER' => XfamTone.warning,
  'ACCEPTED' || 'RESERVED' || 'TICKETED' || 'COMPLETED' || 'BOOKED' || 'DELIVERED' => XfamTone.success,
  'DECLINED' || 'CANCELLED' || 'EXPIRED' || 'EXCEPTION' || 'COMPLIANCE_HOLD' => XfamTone.danger,
  'IN_REVIEW' || 'NEW' => XfamTone.info,
  _ => XfamTone.neutral,
};

/// Localised label for a staff-side request status (customers get the API's own `statusLabel`).
String staffStatusLabel(AppL10n l, String status) => switch (status) {
  'SUBMITTED' => l.statusSubmitted,
  'COMPLIANCE_HOLD' => l.statusComplianceHold,
  'NEW' => l.statusNew,
  'IN_REVIEW' => l.statusInReview,
  'AWAITING_CUSTOMER' => l.statusAwaitingCustomer,
  'QUOTED' => l.statusQuoted,
  'ACCEPTED' => l.statusAccepted,
  'RESERVED' => l.statusReserved,
  'TICKETED' => l.statusTicketed,
  'COMPLETED' => l.statusCompleted,
  'DECLINED' => l.statusDeclined,
  'CANCELLED' => l.statusCancelled,
  'EXPIRED' => l.statusExpired,
  _ => status,
};

/// Text kept left-to-right inside RTL paragraphs (refs, flight numbers, codes).
class LtrText extends StatelessWidget {
  const LtrText(this.text, {super.key, this.style, this.mono = false});
  final String text;
  final TextStyle? style;
  final bool mono;

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.ltr,
    child: Text(
      text,
      style: (style ?? Theme.of(context).textTheme.bodyMedium)?.copyWith(
        fontFamily: mono ? 'Inter' : null,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    ),
  );
}

class AppCard extends StatelessWidget {
  const AppCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(16), this.semanticLabel});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final card = Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
    // One merged node: the label replaces the card's inner texts, and carries the tap action.
    return semanticLabel == null
        ? card
        : Semantics(label: semanticLabel, container: true, button: onTap != null, onTap: onTap, excludeSemantics: true, child: card);
  }
}

/// Section title in the display face.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 8),
    child: Row(
      children: [
        Expanded(child: Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleMedium))),
        ?trailing,
      ],
    ),
  );
}

/// Inline error with an optional retry. Uses localised text for known codes.
class ErrorBox extends StatelessWidget {
  const ErrorBox(this.error, {super.key, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => ErrorState(
    title: errorMessage(context.l, error),
    retryLabel: context.l.retry,
    onRetry: onRetry,
  );
}

class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.count = 4});
  final int count;

  @override
  Widget build(BuildContext context) => Semantics(
    label: context.l.loading,
    child: ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (_, _) => const SkeletonBox(height: 84, borderRadius: BorderRadius.all(Radius.circular(10))),
    ),
  );
}

/// Shows "offline, last updated" when data came from the persistent cache.
class StaleBanner extends ConsumerWidget {
  const StaleBanner({super.key, required this.savedAt});
  final DateTime savedAt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final jalali = ref.watch(calendarJalaliProvider);
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        color: xc(context).warningSubtle,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Text(
          '${l.offlineBanner} ${l.lastUpdated(formatDateTime(savedAt, lang: context.lang, jalali: jalali))}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).warningSubtleFg),
        ),
      ),
    );
  }
}

void showMessage(BuildContext context, String text, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), backgroundColor: error ? Brand.brick : null));
}

/// Page body width cap so the app stays phone-shaped in a desktop browser.
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680), child: child),
  );
}
