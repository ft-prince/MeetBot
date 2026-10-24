/**
 * Decides which threads may become follow-ups. A follow-up should mean a person
 * owes you a reply (or you owe one) — not a receipt, a newsletter, an app alert
 * you emailed to yourself, or a draft you never sent.
 *
 * Used by both follow-up sources: the "you sent last, no reply" check and the
 * AI analysis (which happily says "follow up" on marketing mail).
 */

export interface FollowUpCandidate {
  userEmail: string;
  subject: string;
  /** Gmail labels on the thread (CATEGORY_*, SENT, DRAFT, …). */
  labelIds: string[];
  lastEmail: {
    fromAddress: string;
    toAddresses: string[];
    ccAddresses: string[];
    isSentByUser: boolean;
  };
}

export type SkipReason = 'draft' | 'self' | 'category' | 'automated' | 'calendar';

/** Gmail's non-Primary tabs: receipts/notifications, marketing, social, forums. */
const SKIP_CATEGORIES = new Set(['CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);

// Matches the mailbox part of bots: noreply, no-reply, donotreply, notifications,
// mailer-daemon… as a whole word, so "replyguy.sharma" is still a person.
const AUTOMATED_LOCAL_PART =
  /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?)([._+-]|$)/i;

// Google Calendar's own subjects for invites and RSVPs; replying is done in Calendar.
const CALENDAR_SUBJECT =
  /^(invitation( from an unknown sender)?|updated invitation|accepted|declined|tentatively accepted|canceled event|cancelled event)\b.*:/i;

/** "Anil <anil@x.com>" / "<anil@x.com>" / "anil@x.com" → "anil@x.com" */
export function bareAddress(raw: string): string {
  const inBrackets = raw.match(/<([^>]+)>/);
  return (inBrackets ? inBrackets[1] : raw).replace(/["']/g, '').trim().toLowerCase();
}

function isAutomated(fromAddress: string): boolean {
  const local = bareAddress(fromAddress).split('@')[0] ?? '';
  return AUTOMATED_LOCAL_PART.test(local);
}

/** Why this thread must not be a follow-up, or null if it may be one. */
export function followUpSkipReason(t: FollowUpCandidate): SkipReason | null {
  const { lastEmail, labelIds } = t;
  const me = bareAddress(t.userEmail);

  if (lastEmail.isSentByUser && labelIds.includes('DRAFT') && !labelIds.includes('SENT')) return 'draft';

  if (lastEmail.isSentByUser) {
    const recipients = [...lastEmail.toAddresses, ...lastEmail.ccAddresses].map(bareAddress);
    if (recipients.every(r => r === me)) return 'self'; // also catches "no recipients"
  }

  if (labelIds.some(l => SKIP_CATEGORIES.has(l))) return 'category';

  if (CALENDAR_SUBJECT.test(t.subject.trim())) return 'calendar';

  if (!lastEmail.isSentByUser && isAutomated(lastEmail.fromAddress)) return 'automated';

  return null;
}
