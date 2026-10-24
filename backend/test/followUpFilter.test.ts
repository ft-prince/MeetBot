import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUpSkipReason, type FollowUpCandidate } from '../src/services/followUpFilter';

// Every case below is a real thread that was wrongly shown as "needs a
// follow-up". A follow-up must mean a person owes (or is owed) a reply.

const ME = 'prince.saiyad@nexren.ai';

function thread(over: Partial<FollowUpCandidate['lastEmail']>, labels: string[], subject = 'Project update'): FollowUpCandidate {
  return {
    userEmail: ME,
    subject,
    labelIds: labels,
    lastEmail: { fromAddress: ME, toAddresses: [], ccAddresses: [], isSentByUser: true, ...over },
  };
}

test('a real reply you are waiting on is kept', () => {
  const t = thread({ toAddresses: ['Anil Sagar <anil.sagar@renataiot.com>'] }, ['SENT']);
  assert.equal(followUpSkipReason(t), null);
});

test('an email from a colleague in Primary is kept', () => {
  const t = thread(
    { fromAddress: '<manish.tiwari@marelli.com>', toAddresses: [`<${ME}>`], isSentByUser: false },
    ['IMPORTANT', 'CATEGORY_PERSONAL', 'INBOX'],
  );
  assert.equal(followUpSkipReason(t), null);
});

test('emails you sent to yourself are skipped (app alerts, SMTP tests)', () => {
  const t = thread({ toAddresses: [ME] }, ['SENT', 'INBOX']);
  assert.equal(followUpSkipReason(t), 'self');
  // Same address with a display name and different case still counts as you.
  const named = thread({ toAddresses: [`Prince <${ME.toUpperCase()}>`] }, ['SENT', 'INBOX']);
  assert.equal(followUpSkipReason(named), 'self');
});

test('unsent drafts are skipped', () => {
  const t = thread({ toAddresses: ['anil.koyuncu@cs.bilkent.edu.tr'] }, ['DRAFT']);
  assert.equal(followUpSkipReason(t), 'draft');
});

test('receipts and notifications in Gmail Updates are skipped, even if you forwarded one', () => {
  const forwardedReceipt = thread({ toAddresses: ['Anil Sagar <anil.sagar@renataiot.com>'] }, ['CATEGORY_UPDATES', 'INBOX', 'SENT']);
  assert.equal(followUpSkipReason(forwardedReceipt), 'category');
});

test('promotions, social and forum mail is skipped', () => {
  for (const label of ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']) {
    const t = thread({ fromAddress: 'info@homeservices.nobroker.in', isSentByUser: false }, [label, 'INBOX']);
    assert.equal(followUpSkipReason(t), 'category', label);
  }
});

test('automated senders are skipped even outside Gmail categories', () => {
  for (const from of [
    'noreply@email.openai.com', 'NoReply@payoneer.com', 'no-reply@accounts.google.com',
    'donotreply@godaddy.com', 'do-not-reply@x.com', 'notifications@vercel.com',
    'mailer-daemon@googlemail.com', 'drive-shares-dm-noreply@google.com', 'noreply+jobs@google.com',
  ]) {
    const t = thread({ fromAddress: from, toAddresses: [ME], isSentByUser: false }, ['INBOX', 'IMPORTANT']);
    assert.equal(followUpSkipReason(t), 'automated', from);
  }
});

test('a person whose name merely contains "reply" is not treated as automated', () => {
  const t = thread({ fromAddress: 'replyguy.sharma@gmail.com', toAddresses: [ME], isSentByUser: false }, ['INBOX']);
  assert.equal(followUpSkipReason(t), null);
});

test('calendar invitations and RSVP notices are skipped', () => {
  for (const subject of [
    'Invitation: Dojo 2.0 Discussion @ Sat 30 May 2026 4:15pm',
    'Updated invitation: Daily huddle @ Weekly from 9:45am',
    'Invitation from an unknown sender: NoteAI review @ Fri 5 Jun 2026',
    'Accepted: NoteAI demo @ Mon', 'Declined: Sync', 'Canceled event: Standup',
  ]) {
    const t = thread({ fromAddress: 'anil.sagar@renataiot.com', toAddresses: [ME], isSentByUser: false }, ['INBOX', 'CATEGORY_PERSONAL'], subject);
    assert.equal(followUpSkipReason(t), 'calendar', subject);
  }
  // A normal email that merely mentions an invitation is kept.
  const t = thread({ toAddresses: ['anil.sagar@renataiot.com'] }, ['SENT'], 'Re: invitation list for the demo');
  assert.equal(followUpSkipReason(t), null);
});
