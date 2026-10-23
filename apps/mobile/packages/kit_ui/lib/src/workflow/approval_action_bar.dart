import 'package:flutter/material.dart';

import 'package:kit_ui/src/overlays/xfam_bottom_sheet.dart';
import 'package:kit_ui/src/tokens/xfam_tokens.dart';

/// Staff review action bar: approve, reject (reason required), request-info.
/// Reject opens a reason prompt and only calls [onReject] once the reason is
/// non-empty — the kit enforces the "reason required" rule, not the app.
class ApprovalActionBar extends StatelessWidget {
  const ApprovalActionBar({
    super.key,
    required this.onApprove,
    required this.onReject,
    this.onRequestInfo,
    this.approveLabel = 'Approve',
    this.rejectLabel = 'Reject',
    this.requestInfoLabel = 'Request info',
    this.rejectReasonHint = 'Reason for rejection',
    this.rejectReasonRequiredError = 'A reason is required',
    this.rejectSubmitLabel = 'Submit',
  });

  final VoidCallback onApprove;
  final ValueChanged<String> onReject;
  final VoidCallback? onRequestInfo;
  final String approveLabel;
  final String rejectLabel;
  final String requestInfoLabel;
  final String rejectReasonHint;
  final String rejectReasonRequiredError;
  final String rejectSubmitLabel;

  Future<void> _promptReject(BuildContext context) async {
    final reason = await showXfamBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _RejectReasonSheet(
        hint: rejectReasonHint,
        requiredError: rejectReasonRequiredError,
        submitLabel: rejectSubmitLabel,
      ),
    );
    if (reason != null && reason.isNotEmpty) onReject(reason);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<XfamColors>()!;
    return SafeArea(
      minimum: const EdgeInsets.all(XfamSpace.s4),
      child: Row(
        children: [
          if (onRequestInfo != null) ...[
            Expanded(
              child: OutlinedButton(
                onPressed: onRequestInfo,
                child: Text(requestInfoLabel),
              ),
            ),
            const SizedBox(width: XfamSpace.s2),
          ],
          Expanded(
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: colors.danger,
                side: BorderSide(color: colors.dangerBorder),
              ),
              onPressed: () => _promptReject(context),
              child: Text(rejectLabel),
            ),
          ),
          const SizedBox(width: XfamSpace.s2),
          Expanded(
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: colors.success,
                foregroundColor: colors.successFg,
              ),
              onPressed: onApprove,
              child: Text(approveLabel),
            ),
          ),
        ],
      ),
    );
  }
}

class _RejectReasonSheet extends StatefulWidget {
  const _RejectReasonSheet({
    required this.hint,
    required this.requiredError,
    required this.submitLabel,
  });

  final String hint;
  final String requiredError;
  final String submitLabel;

  @override
  State<_RejectReasonSheet> createState() => _RejectReasonSheetState();
}

class _RejectReasonSheetState extends State<_RejectReasonSheet> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    if (_controller.text.trim().isEmpty) {
      setState(() => _error = widget.requiredError);
      return;
    }
    Navigator.of(context).pop(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        XfamSpace.s4,
        XfamSpace.s2,
        XfamSpace.s4,
        XfamSpace.s6,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _controller,
            autofocus: true,
            minLines: 3,
            maxLines: 6,
            decoration: InputDecoration(
              labelText: widget.hint,
              errorText: _error,
            ),
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
          const SizedBox(height: XfamSpace.s3),
          FilledButton(onPressed: _submit, child: Text(widget.submitLabel)),
        ],
      ),
    );
  }
}
