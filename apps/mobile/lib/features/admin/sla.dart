/// SLA presentation rules for the staff queue (pure, so they are unit tested).
///
/// The API owns the due time and says which statuses carry an SLA (`NEW`, `SUBMITTED`: first response).
/// The "at risk" window is a UI threshold only; it never changes what the API reports as breached.
const slaRiskWindow = Duration(hours: 2);

const slaStatuses = {'NEW', 'SUBMITTED'};

enum SlaLevel { none, ok, risk, breached }

SlaLevel slaLevel({required String status, required DateTime? due, required DateTime now}) {
  if (due == null || !slaStatuses.contains(status)) return SlaLevel.none;
  final left = due.difference(now);
  if (left.isNegative) return SlaLevel.breached;
  return left <= slaRiskWindow ? SlaLevel.risk : SlaLevel.ok;
}

/// Whole-unit parts of a duration, largest first, at most two (`2d 4h`, `3h 20m`, `45m`).
List<(int, String)> durationParts(Duration d) {
  final total = d.abs().inMinutes;
  final days = total ~/ 1440;
  final hours = (total % 1440) ~/ 60;
  final mins = total % 60;
  final parts = <(int, String)>[if (days > 0) (days, 'd'), if (hours > 0) (hours, 'h'), if (mins > 0 || (days == 0 && hours == 0)) (mins, 'm')];
  return parts.take(2).toList();
}
