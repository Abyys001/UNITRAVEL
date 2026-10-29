import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Published content from `GET /v1/cms/*` (ADR-0017). Public and read-only; drafts never reach the app, an error shows
/// an empty state rather than invented text.
final guidesProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, lang) async {
  final j = await ref.watch(apiClientProvider).getJson('/v1/cms/entries', query: {'locale': lang, 'pageSize': 50}, auth: false);
  return [for (final e in (j['items'] as List? ?? const [])) if (e is Map<String, dynamic>) e];
});

final guideProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, (String, String, String)>((ref, k) async {
  return ref.watch(apiClientProvider).getJson('/v1/cms/entries/${k.$1}/${k.$2}', query: {'locale': k.$3}, auth: false);
});

final glossaryProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final list = await ref.watch(apiClientProvider).get('/v1/cms/glossary', auth: false);
  return [for (final e in (list as List? ?? const [])) if (e is Map<String, dynamic>) e];
});

class GuidesScreen extends ConsumerWidget {
  const GuidesScreen({super.key, required this.onOpen});
  final void Function(String kind, String slug) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final items = ref.watch(guidesProvider(lang));
    return Scaffold(
      appBar: AppBar(title: Text(l.learnTitle)),
      body: PageBody(
        child: items.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(guidesProvider(lang))),
          data: (list) => list.isEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l.learnEmpty, textAlign: TextAlign.center)))
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    final e = list[i];
                    return AppCard(
                      semanticLabel: e['title'] as String?,
                      onTap: () => onOpen(e['kind'] as String? ?? 'ARTICLE', e['slug'] as String),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (e['category'] != null) Text('${e['category']}', style: Theme.of(context).textTheme.labelMedium?.copyWith(color: accentText(context))),
                        Text('${e['title']}', style: Theme.of(context).textTheme.titleMedium),
                        if ((e['summary'] as String? ?? '').isNotEmpty) ...[const SizedBox(height: 4), Text('${e['summary']}')],
                      ]),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

class GuideScreen extends ConsumerWidget {
  const GuideScreen({super.key, required this.kind, required this.slug});
  final String kind;
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final entry = ref.watch(guideProvider((kind, slug, context.lang)));
    return Scaffold(
      appBar: AppBar(title: Text(l.learnTitle)),
      body: PageBody(
        child: entry.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(guideProvider)),
          data: (e) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('${e['title']}', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              ..._markdown(context, '${e['bodyMd'] ?? ''}'),
            ],
          ),
        ),
      ),
    );
  }
}

/// Minimal Markdown for the CMS subset: headings, bullets, tables as rows, paragraphs. Nothing is interpreted as markup
/// beyond that, so content cannot inject widgets or links.
List<Widget> _markdown(BuildContext context, String md) {
  final t = Theme.of(context).textTheme;
  final out = <Widget>[];
  for (final raw in md.split('\n')) {
    final line = raw.trimRight();
    if (line.isEmpty || RegExp(r'^\|?[\s:|-]+\|?$').hasMatch(line)) continue;
    final plain = line.replaceAll('**', '').replaceAll('__', '');
    if (line.startsWith('### ')) {
      out.add(Padding(padding: const EdgeInsets.only(top: 12, bottom: 4), child: Text(plain.substring(4), style: t.titleSmall)));
    } else if (line.startsWith('## ') || line.startsWith('# ')) {
      out.add(Padding(padding: const EdgeInsets.only(top: 16, bottom: 4), child: Text(plain.replaceFirst(RegExp(r'^#+ '), ''), style: t.titleMedium)));
    } else if (RegExp(r'^\s*[-*] ').hasMatch(line)) {
      out.add(Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('•  '), Expanded(child: Text(plain.replaceFirst(RegExp(r'^\s*[-*] '), '')))])));
    } else if (line.startsWith('|')) {
      out.add(Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(plain.split('|').map((c) => c.trim()).where((c) => c.isNotEmpty).join('  ·  '))));
    } else {
      out.add(Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(plain, style: t.bodyMedium)));
    }
  }
  return out;
}

class GlossaryScreen extends ConsumerStatefulWidget {
  const GlossaryScreen({super.key});

  @override
  ConsumerState<GlossaryScreen> createState() => _GlossaryScreenState();
}

class _GlossaryScreenState extends ConsumerState<GlossaryScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final terms = ref.watch(glossaryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.glossaryTitle)),
      body: PageBody(
        child: terms.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(glossaryProvider)),
          data: (all) {
            final q = _q.trim().toLowerCase();
            final list = q.isEmpty ? all : all.where((e) => '${e['termFa']} ${e['termEn']} ${e['explanationFa']}'.toLowerCase().contains(q)).toList();
            return Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: TextField(
                  decoration: InputDecoration(prefixIcon: const Icon(Icons.search), labelText: l.glossarySearch),
                  onChanged: (v) => setState(() => _q = v),
                ),
              ),
              Expanded(
                child: list.isEmpty
                    ? Center(child: Text(l.learnEmpty))
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        itemCount: list.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (_, i) {
                          final e = list[i];
                          return AppCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('${e['termFa']}', style: Theme.of(context).textTheme.titleMedium),
                              LtrText('${e['termEn']}', style: Theme.of(context).textTheme.labelLarge?.copyWith(color: accentText(context))),
                              const SizedBox(height: 4),
                              Text('${e['explanationFa']}'),
                            ]),
                          );
                        },
                      ),
              ),
            ]);
          },
        ),
      ),
    );
  }
}
