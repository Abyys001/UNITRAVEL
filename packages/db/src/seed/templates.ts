// Default templates per event, channel and language (ch. 17.4). SMS bodies stay within one or two UCS-2 segments
// for Persian: reference, status and a short link — nothing more.
type T = { title: string; body: string }
interface EventTemplates { vars: string[]; en: T; fa: T; smsEn?: string; smsFa?: string; emailEn?: T; emailFa?: T }

export const TEMPLATES: Record<string, EventTemplates> = {
  "auth.otp": {
    vars: ["code"],
    en: { title: "Your sign-in code", body: "Your Uni Travel code is {code}" }, fa: { title: "کد ورود", body: "کد ورود یونی‌تراول: {code}" },
    smsEn: "Uni Travel code: {code}. Valid 5 minutes. Never share it.", smsFa: "کد یونی‌تراول: {code}\nاعتبار ۵ دقیقه. آن را به کسی ندهید.",
  },
  "request.submitted": {
    vars: ["ref", "route", "link"],
    en: { title: "Request received · {ref}", body: "We received your request {ref} ({route}). Our team will call you. Requesting does not book a seat." },
    fa: { title: "درخواست دریافت شد · {ref}", body: "درخواست {ref} ({route}) دریافت شد. تیم ما با شما تماس می‌گیرد. ثبت درخواست به معنای رزرو صندلی نیست." },
    smsEn: "Uni Travel: request {ref} received. We will call you. {link}", smsFa: "یونی‌تراول: درخواست {ref} دریافت شد. با شما تماس می‌گیریم. {link}",
  },
  "request.assigned": { vars: ["ref", "route"], en: { title: "Assigned to you · {ref}", body: "{ref} ({route}) is now yours." }, fa: { title: "به شما واگذار شد · {ref}", body: "درخواست {ref} ({route}) به شما واگذار شد." } },
  "request.info_requested": {
    vars: ["ref", "message_preview", "link"],
    en: { title: "Action needed · {ref}", body: "Our team needs something from you: {message_preview}" },
    fa: { title: "نیاز به اقدام شما · {ref}", body: "تیم ما به اطلاعاتی از شما نیاز دارد: {message_preview}" },
    smsEn: "Uni Travel: action needed on {ref}. {link}", smsFa: "یونی‌تراول: درخواست {ref} نیاز به اقدام شما دارد. {link}",
  },
  "request.message_from_staff": {
    vars: ["ref", "message_preview", "link"],
    en: { title: "New message · {ref}", body: "{message_preview}" }, fa: { title: "پیام جدید · {ref}", body: "{message_preview}" },
    smsEn: "Uni Travel: new message on {ref}. {link}", smsFa: "یونی‌تراول: پیام جدید برای {ref}. {link}",
  },
  "request.message_from_customer": { vars: ["ref", "message_preview"], en: { title: "Customer replied · {ref}", body: "{message_preview}" }, fa: { title: "پاسخ مشتری · {ref}", body: "{message_preview}" } },
  "request.declined": {
    vars: ["ref", "message_preview", "link"],
    en: { title: "Update on {ref}", body: "{message_preview}" }, fa: { title: "به‌روزرسانی {ref}", body: "{message_preview}" },
    smsEn: "Uni Travel: update on {ref}. {link}", smsFa: "یونی‌تراول: به‌روزرسانی درخواست {ref}. {link}",
  },
  "request.cancelled": { vars: ["ref"], en: { title: "Cancelled · {ref}", body: "The customer cancelled {ref}." }, fa: { title: "لغو شد · {ref}", body: "مشتری درخواست {ref} را لغو کرد." } },
  "request.status_changed": { vars: ["ref", "status_label"], en: { title: "{ref} · {status_label}", body: "Your request {ref} is now: {status_label}." }, fa: { title: "{ref} · {status_label}", body: "وضعیت درخواست {ref}: {status_label}" } },
  "quote.sent": {
    vars: ["ref", "expires_at_local", "link"],
    en: { title: "Options ready · {ref}", body: "Your options are ready. They are valid until {expires_at_local}." },
    fa: { title: "گزینه‌ها آماده است · {ref}", body: "گزینه‌های سفر شما آماده است و تا {expires_at_local} اعتبار دارد." },
    smsEn: "Uni Travel: options for {ref} ready until {expires_at_local}. {link}", smsFa: "یونی‌تراول: گزینه‌های {ref} تا {expires_at_local} معتبر است. {link}",
  },
  "quote.expiring": {
    vars: ["ref", "expires_at_local", "link"],
    en: { title: "Options expire soon · {ref}", body: "Your options expire at {expires_at_local}." }, fa: { title: "اعتبار گزینه‌ها رو به پایان است · {ref}", body: "اعتبار گزینه‌ها در {expires_at_local} تمام می‌شود." },
    smsEn: "Uni Travel: options for {ref} expire {expires_at_local}. {link}", smsFa: "یونی‌تراول: اعتبار گزینه‌های {ref} در {expires_at_local} تمام می‌شود. {link}",
  },
  "quote.accepted": { vars: ["ref"], en: { title: "Option accepted · {ref}", body: "Thank you. We are now reserving your seats for {ref}." }, fa: { title: "گزینه تأیید شد · {ref}", body: "سپاس. در حال رزرو صندلی‌های {ref} هستیم." } },
  "quote.expired": { vars: ["ref"], en: { title: "Options expired · {ref}", body: "The options for {ref} expired. Ask us for new ones." }, fa: { title: "گزینه‌ها منقضی شد · {ref}", body: "اعتبار گزینه‌های {ref} تمام شد. برای گزینه‌های جدید با ما در تماس باشید." } },
  "reservation.recorded": { vars: ["ref", "deadline_local"], en: { title: "Seats reserved · {ref}", body: "Seats are reserved. The ticket must be issued by {deadline_local}." }, fa: { title: "صندلی‌ها رزرو شد · {ref}", body: "صندلی‌ها رزرو شد. بلیت باید تا {deadline_local} صادر شود." } },
  "reservation.deadline_approaching": {
    vars: ["ref", "deadline_local"],
    en: { title: "Ticketing deadline · {ref}", body: "Ticket {ref} by {deadline_local}." }, fa: { title: "مهلت صدور بلیت · {ref}", body: "بلیت {ref} باید تا {deadline_local} صادر شود." },
    emailEn: { title: "Ticketing deadline approaching: {ref}", body: "The reservation for {ref} must be ticketed by {deadline_local}." },
    emailFa: { title: "مهلت صدور بلیت: {ref}", body: "رزرو {ref} باید تا {deadline_local} صادر شود." },
  },
  "ticket.issued": {
    vars: ["ref", "ticket_numbers", "link"],
    en: { title: "Ticket issued · {ref}", body: "Your ticket numbers: {ticket_numbers}. Receipts are in your request." },
    fa: { title: "بلیت صادر شد · {ref}", body: "شماره بلیت‌ها: {ticket_numbers}. رسیدها در درخواست شما موجود است." },
    smsEn: "Uni Travel: ticket issued for {ref}: {ticket_numbers}. {link}", smsFa: "یونی‌تراول: بلیت {ref} صادر شد: {ticket_numbers} {link}",
    emailEn: { title: "Your ticket for {ref}", body: "Your ticket has been issued. Ticket numbers: {ticket_numbers}. Your e-ticket receipt is attached in your account." },
    emailFa: { title: "بلیت شما برای {ref}", body: "بلیت شما صادر شد. شماره بلیت‌ها: {ticket_numbers}. رسید بلیت الکترونیکی در حساب شما موجود است." },
  },
  "sla.unassigned": { vars: ["ref", "minutes"], en: { title: "Unassigned for {minutes} min · {ref}", body: "{ref} is waiting in New." }, fa: { title: "بدون مسئول · {ref}", body: "{ref} در صف جدید منتظر است." } },
  "sla.first_contact_due": { vars: ["ref"], en: { title: "First contact due · {ref}", body: "Please contact the customer for {ref}." }, fa: { title: "زمان اولین تماس · {ref}", body: "لطفاً با مشتری {ref} تماس بگیرید." } },
  "sla.awaiting_customer_reminder": {
    vars: ["ref", "link"],
    en: { title: "We are waiting for you · {ref}", body: "Your request {ref} needs your reply." }, fa: { title: "منتظر پاسخ شما هستیم · {ref}", body: "درخواست {ref} منتظر پاسخ شماست." },
    smsEn: "Uni Travel: {ref} is waiting for your reply. {link}", smsFa: "یونی‌تراول: {ref} منتظر پاسخ شماست. {link}",
  },
  "cargo.submitted": {
    vars: ["ref", "route", "link"],
    en: { title: "Cargo request received · {ref}", body: "We received your cargo request {ref} ({route}). Nothing is booked until we send a quote and you accept it." },
    fa: { title: "درخواست بار دریافت شد · {ref}", body: "درخواست ارسال بار {ref} ({route}) دریافت شد. تا ارسال پیشنهاد قیمت و تأیید شما چیزی رزرو نمی‌شود." },
    smsEn: "Uni Travel: cargo request {ref} received. {link}", smsFa: "یونی‌تراول: درخواست بار {ref} دریافت شد. {link}",
  },
  "cargo.status_changed": {
    vars: ["ref", "status_label", "link"],
    en: { title: "{ref} · {status_label}", body: "Your shipment {ref} is now: {status_label}." }, fa: { title: "{ref} · {status_label}", body: "وضعیت محمولهٔ {ref}: {status_label}" },
    smsEn: "Uni Travel: {ref} {status_label}. {link}", smsFa: "یونی‌تراول: {ref} {status_label} {link}",
  },
  "compliance.hold_created": {
    vars: ["ref", "trigger"],
    en: { title: "Compliance hold · {ref}", body: "A {trigger} check needs a decision." }, fa: { title: "توقف انطباق · {ref}", body: "بررسی {trigger} نیاز به تصمیم دارد." },
    emailEn: { title: "Compliance hold on {ref}", body: "A {trigger} check on {ref} needs a decision in the compliance queue." }, emailFa: { title: "توقف انطباق {ref}", body: "بررسی {trigger} برای {ref} در صف انطباق نیاز به تصمیم دارد." },
  },
  "compliance.case_decided": { vars: ["ref", "decision"], en: { title: "Compliance decision · {ref}", body: "Decision: {decision}." }, fa: { title: "تصمیم انطباق · {ref}", body: "تصمیم: {decision}" } },
  "security.new_sign_in": {
    vars: ["client", "when_local"],
    en: { title: "New sign-in", body: "Your account was signed in on {client} at {when_local}. If this wasn't you, contact us." },
    fa: { title: "ورود جدید", body: "حساب شما در {when_local} از {client} وارد شد. اگر شما نبودید با ما تماس بگیرید." },
    emailEn: { title: "New sign-in to Uni Travel", body: "Your account was signed in on {client} at {when_local}. If this wasn't you, contact us immediately." },
    emailFa: { title: "ورود جدید به یونی‌تراول", body: "حساب شما در {when_local} از {client} وارد شد. اگر شما نبودید فوراً با ما تماس بگیرید." },
  },
  "security.role_changed": {
    vars: ["roles", "actor"],
    en: { title: "Account roles changed", body: "Roles now: {roles} (changed by {actor})." }, fa: { title: "نقش‌های حساب تغییر کرد", body: "نقش‌های فعلی: {roles} (توسط {actor})" },
    emailEn: { title: "Roles changed on a Uni Travel account", body: "Roles now: {roles} (changed by {actor})." }, emailFa: { title: "تغییر نقش در حساب یونی‌تراول", body: "نقش‌های فعلی: {roles} (توسط {actor})" },
  },
  "provider.degraded": {
    vars: ["provider", "detail"], en: { title: "Provider degraded · {provider}", body: "{detail}" }, fa: { title: "اختلال در تأمین‌کننده · {provider}", body: "{detail}" },
    emailEn: { title: "Provider degraded: {provider}", body: "{detail}" }, emailFa: { title: "اختلال تأمین‌کننده: {provider}", body: "{detail}" },
  },
  "notification.route_degraded": {
    vars: ["route", "rate"], en: { title: "SMS route degraded · {route}", body: "Delivery rate {rate}%." }, fa: { title: "اختلال مسیر پیامک · {route}", body: "نرخ تحویل {rate}٪" },
    emailEn: { title: "SMS route degraded: {route}", body: "Delivery rate fell to {rate}%." }, emailFa: { title: "اختلال مسیر پیامک: {route}", body: "نرخ تحویل به {rate}٪ رسید." },
  },
  "staff.digest": {
    vars: ["count", "refs"], en: { title: "{count} new requests", body: "New requests outside business hours: {refs}" }, fa: { title: "{count} درخواست جدید", body: "درخواست‌های جدید خارج از ساعت کاری: {refs}" },
    emailEn: { title: "Uni Travel: {count} new requests", body: "New requests outside business hours: {refs}" }, emailFa: { title: "یونی‌تراول: {count} درخواست جدید", body: "درخواست‌های جدید خارج از ساعت کاری: {refs}" },
  },
}
