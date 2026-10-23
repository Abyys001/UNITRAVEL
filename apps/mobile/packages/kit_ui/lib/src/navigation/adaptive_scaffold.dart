import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// One navigation destination, shared between the compact bottom bar and the
/// medium/expanded rail.
class XfamDestination {
  const XfamDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
  });

  final Widget icon;
  final Widget selectedIcon;
  final String label;
}

/// Material 3 adaptive navigation shell: bottom [NavigationBar] below
/// [XfamBreakpoint.m3Medium], [NavigationRail] at/above it. `body` is built
/// per-index via [bodyBuilder] so it works directly with go_router's
/// `StatefulNavigationShell` (pass `shell.goBranch` as [onDestinationSelected]
/// and `shell` as [bodyBuilder]'s return value) without the kit depending on
/// go_router — see README.md for the wiring snippet.
class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({
    super.key,
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.bodyBuilder,
    this.railTrailing,
    this.appBar,
  });

  final List<XfamDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final WidgetBuilder bodyBuilder;
  final Widget? railTrailing;
  final PreferredSizeWidget? appBar;

  bool _isCompact(double width) => width < XfamBreakpoint.m3Medium;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = _isCompact(constraints.maxWidth);
        final body = Builder(builder: bodyBuilder);

        if (isCompact) {
          return Scaffold(
            appBar: appBar,
            body: body,
            bottomNavigationBar: NavigationBar(
              selectedIndex: selectedIndex,
              onDestinationSelected: onDestinationSelected,
              destinations: [
                for (final d in destinations)
                  NavigationDestination(
                    icon: d.icon,
                    selectedIcon: d.selectedIcon,
                    label: d.label,
                  ),
              ],
            ),
          );
        }

        return Scaffold(
          appBar: appBar,
          body: Row(
            children: [
              NavigationRail(
                extended: constraints.maxWidth >= XfamBreakpoint.m3Expanded,
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
                trailing: railTrailing == null
                    ? null
                    : Expanded(
                        child: Align(
                          alignment: Alignment.bottomCenter,
                          child: railTrailing,
                        ),
                      ),
                destinations: [
                  for (final d in destinations)
                    NavigationRailDestination(
                      icon: d.icon,
                      selectedIcon: d.selectedIcon,
                      label: Text(d.label),
                    ),
                ],
              ),
              const VerticalDivider(width: 1),
              Expanded(child: body),
            ],
          ),
        );
      },
    );
  }
}
