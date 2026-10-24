import 'package:flutter/material.dart';

import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../l10n/app_localizations.dart';
import '../models/identity.dart' show VerificationStatus;
import 'theme.dart';
import 'widgets.dart';

/// Shared product patterns (mirror of packages/ui/src/product on the web): timeline, request stepper, document card,
/// verification badge and payment state. Tokens come from the generated BrandTokens via [Brand].

class AppTimelineEntry {
  const AppTimelineEntry({required this.title, this.subtitle, this.note});
  final String title;
  final String? subtitle;

  /// Small label after the title, e.g. "Updated".
  final String? note;
}

/// Flight-path timeline: completed stops navy with a check, the current stop orange. [currentIndex] defaults to the
/// last entry (oldest first); pass 0 for newest-first lists.
class AppTimeline extends StatelessWidget {
  const AppTimeline({super.key, required this.entries, this.currentIndex});
  final List<AppTimelineEntry> entries;
  final int? currentIndex;

  @override
  Widget build(BuildContext context) {
    final cur = currentIndex ?? entries.length - 1;
    return Column(
      children: [
        for (var i = 0; i < entries.length; i++) _Stop(entry: entries[i], current: i == cur, last: i == entries.length - 1),
      ],
    );
  }
}

class _Stop extends StatelessWidget {
  const _Stop({required this.entry, required this.current, required this.last});
  final AppTimelineEntry entry;
  final bool current;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final dot = current ? Brand.orange : Brand.navy900;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                  child: current ? null : const Icon(Icons.check, size: 12, color: Colors.white),
                ),
                if (!last) Expanded(child: Container(width: 2, color: Brand.navy900.withValues(alpha: 0.35))),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(entry.title, style: t.titleSmall?.copyWith(fontWeight: current ? FontWeight.w800 : FontWeight.w600)),
                      if (entry.note != null) Text(entry.note!, style: t.labelSmall?.copyWith(color: Brand.steel)),
                    ],
                  ),
                  if (entry.subtitle != null && entry.subtitle!.isNotEmpty) Text(entry.subtitle!, style: t.bodySmall?.copyWith(color: Brand.steel)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Request progress along a known path. Steps before [current] are done; the state is spoken to screen readers, never
/// colour alone. Horizontal when there is room, otherwise a compact column.
class RequestStepper extends StatelessWidget {
  const RequestStepper({super.key, required this.steps, required this.current, required this.label, required this.doneLabel, required this.currentLabel, required this.todoLabel});
  final List<String> steps;
  final int current;
  final String label;
  final String doneLabel;
  final String currentLabel;
  final String todoLabel;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = xc(context);
    return Semantics(
      container: true,
      label: label,
      child: Row(
        key: const Key('request-stepper'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < steps.length; i++)
            Expanded(
              child: Semantics(
                label: '${steps[i]}, ${i < current ? doneLabel : i == current ? currentLabel : todoLabel}',
                excludeSemantics: true,
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(child: i == 0 ? const SizedBox() : Container(height: 2, color: i <= current ? Brand.navy900 : c.border)),
                        Container(
                          width: 28,
                          height: 28,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i < current ? Brand.navy900 : i == current ? Brand.orange : c.surface,
                            border: i > current ? Border.all(color: c.borderStrong, width: 2) : null,
                          ),
                          child: i < current
                              ? const Icon(Icons.check, size: 16, color: Colors.white)
                              : Text('${i + 1}', style: t.labelSmall?.copyWith(fontWeight: FontWeight.w800, color: i == current ? Brand.navy950 : c.fgMuted)),
                        ),
                        Expanded(child: i == steps.length - 1 ? const SizedBox() : Container(height: 2, color: i < current ? Brand.navy900 : c.border)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      steps[i],
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      style: t.labelSmall?.copyWith(fontWeight: i == current ? FontWeight.w800 : FontWeight.w500, color: i > current ? c.fgMuted : c.fg),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A document or ticket: icon, title, meta line, optional status chip and trailing actions.
class DocumentCard extends StatelessWidget {
  const DocumentCard({super.key, required this.title, this.meta, this.status, this.trailing, this.icon = Icons.description_outlined, this.onTap});
  final Widget title;
  final Widget? meta;
  final Widget? status;
  final Widget? trailing;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => AppCard(
    onTap: onTap,
    child: Row(
      children: [
        Icon(icon, color: Brand.navy900),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [title, ?meta]),
        ),
        if (status != null) ...[const SizedBox(width: 8), status!],
        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ],
    ),
  );
}

/// Tone and label for a verification state. The label always says it; colour only reinforces.
(XfamTone, String) verificationLook(AppL10n l, VerificationStatus s) => switch (s) {
  VerificationStatus.verified => (XfamTone.success, l.verifVerified),
  VerificationStatus.submitted => (XfamTone.info, l.verifSubmitted),
  VerificationStatus.correctionRequired => (XfamTone.warning, l.verifCorrection),
  VerificationStatus.rejected => (XfamTone.danger, l.verifRejected),
  VerificationStatus.unverified => (XfamTone.neutral, l.verifUnverified),
};

/// Identity verification state (Phase B): the state is always written out; icon and tone reinforce it.
class VerificationBadge extends StatelessWidget {
  const VerificationBadge(this.status, {super.key});
  final VerificationStatus status;

  @override
  Widget build(BuildContext context) {
    final (tone, label) = verificationLook(context.l, status);
    final icon = switch (status) {
      VerificationStatus.verified => Icons.verified_outlined,
      VerificationStatus.submitted => Icons.schedule,
      VerificationStatus.correctionRequired => Icons.edit_note,
      VerificationStatus.rejected => Icons.cancel_outlined,
      VerificationStatus.unverified => Icons.radio_button_unchecked,
    };
    return ToneChip(label, tone: tone, icon: icon);
  }
}

enum PaymentStateKind { processing, paid, failed, closed }

/// One message block for payment states. "Processing" never implies success (CLAUDE.md rule 3).
class PaymentStateBanner extends StatelessWidget {
  const PaymentStateBanner({super.key, required this.kind, required this.text});
  final PaymentStateKind kind;
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = xc(context);
    final (fg, bg, border, icon) = switch (kind) {
      PaymentStateKind.processing => (c.infoSubtleFg, c.infoSubtle, c.infoBorder, Icons.schedule),
      PaymentStateKind.paid => (c.successSubtleFg, c.successSubtle, c.successBorder, Icons.check_circle_outline),
      PaymentStateKind.failed => (c.dangerSubtleFg, c.dangerSubtle, c.dangerBorder, Icons.error_outline),
      PaymentStateKind.closed => (c.warningSubtleFg, c.warningSubtle, c.warningBorder, Icons.lock_outline),
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        key: Key('pay-banner-${kind.name}'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: bg, border: Border.all(color: border), borderRadius: BorderRadius.circular(12)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: fg),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: fg))),
          ],
        ),
      ),
    );
  }
}

