import 'package:flutter/material.dart';

import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Modal bottom sheet with a drag handle, safe-area padding, keyboard-aware
/// inset and [XfamRadius.lg] top corners — the shared shell for pickers,
/// forms and confirmations.
Future<T?> showXfamBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool showDragHandle = true,
  bool isDismissible = true,
  bool useSafeArea = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    isDismissible: isDismissible,
    useSafeArea: useSafeArea,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(XfamRadius.lg)),
    ),
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showDragHandle)
            Padding(
              padding: const EdgeInsets.only(
                top: XfamSpace.s2,
                bottom: XfamSpace.s1,
              ),
              child: Semantics(
                label: 'Drag handle',
                child: Container(
                  width: XfamSpace.s10,
                  height: XfamSpace.s1,
                  decoration: BoxDecoration(
                    color: Theme.of(
                      context,
                    ).extension<XfamColors>()!.borderStrong,
                    borderRadius: BorderRadius.circular(XfamRadius.full),
                  ),
                ),
              ),
            ),
          Flexible(child: Builder(builder: builder)),
        ],
      ),
    ),
  );
}
