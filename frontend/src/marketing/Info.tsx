import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Container,
  CtaBand,
  PageHeader,
  PrimaryCta,
  Prose,
  PublicShell,
  SecondaryCta,
  usePageMeta,
} from './shell'
import { Icon } from './icons'
import { COMPANY } from '../pages/Legal'

// ponytail: three short static pages in one file — they share a shape and get
// edited together. Split them when one grows its own sections.

export function About() {
  usePageMeta(
    'About — MeetMaster',
    'Why MeetMaster exists: meeting notes should be a side effect of having the meeting, not a second job.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="About"
        title="Notes should be a side effect of the meeting"
        sub="Somebody on every call ends up as the scribe, half-listening while they type. MeetMaster exists to make that job disappear."
      />

      <Container className="py-8">
        <Prose heading="What we build">
          <p>
            A bot that joins your Google Meet, Zoom, or Microsoft Teams calls, transcribes them with
            speaker labels, and turns the transcript into a summary and a list of action items. It
            connects to Google Calendar so it can show up on its own, and — if you want it to — reads a
            recent window of your Gmail so a meeting arrives with context instead of a bare title.
          </p>
        </Prose>

        <Prose heading="Visible, not covert">
          <p>
            The bot joins under its own name and appears in the participant list. We would rather lose a
            signup than help anyone record a call in secret, and the terms say so.
          </p>
        </Prose>

        <Prose heading="Honest about the AI">
          <p>
            Transcription and summaries are automated, and automated things are wrong sometimes. We say
            that on the product, not only in the fine print — it is not a system of record.
          </p>
        </Prose>

        <Prose heading="Your data stays yours">
          <p>
            No model training on your content, no selling it, and an export-and-delete button that
            actually deletes. Details on the{' '}
            <Link to="/security" className="focus-ring rounded font-medium text-accent hover:underline">security page</Link>.
          </p>
        </Prose>

        <Prose heading="Limits that are real">
          <p>
            Plan limits are counted from the source data and enforced by the service, so the number on
            the pricing page is the number you get.
          </p>
        </Prose>

        <Prose heading="Who we are">
          <p>
            MeetMaster is operated by {COMPANY.legalName}. Use of the service is
            governed by our{' '}
            <Link to="/terms" className="focus-ring rounded font-medium text-accent hover:underline">Terms of Service</Link>{' '}
            and{' '}
            <Link to="/privacy" className="focus-ring rounded font-medium text-accent hover:underline">Privacy Policy</Link>.
          </p>
        </Prose>
      </Container>

      <CtaBand
        title="Try it on your next meeting"
        sub="Sign in with Google. Five recorded meetings a month on the free plan, no card."
      />
    </PublicShell>
  )
}

const FIELD =
  'focus-ring w-full rounded-btn border border-slate-300 bg-white px-3 py-2.5 text-[14px] text-ink transition-colors placeholder:text-slate-500 focus:border-accent'

/**
 * The contact form composes a mailto: message.
 *
 * ponytail: there is no public contact endpoint — /api/support requires a
 * session — so a fake "message sent" confirmation would be a lie. This opens
 * the visitor's mail client with everything filled in. Swap for a real POST the
 * day an unauthenticated endpoint exists.
 */
function ContactForm() {
  const [sent, setSent] = useState(false)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') || '').trim()
    const email = String(data.get('email') || '').trim()
    const subject = String(data.get('subject') || '').trim()
    const message = String(data.get('message') || '').trim()
    if (!name || !email || !subject || !message) return

    const body = `${message}\n\n—\n${name}\n${email}`
    window.location.href =
      `mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setSent(true)
  }

  return (
    <form onSubmit={onSubmit} className="surface p-6 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">Name</label>
          <input id="name" name="name" required autoComplete="name" className={FIELD} />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className={FIELD} />
        </div>
      </div>
      <div className="mt-4">
        <label htmlFor="subject" className="mb-1.5 block text-[13px] font-medium text-ink">Subject</label>
        <input id="subject" name="subject" required className={FIELD} />
      </div>
      <div className="mt-4">
        <label htmlFor="message" className="mb-1.5 block text-[13px] font-medium text-ink">Message</label>
        <textarea id="message" name="message" rows={5} required className={`${FIELD} resize-y`} />
      </div>
      <button
        type="submit"
        className="focus-ring mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-btn bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Send message
        <Icon name="arrowRight" size={16} />
      </button>
      <p aria-live="polite" className="mt-3 text-[13px] text-slate-500">
        {sent
          ? 'Your email client should have opened with the message ready to send.'
          : `This opens your email client with the message addressed to ${COMPANY.supportEmail}.`}
      </p>
    </form>
  )
}

export function Contact() {
  usePageMeta(
    'Contact — MeetMaster',
    `Email ${COMPANY.supportEmail} for support and sales, or ${COMPANY.privacyEmail} for privacy and data requests. Signed-in users can use the in-app support form.`,
  )

  const ROUTES = [
    {
      title: 'Support and sales',
      email: COMPANY.supportEmail,
      body: 'Bot did not join, transcript looks wrong, upgrade requests, Business plan questions.',
    },
    {
      title: 'Privacy and data requests',
      email: COMPANY.privacyEmail,
      body: 'Access, correction, or deletion requests — including from people who were recorded but are not users.',
    },
  ]

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Contact"
        title="Talk to a person"
        sub="No ticket portal, no chatbot. Send a message, or email us directly."
      />

      <section className="border-b border-slate-200">
        <Container className="grid gap-12 py-14 sm:py-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-16">
          <div data-reveal>
            <h2 className="display text-[22px] leading-snug">Send a message</h2>
            <p className="measure mt-3 text-[15px] leading-relaxed text-slate-600">
              Tell us what happened and we will come back to you.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>

          <div data-reveal className="flex flex-col gap-8">
            {ROUTES.map(route => (
              <div key={route.email}>
                <h2 className="text-[15px] font-semibold text-ink">{route.title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{route.body}</p>
                <a
                  href={`mailto:${route.email}`}
                  className="focus-ring mt-2 inline-flex items-center gap-1.5 break-all rounded font-mono text-[13px] font-medium text-accent hover:underline"
                >
                  <Icon name="mail" size={15} />
                  {route.email}
                </a>
              </div>
            ))}

            <div className="border-t border-slate-200 pt-8">
              <h2 className="text-[15px] font-semibold text-ink">Already have an account</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                The in-app support form tags your request with an issue type and attaches your account
                and plan — including upgrade requests.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <SecondaryCta to="/help" label="Open in-app support" size="sm" />
                <PrimaryCta label="Sign in first" size="sm" />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-8">
              <h2 className="text-[15px] font-semibold text-ink">Call us</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                Weekdays, for anything quicker than email.
              </p>
              <a
                href={`tel:${COMPANY.phone.replace(/\s/g, '')}`}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded font-mono text-[13px] font-medium text-accent hover:underline"
              >
                <Icon name="phone" size={15} />
                {COMPANY.phone}
              </a>
            </div>
          </div>
        </Container>
      </section>
    </PublicShell>
  )
}

export function Security() {
  usePageMeta(
    'Security and data handling — MeetMaster',
    'What MeetMaster stores, who it is shared with, how Google API Limited Use applies, and how to export or delete everything.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Security"
        title="What we store, and what you can take back"
        sub="A plain-language summary of the Privacy Policy. Where the two differ, the Privacy Policy is the binding version."
      />

      <Container className="py-8">
        <Prose heading="What we store">
          <p><strong className="font-medium text-ink">Account data</strong> — your name, email address, and profile picture from your Google account.</p>
          <p><strong className="font-medium text-ink">Meeting data</strong> — audio captured from meetings the bot joins, the transcript, speaker labels, and the AI summary and action items.</p>
          <p><strong className="font-medium text-ink">Google Workspace data</strong> — calendar events (title, time, attendees, meeting link) and, if you enable email intelligence, message metadata and bodies from a bounded recent window of your Gmail.</p>
          <p><strong className="font-medium text-ink">Operational data</strong> — logs and error reports needed to run and debug the service.</p>
        </Prose>

        <Prose heading="Google API Limited Use">
          <p>
            Our use of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded font-medium text-accent hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including its Limited Use requirements. We use Gmail and Calendar data only to provide
            features you asked for, do not transfer it except as needed to provide those features or as
            required by law, do not use it for advertising, and do not let humans read it except with
            your explicit consent, for security, to comply with law, or where it is aggregated and
            anonymised.
          </p>
        </Prose>

        <Prose heading="Who it is shared with">
          <p><strong className="font-medium text-ink">Transcription</strong> — audio is transcribed either on our own infrastructure or, depending on configuration, by a speech-to-text provider.</p>
          <p><strong className="font-medium text-ink">AI summarisation</strong> — transcripts and email text go to a large-language-model provider to produce summaries and action items, under agreements that prohibit training on that content.</p>
          <p><strong className="font-medium text-ink">Infrastructure</strong> — hosting, database, and transactional email providers that process data on our instructions.</p>
          <p>We disclose data where legally required. We do not sell personal data or share it with advertisers, and we do not train any model on your data.</p>
        </Prose>

        <Prose heading="Retention and deletion">
          <p>
            Meetings, transcripts, and summaries are kept until you delete them or delete your account.
            Synced email data is refreshed within your chosen sync window. From the Profile page you can
            export everything we hold on you and permanently delete your account — no support request and
            no waiting period. Deletion removes the data from our production database; backups age out on
            their own schedule.
          </p>
          <p>
            You can revoke MeetMaster's access to your Google account at any time at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded font-medium text-accent hover:underline"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </Prose>

        <Prose heading="Access and transport">
          <p>
            Data is encrypted in transit, access to production is restricted, and OAuth tokens are stored
            for the sole purpose of calling Google APIs on your behalf. No system is perfectly secure; if
            you find a problem, write to {COMPANY.privacyEmail}.
          </p>
        </Prose>

        <Prose heading="Recording consent is yours to get">
          <p>
            Recording laws differ by country and state, and many require everyone's consent. The bot is
            visible in the participant list, but that is not consent by itself. When you record a meeting
            you are the controller of that recording and are responsible for a lawful basis and for
            telling participants. If you were recorded and want it removed, contact whoever recorded it,
            or write to {COMPANY.privacyEmail} and we will help identify them.
          </p>
        </Prose>

        <p className="pt-8 text-[13px] text-slate-500">
          Full detail:{' '}
          <Link to="/privacy" className="focus-ring rounded font-medium text-accent hover:underline">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" className="focus-ring rounded font-medium text-accent hover:underline">Terms of Service</Link>
        </p>
      </Container>
    </PublicShell>
  )
}
