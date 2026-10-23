import 'package:flutter/material.dart';

import 'package:kit_ui/src/icons/xfam_icons.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

enum DocumentPickerStatus { empty, uploading, done, error }

/// Presentational document-upload tile: shows the picked file's name,
/// thumbnail, upload progress or error, and a pick/retry/remove action.
/// Picking a file is entirely the app's responsibility (call [onPick] and
/// drive [status]/[progress]/[errorText] from the result) — the kit takes no
/// dependency on `image_picker`/`file_picker`/camera; see README.md for the
/// recommended app-side packages.
class DocumentPickerTile extends StatelessWidget {
  const DocumentPickerTile({
    super.key,
    required this.title,
    required this.status,
    required this.onPick,
    this.fileName,
    this.thumbnail,
    this.progress,
    this.errorText,
    this.onRemove,
    this.pickLabel = 'Upload',
    this.retryLabel = 'Retry',
  });

  final String title;
  final DocumentPickerStatus status;
  final VoidCallback onPick;
  final String? fileName;
  final Widget? thumbnail;

  /// `null` renders an indeterminate progress bar while [status] is uploading.
  final double? progress;
  final String? errorText;
  final VoidCallback? onRemove;
  final String pickLabel;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    final textTheme = Theme.of(context).textTheme;
    final isError = status == DocumentPickerStatus.error;

    return Semantics(
      label: '$title: ${status.name}${fileName != null ? ', $fileName' : ''}',
      child: Container(
        padding: const EdgeInsets.all(XfamSpace.s3),
        decoration: BoxDecoration(
          border: Border.all(
            color: isError ? colors.dangerBorder : colors.border,
          ),
          borderRadius: BorderRadius.circular(XfamRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                SizedBox(
                  width: XfamSize.controlLg,
                  height: XfamSize.controlLg,
                  child:
                      thumbnail ??
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: colors.surfaceSunken,
                          borderRadius: BorderRadius.circular(XfamRadius.sm),
                        ),
                        child: XfamIcon('file-text', color: colors.fgSubtle),
                      ),
                ),
                const SizedBox(width: XfamSpace.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: textTheme.titleSmall),
                      if (fileName != null)
                        Text(
                          fileName!,
                          style: textTheme.bodyMedium?.copyWith(
                            color: colors.fgMuted,
                          ),
                          overflow: TextOverflow.ellipsis,
                        )
                      else if (isError && errorText != null)
                        Text(
                          errorText!,
                          style: textTheme.bodyMedium?.copyWith(
                            color: colors.danger,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: XfamSpace.s2),
                _TrailingAction(
                  status: status,
                  onPick: onPick,
                  onRemove: onRemove,
                  pickLabel: pickLabel,
                  retryLabel: retryLabel,
                ),
              ],
            ),
            if (status == DocumentPickerStatus.uploading) ...[
              const SizedBox(height: XfamSpace.s2),
              ClipRRect(
                borderRadius: BorderRadius.circular(XfamRadius.full),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: XfamSpace.s1,
                  backgroundColor: colors.border,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TrailingAction extends StatelessWidget {
  const _TrailingAction({
    required this.status,
    required this.onPick,
    required this.onRemove,
    required this.pickLabel,
    required this.retryLabel,
  });

  final DocumentPickerStatus status;
  final VoidCallback onPick;
  final VoidCallback? onRemove;
  final String pickLabel;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case DocumentPickerStatus.empty:
        return OutlinedButton(onPressed: onPick, child: Text(pickLabel));
      case DocumentPickerStatus.error:
        return OutlinedButton(onPressed: onPick, child: Text(retryLabel));
      case DocumentPickerStatus.uploading:
        return const SizedBox(
          width: XfamSize.iconMd,
          height: XfamSize.iconMd,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
      case DocumentPickerStatus.done:
        return onRemove == null
            ? const XfamIcon('check', size: XfamSize.iconMd)
            : IconButton(icon: const XfamIcon('trash-2'), onPressed: onRemove);
    }
  }
}
