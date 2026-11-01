import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_error.dart';
import '../../core/billing.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/billing.dart';
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
                padding: navInset(context, const EdgeInsets.all(16)),
                children: [
                  Text(l.billingIntro),
                  const _Purchasable(),
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

/// "Available to pay": invoices the customer can pay and quotes they can still accept (`GET /v1/billing/purchasable`). The
/// server decides what is listed; a failure hides the section rather than blocking the documents below it.
class _Purchasable extends ConsumerWidget {
  const _Purchasable();

  String _requestRoute(PurchasableItem i) => i.productType == 'SERVICE'
      ? '/services/${i.requestRef}'
      : '/requests/${i.requestRef}';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final t = Theme.of(context).textTheme;
    final items =
        ref.watch(purchasableProvider).asData?.value ??
        const <PurchasableItem>[];
    if (items.isEmpty) return const SizedBox.shrink();
    String day(DateTime? d) =>
        d == null ? '' : formatDate(d.toLocal(), lang: lang, jalali: jalali);
    return Column(
      key: const Key('purchasable'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(l.ppAvailable),
        Text(
          l.ppAvailableLead,
          style: t.bodySmall?.copyWith(color: Brand.steel),
        ),
        const SizedBox(height: 8),
        for (final i in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: AppCard(
              key: Key('purchasable-${i.number}'),
              onTap: () => context.push(
                i.isPay
                    ? '/account/billing/${i.number}/payment'
                    : _requestRoute(i),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(i.title, style: t.titleSmall),
                        const SizedBox(height: 2),
                        Wrap(
                          spacing: 8,
                          children: [
                            ToneChip(
                              i.isPay ? l.ppKindInvoice : l.ppKindQuote,
                              tone: i.isPay ? XfamTone.warning : XfamTone.info,
                            ),
                            LtrText(i.number, mono: true, style: t.bodySmall),
                            if (i.dueAt != null)
                              Text(
                                i.isPay
                                    ? l.ppPayBy(day(i.dueAt))
                                    : l.quoteValidUntil(day(i.dueAt)),
                                style: t.bodySmall?.copyWith(
                                  color: Brand.steel,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(formatMoney(i.amount, lang), style: t.titleMedium),
                      const SizedBox(height: 4),
                      Text(
                        i.isPay ? l.ppActionPay : l.ppActionAccept,
                        style: t.labelMedium?.copyWith(color: Brand.royal),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// The invoice payment page (`GET /v1/billing/invoices/:number/payment-page`): issuer, lines, total, state and either the
/// online pay button or the offline instructions, exactly as the server sent them. Paying settles the invoice only; the request
/// keeps its own status (CLAUDE.md rule 3), so nothing here says "booked".
class PaymentPageScreen extends ConsumerWidget {
  const PaymentPageScreen({super.key, required this.number});
  final String number;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(paymentPageProvider(number));
    final t = Theme.of(context).textTheme;
    String day(DateTime? d) =>
        d == null ? '' : formatDate(d.toLocal(), lang: lang, jalali: jalali);
    return Scaffold(
      appBar: AppBar(title: Text(l.ppTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 2),
          error: (e, _) => e is ApiException && e.status == 404
              ? Center(child: Text(l.billingNotFound))
              : ErrorBox(
                  e,
                  onRetry: () => ref.invalidate(paymentPageProvider(number)),
                ),
          data: (p) {
            final issuer = p.issuer;
            return ListView(
              padding: navInset(context, const EdgeInsets.all(16)),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: LtrText(
                        p.invoiceNumber,
                        style: t.headlineSmall,
                        mono: true,
                      ),
                    ),
                    ToneChip(
                      invoiceStatusLabel(l, p.status),
                      tone: invoiceTone(p.status),
                    ),
                  ],
                ),
                Text(
                  [
                    digits(p.requestRef, lang),
                    if (p.issuedAt != null) l.billingIssuedOn(day(p.issuedAt)),
                  ].join(sep(lang)),
                  style: t.bodySmall?.copyWith(color: Brand.steel),
                ),
                if (p.status == 'ISSUED' && p.dueAt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(l.ppDue(day(p.dueAt)), style: t.bodySmall),
                  ),
                if (p.status == 'PAID')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: PaymentStateBanner(
                      kind: PaymentStateKind.paid,
                      text: p.paidAt == null
                          ? l.billingPaidBanner
                          : '${l.billingPaidBanner} ${l.ppPaidOn(day(p.paidAt))}',
                    ),
                  ),
                if (p.status == 'CANCELLED')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      l.cancelReasonOther,
                      key: const Key('pp-cancelled'),
                    ),
                  ),
                SectionTitle(l.ppIssuedBy),
                Text(issuer.name, style: t.titleSmall),
                if (issuer.address.isNotEmpty) Text(issuer.address),
                if (issuer.phone.isNotEmpty) LtrText(issuer.phone),
                if (issuer.email.isNotEmpty) LtrText(issuer.email),
                if (issuer.registration.isNotEmpty)
                  Text(
                    l.ppRegistration(issuer.registration),
                    style: t.bodySmall?.copyWith(color: Brand.steel),
                  ),
                if (issuer.vatNumber != null)
                  Text(
                    l.ppVat(issuer.vatNumber!),
                    style: t.bodySmall?.copyWith(color: Brand.steel),
                  ),
                if (p.customerName.isNotEmpty) ...[
                  SectionTitle(l.ppBilledTo),
                  Text(p.customerName),
                ],
                SectionTitle(l.billingCharges),
                for (final line in p.lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            line.quantity > 1
                                ? '${line.description} × ${digits('${line.quantity}', lang)}'
                                : line.description,
                          ),
                        ),
                        Text(formatMoney(line.amount, lang)),
                      ],
                    ),
                  ),
                const Divider(),
                Row(
                  children: [
                    Expanded(child: Text(l.billingTotal, style: t.titleMedium)),
                    Text(
                      formatMoney(p.total, lang),
                      style: t.titleMedium,
                      key: const Key('pp-total'),
                    ),
                  ],
                ),
                if (p.canPayOnline) ...[
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    key: const Key('pp-pay-online'),
                    icon: const Icon(Icons.credit_card),
                    label: Text(l.billingPayOnline),
                    onPressed: () async {
                      final uri = Uri.tryParse(p.payUrl!);
                      final ok =
                          uri != null &&
                          (uri.scheme == 'https' || uri.scheme == 'http') &&
                          await launchUrl(
                            uri,
                            mode: LaunchMode.externalApplication,
                          );
                      if (!ok && context.mounted) {
                        showMessage(context, l.billingOpenFailed, error: true);
                      }
                    },
                  ),
                  const SizedBox(height: 6),
                  Text(
                    l.billingPayOnlineNote,
                    style: t.bodySmall?.copyWith(color: Brand.steel),
                  ),
                ] else if (p.status == 'ISSUED') ...[
                  SectionTitle(l.ppOfflineTitle),
                  AppCard(
                    key: const Key('pp-offline'),
                    child: Text(p.offlineInstructions ?? l.ppOfflineNone),
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  l.ppNotBooking,
                  style: t.bodySmall?.copyWith(color: Brand.steel),
                ),
                Wrap(
                  spacing: 8,
                  children: [
                    TextButton(
                      key: const Key('pp-view-request'),
                      onPressed: () => context.push(
                        p.productType == 'SERVICE'
                            ? '/services/${p.requestRef}'
                            : '/requests/${p.requestRef}',
                      ),
                      child: Text(l.ppViewRequest),
                    ),
                    if (p.pdfDocumentId != null)
                      TextButton(
                        onPressed: () =>
                            openDocument(context, ref, p.pdfDocumentId!),
                        child: Text(l.billingDownload),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
