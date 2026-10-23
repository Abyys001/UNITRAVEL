import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/search.dart';

DateTime _today() {
  final n = DateTime.now();
  return DateTime(n.year, n.month, n.day);
}

/// Search form state lives above the tab so it survives navigation.
class SearchFormNotifier extends Notifier<SearchForm> {
  @override
  SearchForm build() => _fresh();

  static SearchForm _fresh() => SearchForm(
    legs: [
      SearchLeg(date: _today().add(const Duration(days: 21))),
      SearchLeg(date: _today().add(const Duration(days: 35))),
    ],
  );

  void reset() => state = _fresh();

  void setTripType(TripType t) {
    var legs = [...state.legs];
    final needed = switch (t) {
      TripType.oneWay => 1,
      TripType.roundTrip => 2,
      TripType.openJaw => 2,
      TripType.multiCity => legs.length < 2 ? 2 : legs.length,
    };
    while (legs.length < needed) {
      final last = legs.last;
      legs.add(SearchLeg(date: last.date?.add(const Duration(days: 7))));
    }
    if (legs.length > needed) legs = legs.sublist(0, needed);
    state = state.copyWith(tripType: t, legs: legs);
  }

  void setLeg(int i, SearchLeg leg) {
    final legs = [...state.legs]..[i] = leg;
    state = state.copyWith(legs: legs);
  }

  void addLeg() {
    if (state.legs.length >= 4) return;
    final last = state.legs.last;
    state = state.copyWith(legs: [
      ...state.legs,
      SearchLeg(from: last.to, date: last.date?.add(const Duration(days: 5))),
    ]);
  }

  void removeLeg(int i) {
    if (state.legs.length <= 2) return;
    state = state.copyWith(legs: [...state.legs]..removeAt(i));
  }

  void swap() {
    final first = state.legs.first;
    setLeg(0, SearchLeg(from: first.to, to: first.from, date: first.date));
  }

  void update(SearchForm Function(SearchForm) f) => state = f(state);
}

final searchFormProvider = NotifierProvider<SearchFormNotifier, SearchForm>(SearchFormNotifier.new);
