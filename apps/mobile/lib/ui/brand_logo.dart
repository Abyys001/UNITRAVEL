import 'package:flutter/material.dart';

import 'theme.dart';

/// Brand lockup: mark, "UNI TRAVEL" (Montserrat 800) and the Persian name beneath.
/// [onDark] picks the colourway for navy surfaces; otherwise it is for light ones.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.onDark = false, this.markSize = 44, this.showPersian = true});
  final bool onDark;
  final double markSize;
  final bool showPersian;

  @override
  Widget build(BuildContext context) {
    final onDark = this.onDark || isDark(context);
    final uni = onDark ? Colors.white : Brand.navy950;
    final travel = onDark ? Brand.sky : Brand.royal;
    // orange-700 is the orange that passes contrast on white (DESIGN.md).
    final fa = onDark ? Brand.orange : Brand.orange700;
    final size = markSize * 0.4;
    return Semantics(
      label: 'UNI TRAVEL',
      image: true,
      child: ExcludeSemantics(
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset('assets/brand/mark.png', width: markSize, height: markSize, filterQuality: FilterQuality.medium),
              SizedBox(width: markSize * 0.22),
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(text: 'UNI ', style: TextStyle(color: uni)),
                        TextSpan(text: 'TRAVEL', style: TextStyle(color: travel)),
                      ],
                    ),
                    style: TextStyle(fontFamily: 'Montserrat', fontWeight: FontWeight.w800, fontSize: size, height: 1.1, letterSpacing: size * 0.08),
                  ),
                  if (showPersian)
                    Text(
                      'یونی تراول',
                      textDirection: TextDirection.rtl,
                      style: TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w700, fontSize: size * 0.85, height: 1.3, color: fa),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
