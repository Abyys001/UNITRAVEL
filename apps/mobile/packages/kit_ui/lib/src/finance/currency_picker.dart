import 'package:flutter/material.dart';
import 'package:kit_ui/src/finance/currency_flag.dart';
import 'package:kit_ui/src/finance/currency_flag_catalog.dart';
import 'package:kit_ui/src/overlays/xfam_bottom_sheet.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// One selectable entry in [CurrencyPicker] — code plus the caller-localized
/// display name (the kit never hardcodes currency names).
class CurrencyOption {
  const CurrencyOption({required this.code, required this.displayName});

  final String code;
  final String displayName;
}

/// Searchable bottom-sheet currency list. Call [CurrencyPicker.show] to open
/// it; returns the selected [CurrencyOption.code], or `null` if dismissed.
class CurrencyPicker extends StatefulWidget {
  const CurrencyPicker({
    super.key,
    required this.options,
    required this.catalog,
    this.searchHint = 'Search currency',
    this.emptyLabel = 'No currencies found',
  });

  final List<CurrencyOption> options;
  final CurrencyFlagCatalog catalog;
  final String searchHint;
  final String emptyLabel;

  static Future<String?> show(
    BuildContext context, {
    required List<CurrencyOption> options,
    required CurrencyFlagCatalog catalog,
    String searchHint = 'Search currency',
    String emptyLabel = 'No currencies found',
  }) {
    return showXfamBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => CurrencyPicker(
        options: options,
        catalog: catalog,
        searchHint: searchHint,
        emptyLabel: emptyLabel,
      ),
    );
  }

  @override
  State<CurrencyPicker> createState() => _CurrencyPickerState();
}

class _CurrencyPickerState extends State<CurrencyPicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.options.where((o) {
      final q = _query.trim().toLowerCase();
      if (q.isEmpty) return true;
      return o.code.toLowerCase().contains(q) ||
          o.displayName.toLowerCase().contains(q);
    }).toList();

    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.75,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              XfamSpace.s4,
              XfamSpace.s2,
              XfamSpace.s4,
              XfamSpace.s2,
            ),
            child: TextField(
              decoration: InputDecoration(
                hintText: widget.searchHint,
                prefixIcon: const Icon(Icons.search),
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
          ),
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Text(
                      widget.emptyLabel,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  )
                : ListView.builder(
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final option = filtered[index];
                      return ListTile(
                        minVerticalPadding: XfamSpace.s3,
                        leading: CurrencyFlag(
                          currencyCode: option.code,
                          catalog: widget.catalog,
                        ),
                        title: Text(option.displayName),
                        trailing: Text(
                          option.code,
                          style: Theme.of(context).textTheme.labelMedium,
                        ),
                        onTap: () => Navigator.of(context).pop(option.code),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
