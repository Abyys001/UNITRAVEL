/// XFAM shared Flutter UI kit.
///
/// State-management agnostic: plain widgets with callbacks/values, no
/// Riverpod/Dio/go_router dependency. See README.md for setup.
library;

// feedback
export 'src/feedback/empty_state.dart';
export 'src/feedback/error_state.dart';
export 'src/feedback/offline_banner.dart';
export 'src/feedback/skeleton.dart';
export 'src/feedback/xfam_snack_bar.dart';
// finance
export 'src/finance/amount_field.dart';
export 'src/finance/currency_flag.dart';
export 'src/finance/currency_flag_catalog.dart';
export 'src/finance/currency_pair_row.dart';
export 'src/finance/currency_picker.dart';
export 'src/finance/exchange_calculator_card.dart';
export 'src/finance/fee_breakdown.dart';
export 'src/finance/identifier_text.dart';
export 'src/finance/money.dart';
export 'src/finance/money_text.dart';
export 'src/finance/payment_summary_card.dart';
export 'src/finance/rate_card.dart';
// forms
export 'src/forms/document_picker_tile.dart';
export 'src/forms/form_section.dart';
export 'src/forms/formatters.dart';
export 'src/forms/identifier_fields.dart';
export 'src/forms/otp_field.dart';
// icons
export 'src/icons/xfam_icons.dart';
// navigation
export 'src/navigation/adaptive_scaffold.dart';
// overlays
export 'src/overlays/xfam_bottom_sheet.dart';
// theme
export 'src/theme/xfam_brand.dart';
export 'src/theme/xfam_theme.dart';
// tokens
export 'src/tokens/xfam_presets.dart';
export 'src/tokens/xfam_tokens.dart';
// visual
export 'src/visual/animated_illustration.dart';
export 'src/visual/hero_artwork.dart';
export 'src/visual/icon_3d.dart';
// workflow
export 'src/workflow/approval_action_bar.dart';
export 'src/workflow/confirm_sheet.dart';
export 'src/workflow/request_progress.dart';
export 'src/workflow/sla_indicator.dart';
export 'src/workflow/status_badge.dart';
export 'src/workflow/timeline_list.dart';
export 'src/workflow/wizard_stepper.dart';
