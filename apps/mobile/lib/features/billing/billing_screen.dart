import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_error.dart';
import '../../core/billing.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../ui/patterns.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Opens a document through a short-lived signed URL issued after the API's ownership check (ch. 24.3).
Future<void> openDocument(BuildContext context, WidgetRef ref, String documentId) async {
  final l = context.l;
  try {
    final r = await ref.read(apiClientProvider).get('/v1/documents/$documentId/download') as Map<String, dynamic>;
    final ok = await launchUrl(Uri.parse(r['url'] as String), mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) showMessage(context, l.billingOpenFailed, error: true);
  } on ApiException {
    if (context.mounted) showMessage(context, l.billingOpenFailed, error: true);
  }
}

/// Documents & billing (ADR-0006): own invoices and quotations. Amounts appear on invoices only.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final docs = ref.watch(billingProvider);
    final t = Theme.of(context).textTheme;
    String day(DateTime? d) => d == null ? '' : formatDate(d.toLocal(), lang: lang, jalali: jalali);
    return Scaffold(
      appBar: AppBar(title: Text(l.billingTitle)),
      body: PageBody(
        child: docs.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(billingProvider)),
          data: (cached) {
            final d = cached.data;
            return RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(billingProvider);
                await ref.read(billingProvider.future);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(l.billingIntro),
                  SectionTitle(l.billingInvoices),
                  if (d.invoices.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(l.billingEmptyInvoices, textAlign: TextAlign.center)),
                  for (final i in d.invoices)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppCard(
                        key: Key('invoice-${i.number}'),
                        onTap: () => context.push('/account/billing/${i.number}'),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  LtrText(i.number, style: t.titleMedium, mono: true),
                                  Text([digits(i.requestRef, lang), l.billingIssuedOn(day(i.issuedAt))].join(sep(lang)), style: t.bodySmall?.copyWith(color: Brand.steel)),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [Text(formatMoney(i.total, lang), style: t.titleMedium), const SizedBox(height: 4), ToneChip(invoiceStatusLabel(l, i.status), tone: invoiceTone(i.status))],
                            ),
                          ],
                        ),
                      ),
                    ),
                  SectionTitle(l.billingQuotations),
                  if (d.quotations.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(l.billingEmptyQuotations, textAlign: TextAlign.center)),
                  for (final q in d.quotations)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppCard(
                        key: Key('quotation-${q.number}'),
                        onTap: () => context.push('/requests/${q.requestRef}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [Expanded(child: LtrText(q.number, style: t.titleMedium, mono: true)), ToneChip(quoteStatusLabel(l, q.status))]),
                            Text([digits(q.requestRef, lang), l.billingSentOn(day(q.sentAt))].join(sep(lang)), style: t.bodySmall?.copyWith(color: Brand.steel)),
                            Row(
                              children: [
                                TextButton(onPressed: () => context.push('/requests/${q.requestRef}'), child: Text(l.billingViewQuote)),
                                if (q.documentId != null) TextButton(onPressed: () => openDocument(context, ref, q.documentId!), child: Text(l.billingDownload)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// One invoice: lines, total, state and, when cancelled, the line that says not to pay it. Also the target of the emailed link.
class InvoiceScreen extends ConsumerWidget {
  const InvoiceScreen({super.key, required this.number});
  final String number;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final inv = ref.watch(invoiceProvider(number));
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(l.billingTitle)),
      body: PageBody(
        child: inv.when(
          loading: () => const LoadingList(count: 2),
          error: (e, _) => e is ApiException && e.status == 404 ? Center(child: Text(l.billingNotFound)) : ErrorBox(e, onRetry: () => ref.invalidate(invoiceProvider(number))),
          data: (cached) {
            final i = cached.data;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(children: [Expanded(child: LtrText(i.number, style: t.headlineSmall, mono: true)), ToneChip(invoiceStatusLabel(l, i.status), tone: invoiceTone(i.status))]),
                Text([digits(i.requestRef, lang), if (i.issuedAt != null) l.billingIssuedOn(formatDate(i.issuedAt!.toLocal(), lang: lang, jalali: jalali))].join(sep(lang)), style: t.bodySmall?.copyWith(color: Brand.steel)),
                if (i.status == 'CANCELLED') Padding(padding: const EdgeInsets.only(top: 12), child: Text(cancelReasonText(l, i.cancelReason), key: const Key('cancel-reason'))),
                if (i.status == 'PAID') Padding(padding: const EdgeInsets.only(top: 12), child: PaymentStateBanner(kind: PaymentStateKind.paid, text: l.billingPaidBanner)),
                if (i.status == 'ISSUED' && i.expiresAt != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(l.billingUnpaidExpires(formatDate(i.expiresAt!.toLocal(), lang: lang, jalali: jalali)))),
                SectionTitle(l.billingCharges),
                for (final line in i.lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(children: [Expanded(child: Text(line.quantity > 1 ? '${line.description} × ${digits('${line.quantity}', lang)}' : line.description)), Text(formatMoney(line.amount, lang))]),
                  ),
                const Divider(),
                Row(children: [Expanded(child: Text(l.billingTotal, style: t.titleMedium)), Text(formatMoney(i.total, lang), style: t.titleMedium, key: const Key('invoice-total'))]),
                if (i.status == 'ISSUED') _PayOnline(number: i.number),
                if (i.status == 'ISSUED') Padding(padding: const EdgeInsets.only(top: 12), child: Text(l.billingPayNote, style: t.bodySmall?.copyWith(color: Brand.steel))),
                if (i.documentId != null) Padding(padding: const EdgeInsets.only(top: 20), child: FilledButton(onPressed: () => openDocument(context, ref, i.documentId!), child: Text(l.billingDownload))),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Card payment happens on the website (ADR-0007, decision 8): the button opens its pay page in the system browser. The app holds no Stripe key and no card form.
class _PayOnline extends ConsumerWidget {
  const _PayOnline({required this.number});
  final String number;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final t = Theme.of(context).textTheme;
    final pay = ref.watch(invoicePaymentProvider(number)).asData?.value;
    if (pay == null) return const SizedBox.shrink();
    if (pay.processing) return Padding(padding: const EdgeInsets.only(top: 12), child: KeyedSubtree(key: const Key('pay-processing'), child: PaymentStateBanner(kind: PaymentStateKind.processing, text: l.billingPayProcessing)));
    if (!pay.offered) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FilledButton.icon(
            key: const Key('pay-online'),
            icon: const Icon(Icons.credit_card),
            label: Text(l.billingPayOnline),
            onPressed: () async {
              final ok = await launchUrl(payPageUri(number, context.lang), mode: LaunchMode.externalApplication);
              if (!ok && context.mounted) showMessage(context, l.billingOpenFailed, error: true);
            },
          ),
          const SizedBox(height: 6),
          Text(l.billingPayOnlineNote, style: t.bodySmall?.copyWith(color: Brand.steel)),
        ],
      ),
    );
  }
}

/// The website's pay page for an invoice, in the app's language; the site asks for sign-in if the browser has none.
Uri payPageUri(String number, String lang) => Uri.parse('${AppConfig.webUrl}/$lang/billing/${Uri.encodeComponent(number)}/pay');
