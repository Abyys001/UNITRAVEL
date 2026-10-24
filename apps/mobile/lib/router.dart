import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/repos.dart';
import 'core/session.dart';
import 'features/account/account_screen.dart';
import 'features/account/details_screen.dart';
import 'features/admin/admin_providers.dart';
import 'features/admin/admin_search_screen.dart';
import 'features/admin/case_screen.dart';
import 'features/admin/home_screen.dart';
import 'features/admin/queue_screen.dart';
import 'features/auth/profile_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/cargo/cargo_screens.dart';
import 'features/billing/billing_screen.dart';
import 'features/cargo/shipments_screen.dart';
import 'features/inbox/inbox_screen.dart';
import 'features/requests/request_detail_screen.dart';
import 'features/requests/request_form_screen.dart';
import 'features/requests/requests_screen.dart';
import 'features/search/itinerary_screen.dart';
import 'features/search/results_screen.dart';
import 'features/search/search_screen.dart';
import 'ui/brand_logo.dart';
import 'ui/theme.dart';
import 'ui/widgets.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// Where a signed-in user lands, by mode (`/me` -> `surfaces.admin`, ch. 10.5).
String homeFor(SessionState s) => s.isAdminMode ? '/admin/home' : '/search';

/// Pure redirect rules, kept separate so they can be unit tested.
String? redirectFor(SessionState s, Uri uri) {
  final loc = uri.path;
  final full = uri.toString();
  switch (s.status) {
    case AuthStatus.booting:
      return loc == '/splash' ? null : '/splash?from=${Uri.encodeComponent(full)}';
    case AuthStatus.signedOut:
      if (loc == '/signin') return null;
      return loc == '/' || loc == '/splash' ? '/signin' : '/signin?from=${Uri.encodeComponent(full)}';
    case AuthStatus.signedIn:
      final me = s.me!;
      if (!me.admin && (me.givenNamesLatin == null || me.givenNamesLatin!.isEmpty)) {
        return loc == '/profile' ? null : '/profile';
      }
      if (loc == '/signin' || loc == '/splash' || loc == '/' || loc == '/profile') {
        final from = uri.queryParameters['from'];
        if (from != null && from.startsWith('/') && !from.startsWith('//')) return from;
        return homeFor(s);
      }
      if (s.isAdminMode) {
        final m = RegExp(r'^/requests/(UT-[A-Za-z]-[A-Za-z0-9]{6})$').firstMatch(loc);
        if (m != null) return '/admin/case/${m[1]}';
        return loc.startsWith('/admin') ? null : '/admin/home';
      }
      // The link in an invoice email or SMS uses the web path; signed in, it lands on the invoice screen.
      final inv = RegExp(r'^/billing/([A-Za-z]{1,6}-\d{4}-\d{6})$').firstMatch(loc);
      if (inv != null) return '/account/billing/${inv[1]}';
      return loc.startsWith('/admin') ? '/search' : null;
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  CustomTransitionPage<void> page(GoRouterState state, Widget child) => CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionsBuilder: (_, a, _, c) => FadeTransition(opacity: a, child: c),
  );

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(ref.read(sessionProvider), state.uri),
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _Splash()),
      GoRoute(path: '/splash', builder: (_, _) => const _Splash()),
      GoRoute(path: '/signin', builder: (_, _) => const SignInScreen()),
      GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen()),
      // --- customer mode ---
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _Shell(shell: shell, admin: false),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/search',
                builder: (_, _) => const SearchScreen(),
                routes: [
                  GoRoute(
                    path: 'results/:id',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => ResultsScreen(searchId: s.pathParameters['id']!),
                  ),
                  GoRoute(
                    path: 'itinerary/:id',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => ItineraryScreen(itineraryId: s.pathParameters['id']!),
                  ),
                  GoRoute(
                    path: 'request',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => RequestFormScreen(
                      searchId: s.uri.queryParameters['search'] ?? '',
                      itineraryId: s.uri.queryParameters['itinerary'],
                    ),
                  ),
                  GoRoute(
                    path: 'manual/:id',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => RequestFormScreen(searchId: s.pathParameters['id']!),
                  ),
                  GoRoute(
                    path: 'done/:ref',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => ConfirmationScreen(requestRef: s.pathParameters['ref']!),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/requests',
                builder: (_, _) => const RequestsScreen(),
                routes: [
                  GoRoute(
                    path: ':ref',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => RequestDetailScreen(requestRef: s.pathParameters['ref']!.toUpperCase()),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/cargo',
                builder: (_, _) => const CargoScreen(),
                routes: [
                  GoRoute(
                    path: 'shipments',
                    parentNavigatorKey: _rootKey,
                    builder: (_, _) => const ShipmentsScreen(),
                  ),
                  GoRoute(
                    path: 'new',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => CargoRequestScreen(laneId: s.uri.queryParameters['lane'] ?? ''),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(routes: [GoRoute(path: '/inbox', builder: (_, _) => const InboxScreen())]),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/account',
                builder: (_, _) => const AccountScreen(),
                routes: [
                  GoRoute(path: 'details', parentNavigatorKey: _rootKey, builder: (_, _) => const DetailsScreen()),
                  GoRoute(
                    path: 'billing',
                    parentNavigatorKey: _rootKey,
                    builder: (_, _) => const BillingScreen(),
                    routes: [GoRoute(path: ':number', parentNavigatorKey: _rootKey, builder: (_, s) => InvoiceScreen(number: s.pathParameters['number']!.toUpperCase()))],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      // --- admin mode ---
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _Shell(shell: shell, admin: true),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/admin/home', builder: (_, _) => const AdminHomeScreen())]),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/admin/queue',
                builder: (_, s) => QueueScreen(initialTab: s.uri.queryParameters['tab'] ?? 'new'),
                routes: [
                  GoRoute(
                    path: 'case/:ref',
                    parentNavigatorKey: _rootKey,
                    pageBuilder: (_, s) => page(s, CaseScreen(requestRef: s.pathParameters['ref']!.toUpperCase())),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(routes: [GoRoute(path: '/admin/search', builder: (_, _) => const AdminSearchScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/admin/inbox', builder: (_, _) => const InboxScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/admin/account', builder: (_, _) => const AccountScreen())]),
        ],
      ),
      GoRoute(
        path: '/admin/case/:ref',
        parentNavigatorKey: _rootKey,
        builder: (_, s) => CaseScreen(requestRef: s.pathParameters['ref']!.toUpperCase()),
      ),
    ],
  );
});

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const BrandLogo(markSize: 72),
          const SizedBox(height: 28),
          Semantics(label: context.l.loading, child: const CircularProgressIndicator()),
        ],
      ),
    ),
  );
}

class _Shell extends ConsumerStatefulWidget {
  const _Shell({required this.shell, required this.admin});
  final StatefulNavigationShell shell;
  final bool admin;

  @override
  ConsumerState<_Shell> createState() => _ShellState();
}

class _ShellState extends ConsumerState<_Shell> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // Counts and SLA breaches move with the clock, so staff badges refresh once a minute (the console does the same).
    if (widget.admin) _poll = Timer.periodic(const Duration(seconds: 60), (_) => ref.invalidate(queueSummaryProvider));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Widget _badged(int n, Widget icon, {Color? color}) => n > 0
      ? Badge(label: Text(n > 99 ? '99+' : '$n'), backgroundColor: color, child: icon)
      : icon;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final shell = widget.shell;
    final unread = ref.watch(inboxProvider).value?.data.unread ?? 0;
    final inboxIcon = _badged(unread, const Icon(Icons.notifications_none));

    final destinations = widget.admin
        ? () {
            final s = ref.watch(queueSummaryProvider).value;
            return [
              NavigationDestination(
                icon: _badged(s?.slaBreaches ?? 0, const Icon(Icons.dashboard_outlined), color: xc(context).danger),
                selectedIcon: _badged(s?.slaBreaches ?? 0, const Icon(Icons.dashboard), color: xc(context).danger),
                label: l.navHome,
              ),
              NavigationDestination(icon: _badged(s?.newCount ?? 0, const Icon(Icons.view_list_outlined)), selectedIcon: _badged(s?.newCount ?? 0, const Icon(Icons.view_list)), label: l.navQueue),
              NavigationDestination(icon: const Icon(Icons.search), label: l.navSearch),
              NavigationDestination(icon: inboxIcon, selectedIcon: _badged(unread, const Icon(Icons.notifications)), label: l.navAlerts),
              NavigationDestination(icon: const Icon(Icons.account_circle_outlined), selectedIcon: const Icon(Icons.account_circle), label: l.navMe),
            ];
          }()
        : [
            NavigationDestination(icon: const Icon(Icons.flight_takeoff_outlined), selectedIcon: const Icon(Icons.flight_takeoff), label: l.navSearch),
            NavigationDestination(icon: const Icon(Icons.assignment_outlined), selectedIcon: const Icon(Icons.assignment), label: l.navRequests),
            NavigationDestination(icon: const Icon(Icons.inventory_2_outlined), selectedIcon: const Icon(Icons.inventory_2), label: l.navCargo),
            NavigationDestination(icon: inboxIcon, label: l.navInbox),
            NavigationDestination(icon: const Icon(Icons.account_circle_outlined), selectedIcon: const Icon(Icons.account_circle), label: l.navAccount),
          ];
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        destinations: destinations,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
      ),
    );
  }
}
