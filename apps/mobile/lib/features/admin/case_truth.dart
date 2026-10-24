import 'package:flutter/material.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/format.dart';
import '../../l10n/app_localizations.dart';
import '../../models/admin.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// "What we know" ladder: request, snapshot, quote, reservation, ticket and payment stay separate rungs,
/// and each supplier fact is KNOWN / NOT INCLUDED / UNKNOWN. UNKNOWN is never rendered as known (rule 3).
class CaseTruthCard extends StatelessWidget {
  const CaseTruthCard({super.key, required this.c, required this.jalali});
  final AdminCase c;
  final bool jalali;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final t = c.truth;
    final theme = Theme.of(context);
    final cc = xc(context);

    String triValue(TriFact f, String known) => switch (f.state) {
      Tri.known => f.varies ? '$known${sep(lang)}${l.truthVaries}' : known,
      Tri.notIncluded => f.varies ? l.truthVaries : '',
      Tri.unknown => l.truthUnknownValue,
    };
    String baggageKnown(TriFact f) {
      final pieces = f.pieces ?? 0;
      final base = l.baggagePieces(pieces);
      final kg = f.kg;
      return kg == null ? base : '$base${sep(lang)}${l.baggageKg(digits(kg.toStringAsFixed(kg % 1 == 0 ? 0 : 1), lang))}';
    }

    final rows = <Widget>[
      _Row(l.truthRequest, _Chip.onFile(l), staffStatusLabel(l, c.status)),
      _Row(l.truthSnapshot, t.hasSnapshot ? _Chip.onFile(l) : _Chip.none(l), t.hasSnapshot ? null : l.truthNoSnapshot),
      _Row(l.baggage, _Chip.tri(l, t.baggage.state), triValue(t.baggage, baggageKnown(t.baggage))),
      _Row(l.truthChange, _Chip.tri(l, t.change.state, notIncluded: l.condNotAllowed), triValue(t.change, l.condAllowed)),
      _Row(l.truthRefund, _Chip.tri(l, t.refund.state, notIncluded: l.condNotAllowed), triValue(t.refund, l.condAllowed)),
      _Row(
        l.truthQuote,
        t.quoteStatuses.any((s) => s != 'DRAFT') ? _Chip.onFile(l) : (t.quoteStatuses.isEmpty ? _Chip.none(l) : _Chip(l.truthDraftOnly, XfamTone.neutral)),
        t.quoteStatuses.isEmpty ? null : t.quoteStatuses.map((s) => _quoteStatus(l, s)).toSet().join(sep(lang)),
      ),
      _Row(
        l.truthReservation,
        t.reservationStatus == null ? _Chip.none(l) : _Chip.onFile(l),
        t.reservationStatus == null
            ? null
            : [
                _reservationStatus(l, t.reservationStatus!),
                if (t.ticketingDeadline != null) l.deadlineAt(formatDateTime(t.ticketingDeadline, lang: lang, jalali: jalali)),
              ].join(sep(lang)),
      ),
      _Row(l.truthTicket, t.tickets > 0 ? _Chip.onFile(l) : _Chip.none(l), t.tickets > 0 ? l.ticketCount(t.tickets) : null),
      _Row(
        l.truthPayment,
        c.paymentStatus == 'NONE' ? _Chip.none(l) : _Chip(_paymentStatus(l, c.paymentStatus), c.paymentStatus == 'PAID' ? XfamTone.success : XfamTone.info),
        null,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < rows.length; i++) ...[if (i > 0) Divider(color: cc.border), rows[i]],
        const SizedBox(height: 10),
        Text(l.truthPaymentNote, style: theme.textTheme.bodySmall?.copyWith(color: cc.fgMuted)),
        if (t.hasUnknown) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: cc.warningSubtle,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: cc.warningBorder),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.help_outline, size: 18, color: cc.warningSubtleFg),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(l.truthUnknownBlocks, style: theme.textTheme.bodySmall?.copyWith(color: cc.warningSubtleFg)),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

String _quoteStatus(AppL10n l, String s) => switch (s) {
  'DRAFT' => l.truthDraftOnly,
  'SENT' => l.quoteSent,
  'ACCEPTED' => l.quoteAccepted,
  'DECLINED' => l.quoteDeclined,
  'EXPIRED' => l.quoteExpired,
  'SUPERSEDED' => l.quoteSuperseded,
  _ => s,
};

String _reservationStatus(AppL10n l, String s) => s == 'CONFIRMED' ? l.resConfirmed : l.resHeld;

String _paymentStatus(AppL10n l, String s) => switch (s) {
  'PARTIAL' => l.payPartial,
  'PAID' => l.payPaid,
  'REFUND_PENDING' => l.payRefundPending,
  'REFUNDED' => l.payRefunded,
  _ => l.payNone,
};

class _Chip {
  const _Chip(this.label, this.tone, {this.icon});
  final String label;
  final XfamTone tone;
  final IconData? icon;

  factory _Chip.onFile(AppL10n l) => _Chip(l.truthOnFile, XfamTone.success, icon: Icons.check);
  factory _Chip.none(AppL10n l) => _Chip(l.truthNone, XfamTone.neutral);
  factory _Chip.tri(AppL10n l, Tri s, {String? notIncluded}) => switch (s) {
    Tri.known => _Chip(l.triKnown, XfamTone.success, icon: Icons.check),
    Tri.notIncluded => _Chip(notIncluded ?? l.triNotIncluded, XfamTone.neutral, icon: Icons.remove),
    Tri.unknown => _Chip(l.triUnknown, XfamTone.warning, icon: Icons.help_outline),
  };
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.chip, this.value);
  final String label;
  final _Chip chip;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '$label: ${chip.label}${value == null || value!.isEmpty ? '' : ', $value'}',
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: theme.textTheme.titleSmall),
                    if (value != null && value!.isNotEmpty) Text(value!, style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              ToneChip(chip.label, tone: chip.tone, icon: chip.icon),
            ],
          ),
        ),
      ),
    );
  }
}
