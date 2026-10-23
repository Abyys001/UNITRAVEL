import 'package:flutter/material.dart';
import 'package:kit_ui/kit_ui.dart';

import '../../models/search.dart';
import '../../ui/widgets.dart';

/// Truth badges (DESIGN.md): always text, never colour alone.
class TruthBadges extends StatelessWidget {
  const TruthBadges(this.it, {super.key, this.risk = true});
  final Itinerary it;
  final bool risk;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final chips = <Widget>[
      if (it.anyFake) ToneChip(l.badgeFake, tone: XfamTone.danger),
      if (it.allPriced)
        ToneChip(l.badgePriced, tone: XfamTone.success, solid: true, icon: Icons.check)
      else if (it.anyCached)
        ToneChip(l.badgeCached)
      else if (it.anyLive)
        ToneChip(l.badgeLive, tone: XfamTone.success),
      if (it.separateTickets) ToneChip(l.badgeSeparate, tone: XfamTone.danger),
      if (it.startsAtGateway) ToneChip(l.badgeGateway, tone: XfamTone.warning),
      if (risk && it.riskFlags.contains('OVERNIGHT')) ToneChip(l.badgeOvernight, tone: XfamTone.warning),
      if (risk && it.riskFlags.contains('TIGHT')) ToneChip(l.badgeTight, tone: XfamTone.warning),
      if (risk && it.riskFlags.contains('AIRPORT_CHANGE')) ToneChip(l.badgeAirportChange, tone: XfamTone.warning),
    ];
    return Wrap(spacing: 6, runSpacing: 6, children: chips);
  }
}
