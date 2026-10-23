import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

/// Explicit Lucide name → [IconData] map for the icons this kit uses (wired
/// mainly from [XfamStatus.icon]). Deliberately not reflection-based: add a
/// name here when a new widget needs one.
///
/// Package: `lucide_icons_flutter` (MIT, actively maintained — see
/// components/flutter/README.md for the pub.dev evaluation).
const Map<String, IconData> _lucideIcons = {
  'circle-dashed': LucideIcons.circleDashed,
  'send': LucideIcons.send,
  'id-card': LucideIcons.idCard,
  'scan-face': LucideIcons.scanFace,
  'wallet': LucideIcons.wallet,
  'loader-circle': LucideIcons.loaderCircle,
  'check-check': LucideIcons.checkCheck,
  'circle-x': LucideIcons.circleX,
  'eye': LucideIcons.eye,
  'circle-help': LucideIcons.circleHelp,
  'user-round-search': LucideIcons.userRoundSearch,
  'badge-check': LucideIcons.badgeCheck,
  'refresh-cw': LucideIcons.refreshCw,
  'hourglass': LucideIcons.hourglass,
  'arrow-up-right': LucideIcons.arrowUpRight,
  'circle-check': LucideIcons.circleCheck,
  'ban': LucideIcons.ban,
  'octagon-x': LucideIcons.octagonX,
  'clock-alert': LucideIcons.clockAlert,
  'circle-pause': LucideIcons.circlePause,
  // Used by widgets outside XfamStatus (workflow/forms/feedback/overlays).
  'chevron-right': LucideIcons.chevronRight,
  'chevron-left': LucideIcons.chevronLeft,
  'circle': LucideIcons.circle,
  'check': LucideIcons.check,
  'x': LucideIcons.x,
  'alert-triangle': LucideIcons.triangleAlert,
  'inbox': LucideIcons.inbox,
  'search-x': LucideIcons.searchX,
  'wifi-off': LucideIcons.wifiOff,
  'copy': LucideIcons.copy,
  'eye-off': LucideIcons.eyeOff,
  'upload': LucideIcons.upload,
  'file-text': LucideIcons.fileText,
  'trash-2': LucideIcons.trash2,
  'arrow-left-right': LucideIcons.arrowLeftRight,
  'chevron-down': LucideIcons.chevronDown,
  'clock': LucideIcons.clock,
  'grip-horizontal': LucideIcons.gripHorizontal,
};

/// Directional icon names that must mirror (flip horizontally) in RTL.
const Set<String> _directionalIcons = {
  'send',
  'arrow-up-right',
  'chevron-right',
  'chevron-left',
  'arrow-left-right',
};

/// Resolves a Lucide icon name (kebab-case, as used by [XfamStatus.icon]) to
/// its [IconData]. Falls back to [LucideIcons.circleHelp] for unknown names
/// rather than throwing, since status vocabularies evolve server-side.
IconData lucideIcon(String name) =>
    _lucideIcons[name] ?? LucideIcons.circleHelp;

/// Renders a Lucide icon by name, auto-mirroring directional icons under RTL
/// [Directionality] (arrows, chevrons, send).
class XfamIcon extends StatelessWidget {
  const XfamIcon(
    this.name, {
    super.key,
    this.size,
    this.color,
    this.semanticLabel,
  });

  final String name;
  final double? size;
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final icon = Icon(
      lucideIcon(name),
      size: size,
      color: color,
      semanticLabel: semanticLabel,
    );
    if (!_directionalIcons.contains(name)) return icon;
    final isRtl = Directionality.of(context) == TextDirection.rtl;
    if (!isRtl) return icon;
    return Transform.flip(flipX: true, child: icon);
  }
}
