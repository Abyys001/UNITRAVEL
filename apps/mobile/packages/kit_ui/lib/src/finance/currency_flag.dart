import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:kit_ui/src/finance/currency_flag_catalog.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Renders a currency's circle flag from the app's own asset bundle (apps
/// copy `assets/flags/circle-flags/*.svg` from the kit in). Falls back to
/// [CurrencyFlagCatalog.fallbackFlag] (`xx`) when [currencyCode] is unknown
/// or the SVG fails to load.
class CurrencyFlag extends StatelessWidget {
  const CurrencyFlag({
    super.key,
    required this.currencyCode,
    required this.catalog,
    this.size = XfamSize.flagMd,
    this.assetsBasePath = 'assets/flags/circle-flags/',
  });

  final String currencyCode;
  final CurrencyFlagCatalog catalog;
  final double size;
  final String assetsBasePath;

  @override
  Widget build(BuildContext context) {
    final flag = catalog.flagFor(currencyCode);
    return Semantics(
      label: currencyCode,
      image: true,
      child: SvgPicture.asset(
        '$assetsBasePath$flag.svg',
        width: size,
        height: size,
        placeholderBuilder: (_) => _fallback(context),
        errorBuilder: (_, _, _) => SvgPicture.asset(
          '$assetsBasePath${catalog.fallbackFlag}.svg',
          width: size,
          height: size,
          errorBuilder: (_, _, _) => _fallback(context),
        ),
      ),
    );
  }

  Widget _fallback(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: colors.neutralSubtle,
      child: Icon(
        Icons.help_outline,
        size: size * 0.6,
        color: colors.neutralSubtleFg,
      ),
    );
  }
}
