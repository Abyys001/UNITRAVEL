import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/repos.dart';
import 'core/session.dart';
import 'features/account/account_screen.dart';
import 'features/admin/case_screen.dart';
import 'features/admin/queue_screen.dart';
import 'features/auth/profile_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/cargo/cargo_screens.dart';
import 'features/inbox/inbox_screen.dart';
import 'features/requests/request_detail_screen.dart';
import 'features/requests/request_form_screen.dart';
import 'features/requests/requests_screen.dart';
import 'features/search/itinerary_screen.dart';
import 'features/search/results_screen.dart';
import 'features/search/search_screen.dart';
import 'ui/widgets.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// Where a signed-in user lands, by mode (`/me` -> `surfaces.admin`, ch. 10.5).
String homeFor(SessionState s) => s.isAdminMode ? '/admin/queue' : '/search';

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
        return loc.startsWith('/admin') ? null : '/admin/queue';
      }
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
                    path: 'new',
                    parentNavigatorKey: _rootKey,
                    builder: (_, s) => CargoRequestScreen(laneId: s.uri.queryParameters['lane'] ?? ''),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(routes: [GoRoute(path: '/inbox', builder: (_, _) => const InboxScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, _) => const AccountScreen())]),
        ],
      ),
      // --- admin mode ---
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _Shell(shell: shell, admin: true),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/admin/queue',
                builder: (_, _) => const QueueScreen(),
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
          StatefulShellBranch(routes: [GoRoute(path: '/admin/mine', builder: (_, _) => const QueueScreen(mine: true))]),
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
    body: Center(child: Semantics(label: context.l.loading, child: const CircularProgressIndicator())),
  );
}

class _Shell extends ConsumerWidget {
  const _Shell({required this.shell, required this.admin});
  final StatefulNavigationShell shell;
  final bool admin;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final unread = ref.watch(inboxProvider).value?.data.unread ?? 0;
    final inboxIcon = unread > 0
        ? Badge(label: Text('$unread'), child: const Icon(Icons.notifications_none))
        : const Icon(Icons.notifications_none);

    final destinations = admin
        ? [
            NavigationDestination(icon: const Icon(Icons.view_list_outlined), selectedIcon: const Icon(Icons.view_list), label: l.navQueue),
            NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: l.navMine),
            NavigationDestination(icon: inboxIcon, label: l.navInbox),
            NavigationDestination(icon: const Icon(Icons.account_circle_outlined), selectedIcon: const Icon(Icons.account_circle), label: l.navAccount),
          ]
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
