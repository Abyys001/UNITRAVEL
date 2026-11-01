import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';
import 'widgets.dart';

/// One tab. [icon] / [selectedIcon] may already carry a Badge.
class GlassNavItem {
  const GlassNavItem({
    required this.icon,
    required this.label,
    this.selectedIcon,
  });
  final Widget icon;
  final Widget? selectedIcon;
  final String label;
}

const _barHeight = 64.0;
const _barRadius = 28.0;
const _slide = Duration(milliseconds: 250);

/// Floating liquid-glass tab bar (DESIGN.md "Glass"): inset from the edges and the safe area, one blur layer,
/// a specular top edge and an indicator that slides between tabs. Use as `Scaffold.bottomNavigationBar` with
/// `extendBody: true`; the Scaffold then reports the bar height through `MediaQuery.padding.bottom` so scrollables
/// can pad themselves (see [navInset]). RTL: tabs and indicator follow the ambient Directionality.
class GlassNavBar extends StatelessWidget {
  const GlassNavBar({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
  }) : assert(items.length >= 2);
  final List<GlassNavItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final dark = isDark(context);
    final opaque = glassOpaque(context);
    final n = items.length;
    final c = xc(context);
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : _slide;
    final indicator = Brand.orange.withValues(alpha: dark ? 0.30 : 0.28);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Center(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SizedBox(
              height: _barHeight,
              child: GlassPanel(
                radius: BorderRadius.circular(_barRadius),
                blur: 14,
                fill: dark ? 0.66 : 0.74,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // Selected-tab pill: one AnimatedAlign, so it slides instead of re-fading per tab.
                    ExcludeSemantics(
                      child: AnimatedAlign(
                        duration: duration,
                        curve: Curves.easeOutCubic,
                        alignment: AlignmentDirectional(
                          -1 + 2 * selectedIndex / (n - 1),
                          0,
                        ),
                        child: FractionallySizedBox(
                          widthFactor: 1 / n,
                          heightFactor: 1,
                          child: Padding(
                            padding: const EdgeInsets.all(5),
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: indicator,
                                borderRadius: BorderRadius.circular(
                                  _barRadius - 5,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Material(
                      // Transparent Material: ink paints inside the pane, not on the Scaffold's opaque one beneath it.
                      type: MaterialType.transparency,
                      child: Row(
                        children: [
                          for (var i = 0; i < n; i++)
                            Expanded(
                              child: _Tab(
                                item: items[i],
                                selected: i == selectedIndex,
                                index: i,
                                count: n,
                                color: i == selectedIndex ? c.fg : c.fgMuted,
                                onTap: () {
                                  HapticFeedback.selectionClick();
                                  onSelected(i);
                                },
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (!opaque)
                      const Positioned(
                        top: 0,
                        left: 20,
                        right: 20,
                        height: 1,
                        child: ExcludeSemantics(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Color(0x00FFFFFF),
                                  Color(0xE6FFFFFF),
                                  Color(0x00FFFFFF),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    required this.item,
    required this.selected,
    required this.index,
    required this.count,
    required this.color,
    required this.onTap,
  });
  final GlassNavItem item;
  final bool selected;
  final int index;
  final int count;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.labelSmall?.copyWith(
      color: color,
      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
    );
    return Semantics(
      container: true,
      button: true,
      selected: selected,
      hint: MaterialLocalizations.of(context)
          .tabLabel(tabIndex: index + 1, tabCount: count),
      child: InkWell(
        key: Key('nav-tab-$index'),
        borderRadius: BorderRadius.circular(_barRadius - 5),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconTheme.merge(
                data: IconThemeData(color: color, size: 24),
                child: selected ? (item.selectedIcon ?? item.icon) : item.icon,
              ),
              const SizedBox(height: 2),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  item.label,
                  style: style,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
