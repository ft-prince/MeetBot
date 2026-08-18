import type { IconName } from './icons'

/**
 * Single source of truth for the marketing site's feature / solution /
 * integration pages. Index pages and detail pages both read from here, so a
 * capability is described once and can never drift between the two.
 *
 * Everything in this file must be true of the shipped product. Plan limits
 * mirror backend/src/services/planService.ts; capabilities mirror the routes in
 * src/App.tsx. No invented customers, metrics, or certifications.
 */

export type MockName = 'transcript' | 'summary' | 'calendar' | 'email' | 'library' | 'report' | 'dashboard'

export interface Feature {
  slug: string
  icon: IconName
  name: string
  /** One line, used on cards and as the detail page's sub-heading. */
  tagline: string
  plan: string
  problem: string
  solution: string
  points: string[]
  steps: { title: string; body: string }[]
  mock?: MockName
  related: string[]
}

export const FEATURES: Feature[] = [
  {
    slug: 'live-transcription',
    icon: 'mic',
    name: 'Live transcription',
    tagline: 'Every conversation captured as it happens, attributed to the person who said it.',
    plan: 'All plans',
    problem:
      'Someone on every call ends up as the scribe — half-listening while they type, and still missing the sentence that mattered.',
    solution:
      'The bot joins as a visible participant and transcribes while the meeting runs. Interim words appear as people speak and settle into final segments, each attributed to a named speaker.',
    points: [
      'Speaker labels carried through the whole call',
      'Interim text in real time, final segments as they settle',
      'Full transcript kept and searchable after the meeting',
      'Google Meet, Zoom, and Microsoft Teams',
    ],
    steps: [
      { title: 'The bot joins', body: 'Paste a link or let calendar auto-join send it. It appears by name in the participant list.' },
      { title: 'Audio streams out', body: 'Meeting audio is streamed to the transcription engine as the call runs.' },
      { title: 'Text lands live', body: 'Interim words appear immediately; finished segments are stored with a speaker and timestamp.' },
    ],
    mock: 'transcript',
    related: ['ai-summaries', 'meeting-library', 'platforms'],
  },
  {
    slug: 'ai-summaries',
    icon: 'sparkles',
    name: 'AI summaries and action items',
    tagline: 'The five lines that mattered, plus who owes what.',
    plan: 'All plans',
    problem:
      'A 45-minute transcript is not notes. Nobody re-reads it, so decisions get relitigated and follow-ups quietly disappear.',
    solution:
      'When a meeting ends the transcript is analysed into a short summary, the decisions taken, and the action items it contains — with owners named where the transcript names them.',
    points: [
      'Summary you can read in under a minute',
      'Decisions separated from discussion',
      'Action items with owners where the transcript names them',
      'Automated output — check anything important against the transcript',
    ],
    steps: [
      { title: 'The call ends', body: 'The bot leaves and the finished transcript is queued for analysis.' },
      { title: 'Analysis runs', body: 'Summary, decisions, and action items are extracted within minutes.' },
      { title: 'The report arrives', body: 'Results appear on the meeting page and land in your inbox as a PDF.' },
    ],
    mock: 'summary',
    related: ['live-transcription', 'email-reports', 'meeting-library'],
  },
  {
    slug: 'calendar-auto-join',
    icon: 'calendar',
    name: 'Calendar auto-join',
    tagline: 'Nothing to remember, nothing to paste.',
    plan: 'Pro and Business',
    problem:
      'A notetaker you have to launch is a notetaker you forget on the day you needed it most.',
    solution:
      'Connect Google Calendar and MeetMaster reads your upcoming events. Anything with a video link is joined at its start time, on any of the three supported platforms.',
    points: [
      'Reads event title, time, attendees, and meeting link',
      'Joins scheduled meetings unattended',
      'Skip any meeting you would rather not record',
      'One connection covers Meet, Zoom, and Teams events',
    ],
    steps: [
      { title: 'Connect Google Calendar', body: 'One OAuth grant during sign-in or from your profile.' },
      { title: 'Events are read', body: 'Upcoming events with a video link are listed with their join status.' },
      { title: 'The bot shows up', body: 'It joins at the start time and the meeting appears in your library afterwards.' },
    ],
    mock: 'calendar',
    related: ['platforms', 'live-transcription', 'email-intelligence'],
  },
  {
    slug: 'email-intelligence',
    icon: 'mail',
    name: 'Email intelligence',
    tagline: 'Context before the call, follow-ups after it.',
    plan: 'All plans',
    problem:
      'You walk into a call with a bare calendar title, and walk out without knowing which threads are still waiting on somebody.',
    solution:
      'Sync a bounded recent window of your Gmail and the app can tell you what a meeting is likely about before it starts, and surface the threads still waiting on a reply once it ends.',
    points: [
      'Sync window: up to 10 days on Basic, up to 30 days on Pro and Business',
      'Pre-meeting context attached to calendar events',
      'Open threads and follow-ups surfaced in one place',
      'Covered by Google API Limited Use — never used for advertising or model training',
    ],
    steps: [
      { title: 'Grant Gmail access', body: 'Optional, and revocable from your Google account at any time.' },
      { title: 'A recent window syncs', body: 'Only as far back as your plan allows — the service will not read further.' },
      { title: 'Context appears', body: 'Related threads attach to upcoming events; open follow-ups collect in one inbox view.' },
    ],
    mock: 'email',
    related: ['calendar-auto-join', 'email-reports', 'ai-summaries'],
  },
  {
    slug: 'meeting-library',
    icon: 'search',
    name: 'Meeting library and search',
    tagline: 'Months of calls, one search box.',
    plan: 'All plans',
    problem:
      '"We agreed something about this in March" is not a retrievable fact when the record lives in six people\'s memories.',
    solution:
      'Every finished meeting keeps its transcript, summary, and action items. Search by title, participant, or meeting code and open the full record.',
    points: [
      'Search by title, participant, or meeting code',
      'Transcript, summary, and action items on one page',
      'Meeting history kept until you delete it',
      'Export or permanently delete everything from your profile',
    ],
    steps: [
      { title: 'Meetings accumulate', body: 'Each finished call is filed with its date, participants, and platform.' },
      { title: 'Search', body: 'Narrow by title, participant, or meeting code from the meetings page.' },
      { title: 'Open the record', body: 'Read the summary, jump into the transcript, or export the lot.' },
    ],
    mock: 'library',
    related: ['live-transcription', 'ai-summaries', 'security'],
  },
  {
    slug: 'email-reports',
    icon: 'fileText',
    name: 'Emailed meeting reports',
    tagline: 'The write-up lands in your inbox without anyone writing it.',
    plan: 'All plans',
    problem:
      'The summary that stays inside a tool is a summary the people who missed the call never read.',
    solution:
      'Every analysed meeting is sent to you as a PDF report containing the summary, decisions, and action items — ready to forward to whoever could not make it.',
    points: [
      'PDF report on every plan',
      'Summary, decisions, and action items in one document',
      'Arrives within minutes of the call ending',
      'Forward it anywhere — no account needed to read it',
    ],
    steps: [
      { title: 'Analysis completes', body: 'Summary and action items are generated from the finished transcript.' },
      { title: 'The report is built', body: 'Everything is laid out as a single PDF.' },
      { title: 'It is emailed to you', body: 'Sent to the address on your Google account.' },
    ],
    mock: 'report',
    related: ['ai-summaries', 'email-intelligence', 'meeting-library'],
  },
  {
    slug: 'platforms',
    icon: 'video',
    name: 'Meet, Zoom, and Teams',
    tagline: 'One bot, the three places your meetings actually happen.',
    plan: 'Meet on Basic · Zoom and Teams on Pro',
    problem:
      'Half your calls are on someone else\'s platform, and a notetaker that only covers one of them covers none of the important ones.',
    solution:
      'Paste a link from Google Meet, Zoom, or Microsoft Teams and the same bot joins as a visible participant. Where a lobby exists it waits to be admitted — nobody is recorded without a host letting the bot in.',
    points: [
      'Google Meet on every plan',
      'Zoom and Microsoft Teams from Pro up',
      'The bot is listed by name in the participant list',
      'Waits in the lobby where the platform has one',
    ],
    steps: [
      { title: 'Paste a link', body: 'Or let calendar auto-join pick it up from the event.' },
      { title: 'The bot requests entry', body: 'It waits in the lobby if the meeting has one.' },
      { title: 'Capture begins', body: 'Transcription starts as soon as it is admitted.' },
    ],
    mock: 'calendar',
    related: ['live-transcription', 'calendar-auto-join', 'security'],
  },
  {
    slug: 'usage-and-limits',
    icon: 'barChart',
    name: 'Usage you can see',
    tagline: 'The number on the pricing page is the number you get.',
    plan: 'All plans',
    problem:
      'Usage-based limits you cannot see are limits you discover at the worst possible moment.',
    solution:
      'Your plan limit and the meetings recorded this period are shown in the app. Limits are counted from the source data, enforced server-side, and reset on the 1st of each calendar month.',
    points: [
      'Live count of meetings used this month',
      'Enforced by the service, not by trust',
      'Upgrade requests raised from inside the app',
      'Existing meetings are never touched when you hit a limit',
    ],
    steps: [
      { title: 'Every join is counted', body: 'A meeting counts once the bot successfully joins it.' },
      { title: 'The dashboard shows it', body: 'Used and remaining meetings sit on your dashboard.' },
      { title: 'The count resets', body: 'On the 1st of each calendar month, automatically.' },
    ],
    mock: 'dashboard',
    related: ['meeting-library', 'security'],
  },
]

export const featureBySlug = (slug?: string) => FEATURES.find(f => f.slug === slug)

/* ── Solutions ─────────────────────────────────────────────────────────────
   Audience framings of the same product. Each one only cites features that
   exist above — no vertical-specific capabilities are implied. */

export interface Solution {
  slug: string
  icon: IconName
  name: string
  tagline: string
  problem: string
  outcomes: { title: string; body: string }[]
  /** Feature slugs this audience leans on, in priority order. */
  features: string[]
  mock: MockName
}

export const SOLUTIONS: Solution[] = [
  {
    slug: 'individuals',
    icon: 'userCheck',
    name: 'For individuals',
    tagline: 'Stop taking notes in your own meetings.',
    problem:
      'You are in the call to think, not to type. Whatever you write down while listening is worse than both.',
    outcomes: [
      { title: 'Be present', body: 'Listen and answer instead of splitting attention with a notepad.' },
      { title: 'Nothing to remember', body: 'Connect your calendar once and the bot turns up on its own.' },
      { title: 'A record you can search', body: 'Every call you took, findable by title or participant months later.' },
    ],
    features: ['live-transcription', 'ai-summaries', 'calendar-auto-join'],
    mock: 'transcript',
  },
  {
    slug: 'teams',
    icon: 'users',
    name: 'For teams',
    tagline: 'One record of what was decided, for the people who were not there.',
    problem:
      'Decisions made in a standup live in three heads and get relitigated a fortnight later.',
    outcomes: [
      { title: 'Decisions written down', body: 'Summaries separate what was decided from what was discussed.' },
      { title: 'Owners on every action', body: 'Action items name an owner wherever the conversation did.' },
      { title: 'Forwardable write-ups', body: 'The PDF report goes to whoever missed the call.' },
    ],
    features: ['ai-summaries', 'email-reports', 'meeting-library'],
    mock: 'summary',
  },
  {
    slug: 'sales',
    icon: 'briefcase',
    name: 'For sales and customer calls',
    tagline: 'What they asked for, what you promised, and who owes what by when.',
    problem:
      'A commitment made on a customer call and never written down is a renewal conversation you lose later.',
    outcomes: [
      { title: 'Context before the call', body: 'Recent threads with the account attach to the calendar event.' },
      { title: 'Promises captured', body: 'Commitments land as action items instead of in your memory.' },
      { title: 'Follow-ups surfaced', body: 'Threads still waiting on a reply are collected in one place.' },
    ],
    features: ['email-intelligence', 'ai-summaries', 'platforms'],
    mock: 'email',
  },
  {
    slug: 'interviews',
    icon: 'messageSquare',
    name: 'For interviews and research',
    tagline: 'Compare what people actually said, not what you managed to write.',
    problem:
      'Typing during an interview makes you a worse interviewer, and the notes still are not comparable across candidates.',
    outcomes: [
      { title: 'Attributed transcripts', body: 'Speaker labels make it clear who said what across the whole session.' },
      { title: 'Side-by-side review', body: 'Full transcripts of every session, searchable after the fact.' },
      { title: 'A consistent summary', body: 'The same structure for every conversation you run.' },
    ],
    features: ['live-transcription', 'meeting-library', 'ai-summaries'],
    mock: 'transcript',
  },
]

export const solutionBySlug = (slug?: string) => SOLUTIONS.find(s => s.slug === slug)

/* ── Integrations ──────────────────────────────────────────────────────────
   Only what the product genuinely connects to. */

export interface Integration {
  slug: string
  name: string
  category: 'Meetings' | 'Google Workspace'
  icon: IconName
  /** The surface this connection actually produces in the app. */
  mock: MockName
  blurb: string
  plan: string
  description: string
  steps: { title: string; body: string }[]
  notes: string[]
  features: string[]
}

export const INTEGRATIONS: Integration[] = [
  {
    slug: 'google-meet',
    name: 'Google Meet',
    category: 'Meetings',
    icon: 'video',
    mock: 'transcript',
    blurb: 'The bot joins your Meet calls as a visible participant and transcribes them live.',
    plan: 'All plans',
    description:
      'Paste a Meet link or let calendar auto-join handle it. The bot appears in the participant list under its own name, waits to be admitted where the meeting requires it, and transcribes the call with speaker labels.',
    steps: [
      { title: 'Connect', body: 'Sign in with Google — Meet support is active immediately, on every plan.' },
      { title: 'Meeting starts', body: 'Paste the link, or connect your calendar and skip this step.' },
      { title: 'The bot joins', body: 'It requests entry and appears by name in the participant list.' },
      { title: 'Transcript builds', body: 'Speech is transcribed live with speaker labels.' },
      { title: 'Summary arrives', body: 'Summary, decisions, and action items within minutes of the call ending.' },
    ],
    notes: [
      'Included on the free Basic plan',
      'Somebody still has to admit the bot where a lobby is enabled',
      'The bot is never hidden from the attendee list',
    ],
    features: ['live-transcription', 'ai-summaries', 'calendar-auto-join'],
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    category: 'Meetings',
    icon: 'video',
    mock: 'transcript',
    blurb: 'Same bot, same output, on Zoom calls. Available from Pro.',
    plan: 'Pro and Business',
    description:
      'Zoom meetings are joined by the same bot that handles Meet, with the same live transcript, summary, and action items. It waits in the waiting room where one is enabled.',
    steps: [
      { title: 'Upgrade to Pro', body: 'Zoom support is enabled on Pro and Business plans.' },
      { title: 'Paste the link', body: 'Or let calendar auto-join pick it up from the event.' },
      { title: 'Admit the bot', body: 'It waits in the waiting room until a host lets it in.' },
      { title: 'Transcript builds', body: 'Live transcription with speaker labels for the whole call.' },
      { title: 'Summary arrives', body: 'Report emailed as a PDF once analysis finishes.' },
    ],
    notes: [
      'Requires the Pro plan or above',
      'Waiting rooms are respected — a host must admit the bot',
    ],
    features: ['platforms', 'live-transcription', 'ai-summaries'],
  },
  {
    slug: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'Meetings',
    icon: 'video',
    mock: 'transcript',
    blurb: 'Teams meetings captured with the same transcript and summary pipeline.',
    plan: 'Pro and Business',
    description:
      'Microsoft Teams calls are joined from a link or from a calendar event, transcribed live with speaker labels, and summarised the same way as Meet and Zoom.',
    steps: [
      { title: 'Upgrade to Pro', body: 'Teams support is enabled on Pro and Business plans.' },
      { title: 'Paste the link', body: 'Or connect Google Calendar and let auto-join handle it.' },
      { title: 'The bot joins', body: 'It waits in the lobby where the organiser has one enabled.' },
      { title: 'Transcript builds', body: 'Live transcription with speaker labels.' },
      { title: 'Summary arrives', body: 'Summary, decisions, and action items after the call.' },
    ],
    notes: [
      'Requires the Pro plan or above',
      'Lobby settings are respected',
    ],
    features: ['platforms', 'live-transcription', 'ai-summaries'],
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    category: 'Google Workspace',
    icon: 'calendar',
    mock: 'calendar',
    blurb: 'Reads your upcoming events so the bot can join without being asked.',
    plan: 'Pro and Business',
    description:
      'MeetMaster reads your upcoming calendar events — title, time, attendees, and meeting link — and joins the ones with a video link at their start time. You can skip any individual meeting.',
    steps: [
      { title: 'Grant calendar access', body: 'During Google sign-in, or later from your profile.' },
      { title: 'Events are listed', body: 'Upcoming meetings appear with their platform and join status.' },
      { title: 'Auto-join runs', body: 'The bot joins at the start time, on Meet, Zoom, or Teams.' },
      { title: 'Skip when you want', body: 'Turn a meeting off and the bot leaves it alone.' },
    ],
    notes: [
      'Calendar auto-join requires the Pro plan or above',
      'Access can be revoked at any time from your Google account',
      'Covered by the Google API Services User Data Policy, including Limited Use',
    ],
    features: ['calendar-auto-join', 'email-intelligence', 'platforms'],
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    category: 'Google Workspace',
    icon: 'mail',
    mock: 'email',
    blurb: 'An optional, bounded sync that gives meetings context and surfaces follow-ups.',
    plan: 'All plans',
    description:
      'With your permission, a recent window of your Gmail is synced so the app can show what a meeting is likely about before it starts and which threads are still waiting on somebody afterwards. The window is capped by your plan and never read beyond it.',
    steps: [
      { title: 'Grant Gmail access', body: 'Entirely optional — the rest of the product works without it.' },
      { title: 'A recent window syncs', body: 'Up to 10 days on Basic, up to 30 days on Pro and Business.' },
      { title: 'Context attaches', body: 'Related threads are matched to upcoming calendar events.' },
      { title: 'Follow-ups surface', body: 'Threads waiting on a reply are collected in one view.' },
    ],
    notes: [
      'Never used for advertising and never used to train models',
      'Access can be revoked at any time from your Google account',
      'Covered by the Google API Services User Data Policy, including Limited Use',
    ],
    features: ['email-intelligence', 'email-reports', 'ai-summaries'],
  },
]

export const integrationBySlug = (slug?: string) => INTEGRATIONS.find(i => i.slug === slug)

/* ── FAQ ───────────────────────────────────────────────────────────────────
   Shared by the homepage (a subset) and the dedicated FAQ page (all of it). */

export interface FaqItem { q: string; a: string; category: string }

export const FAQS: FaqItem[] = [
  {
    category: 'Meetings',
    q: 'Do participants know it is recording?',
    a: 'Yes — the bot joins as a visible participant with its own name in the attendee list. That visibility is not legal consent on its own: recording laws differ by country and state, and you are responsible for getting consent from everyone on the call before sending the bot in.',
  },
  {
    category: 'Meetings',
    q: 'Which platforms are supported?',
    a: 'Google Meet on every plan; Zoom and Microsoft Teams from Pro up. The same bot and the same output on all three.',
  },
  {
    category: 'Meetings',
    q: 'What if the meeting has a lobby or waiting room?',
    a: 'The bot waits to be admitted, exactly like any other participant. If nobody lets it in, the meeting is not recorded and does not count against your plan.',
  },
  {
    category: 'AI',
    q: 'How accurate is the transcript?',
    a: 'Good enough to search and skim, not good enough to quote blindly. Transcription and summarisation are automated and will sometimes mishear a word, misattribute a speaker, or miss an action item. Check anything that matters against the transcript.',
  },
  {
    category: 'AI',
    q: 'Do you train AI models on my meetings?',
    a: 'No. Transcripts and email text go to AI providers to produce your summaries under agreements that prohibit training on that content. We do not train models on your data and we do not sell it.',
  },
  {
    category: 'AI',
    q: 'How long does the summary take?',
    a: 'Minutes after the call ends, in the normal case. The summary appears on the meeting page and is emailed to you as a PDF.',
  },
  {
    category: 'Integrations',
    q: 'Do I have to give access to my email?',
    a: 'No. Email intelligence is optional and the rest of the product works without it. If you do enable it, only a bounded recent window is synced — up to 10 days on Basic and up to 30 days on Pro and Business.',
  },
  {
    category: 'Integrations',
    q: 'Can I revoke access later?',
    a: 'Yes, at any time, from your Google account permissions page. You can also export and permanently delete everything from your profile inside the app.',
  },
  {
    category: 'Pricing',
    q: 'What happens if I hit my plan limit?',
    a: 'The bot stops joining new meetings for the rest of the calendar month; everything already captured stays untouched. Limits reset on the 1st, and you can request an upgrade from inside the app.',
  },
  {
    category: 'Pricing',
    q: 'How do I upgrade?',
    a: 'Sign in and send an upgrade request from the app — plans are activated by our team. There is no checkout to complete yet.',
  },
  {
    category: 'Pricing',
    q: 'How do I sign up?',
    a: 'With your Google account. There is no separate password to create; sign in and the Basic plan is active immediately.',
  },
  {
    category: 'Privacy',
    q: 'Can I delete everything?',
    a: 'Yes. Export or permanently delete your account and all its meetings, transcripts, and synced email from the Profile page — no support request, no waiting period.',
  },
  {
    category: 'Privacy',
    q: 'Where is my data stored and who can see it?',
    a: 'Meeting and email data lives in our production database, encrypted in transit, with restricted production access. Transcripts go to a transcription engine and an AI provider to produce your summaries, and to nobody else. The security page has the detail.',
  },
]

/** The homepage shows a subset; the FAQ page shows everything. */
export const HOME_FAQ_QUESTIONS = [
  'Do participants know it is recording?',
  'How accurate is the transcript?',
  'Do you train AI models on my meetings?',
  'What happens if I hit my plan limit?',
  'Can I delete everything?',
  'How do I sign up?',
]
