import { Link } from 'react-router-dom'
import { Container, PublicShell, usePageMeta } from '../marketing/shell'

// ponytail: one file, two pages — they share a layout and are edited together.
// FILL THESE IN before launch: Google OAuth verification rejects placeholder
// legal pages, and the addresses below appear in the privacy policy.
export const COMPANY = {
  legalName: '[Your Legal Entity Name]',
  supportEmail: 'anil.sagar@nexren.ai',
  privacyEmail: 'anil.sagar@nexren.ai',
  phone: '+91 98102 17013',
  jurisdiction: '[City, State, Country]',
}

const LAST_UPDATED = '2 August 2026'

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  usePageMeta(`${title} — MeetMaster`, `${title} for MeetMaster, the AI meeting notetaker for Google Meet, Zoom, and Microsoft Teams.`)
  return (
    <PublicShell>
      <Container className="pb-16 pt-16">
        <h1 className="display text-[30px] leading-tight sm:text-[36px]">{title}</h1>
        <p className="mt-3 font-mono text-[11px] text-slate-500">Last updated {LAST_UPDATED}</p>
        <div className="mt-10 border-t border-slate-200">{children}</div>
      </Container>
    </PublicShell>
  )
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="py-7 border-b border-slate-200 sm:grid sm:grid-cols-[190px_1fr] sm:gap-10">
      <h2 className="mb-2.5 text-[15px] font-semibold text-ink sm:mb-0">{heading}</h2>
      <div className="flex flex-col gap-3 text-[15px] text-slate-600 leading-relaxed measure">{children}</div>
    </section>
  )
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p className="py-7 border-b border-slate-200 text-[15px] text-slate-600 leading-relaxed measure">
        These terms govern your use of MeetMaster, operated by {COMPANY.legalName} ("we", "us").
        By signing in you agree to them. If you do not agree, do not use the service.
      </p>

      <Section heading="1. The service">
        <p>
          MeetMaster joins video meetings you invite it to, records and transcribes them, and produces
          AI-generated summaries and action items. It can also connect to your Gmail and Google Calendar
          to surface meeting context and follow-ups. Features vary by plan.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You sign in with a Google account and are responsible for activity under it. You must be at
          least 18 years old, or the age of majority where you live. One account is for one person;
          sharing credentials is not permitted.
        </p>
      </Section>

      <Section heading="3. Recording consent — your responsibility">
        <p>
          Recording laws differ by country and state, and many require the consent of everyone on the
          call. You are solely responsible for obtaining that consent before sending our bot into a
          meeting, and for complying with your employer's policies. The bot appears in the participant
          list under its own name so attendees can see it, but that visibility is not, by itself, legal
          consent. We may suspend accounts we believe are recording people unlawfully.
        </p>
      </Section>

      <Section heading="4. Acceptable use">
        <p>
          Do not use MeetMaster to record people covertly, to harass or surveil anyone, to process data
          you have no right to process, to reverse engineer or resell the service, or to attack its
          infrastructure or circumvent plan limits.
        </p>
      </Section>

      <Section heading="5. Plans, limits, and payment">
        <p>
          Each plan carries usage limits (for example, meetings recorded per month), shown on the
          Pricing page and enforced by the service. Paid plans are billed in advance for the period you
          select and are not refundable except where required by law. We may change prices with notice
          before your next renewal.
        </p>
      </Section>

      <Section heading="6. Your content">
        <p>
          Recordings, transcripts, and summaries belong to you. You grant us only the licence needed to
          run the service: to store, process, and transmit that content, including sending it to the
          AI and transcription providers listed in our{' '}
          <Link to="/privacy" className="focus-ring rounded font-medium text-accent hover:underline">Privacy Policy</Link>.
          We do not use your content to train AI models.
        </p>
      </Section>

      <Section heading="7. AI output is not reliable by default">
        <p>
          Transcription and summarisation are automated and will sometimes be wrong — misheard words,
          misattributed speakers, invented or missed action items. Do not rely on MeetMaster output for
          legal, medical, financial, employment, or compliance decisions without checking it against the
          recording. It is not a system of record.
        </p>
      </Section>

      <Section heading="8. Availability">
        <p>
          We aim to keep the service running but do not guarantee uninterrupted availability. Meetings
          can fail to be captured for reasons outside our control — a platform blocking the bot, a
          waiting room nobody admits it from, a network failure. Keep your own notes for anything critical.
        </p>
      </Section>

      <Section heading="9. Termination">
        <p>
          You may delete your account at any time from the Profile page, which permanently removes your
          meetings, transcripts, and synced email data. We may suspend or terminate accounts that breach
          these terms, and will tell you why unless prevented by law.
        </p>
      </Section>

      <Section heading="10. Liability">
        <p>
          To the extent permitted by law, the service is provided "as is" and our total liability for any
          claim is limited to what you paid us in the twelve months before the claim. We are not liable
          for lost profits, lost data, or indirect damages.
        </p>
      </Section>

      <Section heading="11. Changes and contact">
        <p>
          We may update these terms and will post the new version here with a revised date; material
          changes will be notified by email. Questions: {COMPANY.supportEmail}. These terms are governed
          by the laws of {COMPANY.jurisdiction}.
        </p>
      </Section>
    </LegalPage>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="py-7 border-b border-slate-200 text-[15px] text-slate-600 leading-relaxed measure">
        This policy explains what MeetMaster collects, why, and what control you have.
        The data controller is {COMPANY.legalName}. Contact: {COMPANY.privacyEmail}.
      </p>

      <Section heading="What we collect">
        <p>
          <strong className="font-medium text-ink">Account data</strong> — your name, email address, and profile
          picture from your Google account.
        </p>
        <p>
          <strong className="font-medium text-ink">Meeting data</strong> — audio captured from meetings the bot
          joins, the resulting transcript, speaker labels, and AI-generated summaries and action items.
        </p>
        <p>
          <strong className="font-medium text-ink">Google Workspace data</strong> — calendar events (title, time,
          attendees, meeting link) and, if you enable Email Intelligence, message metadata and bodies
          from a bounded recent window of your Gmail.
        </p>
        <p>
          <strong className="font-medium text-ink">Operational data</strong> — logs and error reports needed to run
          and debug the service.
        </p>
      </Section>

      <Section heading="Google API Limited Use">
        <p>
          Our use of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy"
             target="_blank" rel="noopener noreferrer"
             className="focus-ring rounded font-medium text-accent hover:underline">
            Google API Services User Data Policy
          </a>, including its Limited Use requirements. Specifically: we use Gmail and Calendar data
          only to provide user-facing features you have asked for, we do not transfer it except as
          needed to provide those features or as required by law, we do not use it for advertising, and
          we do not allow humans to read it except with your explicit consent, for security purposes, to
          comply with law, or where the data is aggregated and anonymised.
        </p>
      </Section>

      <Section heading="AI models are not trained on your data">
        <p>
          Your transcripts and emails are sent to AI providers to generate summaries, action items, and
          analysis for you, under agreements that prohibit training on that content. We do not train any
          model on your data, and we do not sell it.
        </p>
      </Section>

      <Section heading="Who we share it with">
        <p>
          <strong className="font-medium text-ink">Transcription</strong> — audio is transcribed either on our own
          infrastructure or, depending on configuration, by a speech-to-text provider.
        </p>
        <p>
          <strong className="font-medium text-ink">AI summarisation</strong> — transcripts and email text are sent
          to a large-language-model provider to produce summaries and action items.
        </p>
        <p>
          <strong className="font-medium text-ink">Infrastructure and email delivery</strong> — hosting, database,
          and transactional email providers that process data on our instructions.
        </p>
        <p>
          We also disclose data where legally required. We do not sell personal data or share it with
          advertisers.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Meetings, transcripts, and summaries are kept until you delete them or delete your account.
          Synced email data is refreshed within your chosen sync window. Deleting your account removes
          this data from our production database; backups age out on their own schedule.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You can export everything we hold on you, and permanently delete your account, from the
          Profile page — no request or waiting period. You may also ask us to correct data, restrict
          processing, or object to it, and you can revoke MeetMaster's access to your Google account at{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer"
             className="focus-ring rounded font-medium text-accent hover:underline">
            myaccount.google.com/permissions
          </a>. Contact {COMPANY.privacyEmail} for anything the app does not cover.
        </p>
      </Section>

      <Section heading="Other people on your calls">
        <p>
          Meetings involve people who are not our users. When you record a meeting, you are the
          controller of that recording and are responsible for having a lawful basis and for telling
          participants. If you are one of those participants and want a recording removed, contact the
          person who recorded it, or write to {COMPANY.privacyEmail} and we will help identify them.
        </p>
      </Section>

      <Section heading="Security and changes">
        <p>
          Data is encrypted in transit, access to production is restricted, and OAuth tokens are stored
          for the sole purpose of calling Google APIs on your behalf. No system is perfectly secure. We
          will post material changes to this policy here and notify you by email.
        </p>
      </Section>
    </LegalPage>
  )
}
