import { Link } from 'react-router-dom'
import {
  ArrowLink,
  CheckList,
  Container,
  CtaBand,
  Eyebrow,
  Faq,
  PrimaryCta,
  PublicShell,
  Section,
  SecondaryCta,
  Tile,
  usePageMeta,
} from './shell'
import { Icon, type IconName } from './icons'
import { BrandMark } from './brands'
import { DashboardMock, MOCKS, Waveform } from './mocks'
import { FAQS, FEATURES, HOME_FAQ_QUESTIONS, INTEGRATIONS, SOLUTIONS } from './content'
import { PLAN_MATRIX, PUBLIC_PLANS } from './plans'

const STEPS = [
  {
    n: '01',
    title: 'Connect or paste',
    body: 'Sign in with Google. Connect your calendar, or paste a Meet, Zoom, or Teams link when you need it.',
  },
  {
    n: '02',
    title: 'The bot joins and transcribes',
    body: 'It appears by name in the participant list and transcribes live, labelling who said what as the call happens.',
  },
  {
    n: '03',
    title: 'Read the summary, not the transcript',
    body: 'Within minutes of the call ending: summary, decisions, action items, and a PDF in your inbox.',
  },
]

/** The four features that carry the homepage story, in order. */
const STORY = ['live-transcription', 'ai-summaries', 'calendar-auto-join', 'email-intelligence']

const BEFORE = [
  'Somebody types instead of listening',
  "Decisions live in three people's memories",
  'Follow-ups quietly go missing',
  '"We agreed something about this in March"',
]

const AFTER = [
  'Everyone stays in the conversation',
  'Decisions written down, separated from discussion',
  'Action items with owners, emailed as a PDF',
  'Every call searchable by title or participant',
]

const homeFaqs = HOME_FAQ_QUESTIONS
  .map(q => FAQS.find(f => f.q === q))
  .filter((f): f is (typeof FAQS)[number] => Boolean(f))

/** The pipeline, as a diagram: linear until analysis, then it fans out. */
const PIPELINE: { icon: IconName; label: string }[] = [
  { icon: 'video', label: 'Meeting' },
  { icon: 'mic', label: 'Capture' },
  { icon: 'fileText', label: 'Transcript' },
  { icon: 'sparkles', label: 'AI analysis' },
]

const OUTPUTS: { icon: IconName; label: string; body: string }[] = [
  { icon: 'fileText', label: 'Summary', body: 'What was said, in a minute of reading.' },
  { icon: 'checkCircle', label: 'Action items', body: 'With owners where the call named them.' },
  { icon: 'mail', label: 'Emailed report', body: 'A PDF in your inbox, ready to forward.' },
]

/** What actually happens around one call — timestamps are illustrative. */
const TIMELINE = [
  { at: '09:00', title: 'Meeting starts', body: 'Your calendar event begins on Meet, Zoom, or Teams.', tone: 'idle' as const },
  { at: '09:00', title: 'The bot joins', body: 'It appears by name in the participant list and waits to be admitted if there is a lobby.', tone: 'live' as const },
  { at: '09:00', title: 'Transcription runs live', body: 'Interim words appear as people speak; final segments are stored with a speaker and timestamp.', tone: 'live' as const },
  { at: '09:45', title: 'The call ends', body: 'The bot leaves and the finished transcript is queued for analysis.', tone: 'idle' as const },
  { at: '09:47', title: 'Summary and action items', body: 'Decisions separated from discussion, owners attached where the transcript names them.', tone: 'work' as const },
  { at: '09:48', title: 'Report in your inbox', body: 'The same write-up as a PDF, ready to forward to whoever missed it.', tone: 'done' as const },
]

const TONE_DOT = {
  idle: 'bg-slate-300',
  live: 'bg-danger',
  work: 'bg-warning',
  done: 'bg-success',
}

export function Landing() {
  usePageMeta(
    'MeetMaster — AI meeting notes for Google Meet, Zoom, and Teams',
    'Invite the MeetMaster bot to your meeting. Get a live transcript with speaker labels, an AI summary, and action items the moment the call ends.',
  )

  return (
    <PublicShell>
      {/* Hero — centred copy over the full product surface */}
      <section className="hero-wash glow relative overflow-hidden border-b border-slate-200">
        <div className="grid-wash pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative pb-0 pt-16 sm:pt-20">
          <div data-reveal className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-light/70 px-3 py-1 text-[12px] font-medium text-accent">
              <Waveform className="!h-3.5" />
              Meeting intelligence
              <span className="hidden sm:inline"> for Meet, Zoom, and Teams</span>
            </span>
            <h1 className="display mt-6 text-[38px] leading-[1.05] sm:text-[58px]">
              Every meeting,{' '}
              <span className="bg-gradient-to-br from-accent to-[#5B7BEA] bg-clip-text text-transparent">
                written down
              </span>
              .
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-slate-600 sm:text-[18px]">
              MeetMaster joins your calls as a visible participant, transcribes them with speaker
              labels, and hands you the summary, decisions, and action items minutes after everyone
              hangs up.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <PrimaryCta label="Start free with Google" />
              <SecondaryCta to="/features" label="See how it works" />
            </div>
            <p className="mt-5 text-[13px] text-slate-500">
              Free plan: 5 recorded meetings a month. No card, no trial countdown.
            </p>
          </div>

          {/* The product itself, at full width, immediately under the promise. */}
          <div data-reveal className="relative mt-14 sm:mt-16">
            <div className="dot-grid pointer-events-none absolute -inset-x-8 -top-8 bottom-1/3" aria-hidden="true" />
            <div className="relative">
              <DashboardMock />
            </div>
            {/* The frame runs off the bottom edge into the next section. */}
            <div className="h-10 sm:h-14" />
          </div>
        </Container>
      </section>

      {/* Works with — the platforms it genuinely joins, in place of a fake logo wall */}
      <div className="border-b border-slate-200 bg-slate-50/60">
        <Container className="py-10">
          <p className="text-center text-[12px] font-medium uppercase tracking-[.1em] text-slate-500">
            Works with the tools your meetings already run on
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {INTEGRATIONS.map(i => (
              <li key={i.slug}>
                <Link
                  to={`/integrations/${i.slug}`}
                  className="focus-ring flex items-center gap-2.5 rounded-card border border-slate-200 bg-white px-3.5 py-3 transition-colors hover:border-slate-300"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn border border-slate-200 bg-white">
                    <BrandMark slug={i.slug} size={20} />
                  </span>
                  <span className="min-w-0 text-[13px] font-medium leading-snug text-ink">{i.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </div>

      {/* Problem / solution — one comparison, two columns */}
      <Section
        id="why"
        label="Why it exists"
        title="Notes should be a side effect of the meeting"
        sub="Not a second job you do during it, and not a transcript nobody ever reads afterwards."
      >
        {/* Two states of the same meeting, paired line for line. The arrow is the
            point of the section, so it gets to be a real element on desktop. */}
        <div className="relative grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:gap-3">
          <div className="rounded-card border border-slate-200 bg-slate-50/70 p-6 sm:p-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-slate-200/70 text-slate-500">
                <Icon name="x" size={16} />
              </span>
              <p className="text-[13px] font-semibold uppercase tracking-[.1em] text-slate-500">Without it</p>
            </div>
            <ul className="mt-6 flex flex-col">
              {BEFORE.map(item => (
                <li
                  key={item}
                  className="flex items-start gap-3 border-b border-slate-200/80 py-3.5 text-[14px] leading-relaxed text-slate-500 last:border-0"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Desktop: the arrow sits in the seam. Mobile: it stacks between. */}
          <div className="flex items-center justify-center lg:w-14" aria-hidden="true">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-accent shadow-[0_2px_10px_-2px_rgba(15,23,42,.12)]">
              <Icon name="arrowRight" size={18} className="rotate-90 lg:rotate-0" />
            </span>
          </div>

          <div className="brand-wash relative overflow-hidden rounded-card border border-accent/25 p-6 sm:p-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-accent text-white">
                <Icon name="sparkles" size={16} />
              </span>
              <p className="text-[13px] font-semibold uppercase tracking-[.1em] text-accent">With MeetMaster</p>
            </div>
            <ul className="mt-6 flex flex-col">
              {AFTER.map(item => (
                <li
                  key={item}
                  className="flex items-start gap-3 border-b border-accent/12 py-3.5 text-[14px] font-medium leading-relaxed text-ink last:border-0"
                >
                  <Icon name="checkCircle" size={17} className="mt-0.5 shrink-0 text-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* How it works + the pipeline as a diagram */}
      <Section id="how" label="How it works" title="Three steps, and only the first one is yours" tinted>
        <ol className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-3">
          {STEPS.map(step => (
            <li key={step.n} className="tint bg-white p-7">
              <span className="font-mono text-xs font-medium text-accent">{step.n}</span>
              <h3 className="mt-3 text-[16px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>

        {/* Pipeline: linear through analysis, then it fans out into three outputs. */}
        <div className="mt-12 rounded-card border border-slate-200 bg-white p-6 sm:p-8">
          <ol className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {PIPELINE.map((stage, i) => (
              <li key={stage.label} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2.5 sm:text-center">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent-light text-accent">
                  <Icon name={stage.icon} size={19} />
                </span>
                <span className="text-[13px] font-medium text-ink">{stage.label}</span>
                {/* Connector: an arrow between stages, rotated on the mobile stack. */}
                {i < PIPELINE.length - 1 && (
                  <span aria-hidden="true" className="text-slate-300 sm:hidden">
                    <Icon name="arrowRight" size={16} className="rotate-90" />
                  </span>
                )}
              </li>
            )).flatMap((node, i) =>
              i < PIPELINE.length - 1
                ? [node, (
                    <li key={`sep-${i}`} aria-hidden="true" className="hidden items-center sm:flex sm:w-10">
                      <span className="h-px w-full bg-slate-200" />
                      <Icon name="arrowRight" size={14} className="-ml-1 shrink-0 text-slate-300" />
                    </li>
                  )]
                : [node],
            )}
          </ol>

          <div className="relative mt-8 border-t border-dashed border-slate-200 pt-8">
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2 bg-slate-200 sm:left-[87.5%]"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              {OUTPUTS.map(o => (
                <div key={o.label} className="flex items-start gap-3 rounded-btn bg-slate-50/80 p-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-white text-accent ring-1 ring-slate-200">
                    <Icon name={o.icon} size={16} />
                  </span>
                  <span>
                    <span className="block text-[14px] font-medium text-ink">{o.label}</span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-slate-600">{o.body}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Product in action — the largest visual on the page */}
      <section aria-labelledby="in-action" className="brand-wash relative overflow-hidden border-b border-slate-200">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <Container className="relative py-16 sm:py-24">
          <div data-reveal className="mx-auto max-w-2xl text-center">
            <Eyebrow>Product in action</Eyebrow>
            <h2 id="in-action" className="display mt-3 text-[26px] leading-tight sm:text-[34px]">
              See your meetings differently
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-slate-600">
              From a live call to a searchable record with owners on every follow-up — the whole
              journey happens on one screen.
            </p>
          </div>

          <div data-reveal className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0">
              <MOCKS.transcript />
            </div>
            <div className="grid min-w-0 gap-6">
              <MOCKS.summary />
              <MOCKS.report />
            </div>
          </div>
        </Container>
      </section>

      {/* What happens around one call */}
      <Section
        id="timeline"
        label="Timeline"
        title="One meeting, start to inbox"
        sub="Times are illustrative — what matters is that every step after the call happens without you."
      >
        <ol className="relative max-w-3xl border-l border-slate-200 pl-8 sm:pl-10">
          {TIMELINE.map(step => (
            <li key={`${step.at}-${step.title}`} className="relative pb-9 last:pb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[41px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white sm:-left-[49px] ${TONE_DOT[step.tone]}`}
              />
              <span className="font-mono text-[12px] text-slate-500">{step.at}</span>
              <h3 className="mt-1 text-[16px] font-semibold text-ink">{step.title}</h3>
              <p className="measure mt-1.5 text-[14px] leading-relaxed text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Feature story — alternating rows, real product surfaces */}
      <section aria-labelledby="features" className="border-b border-slate-200">
        <Container className="py-16 sm:py-24">
          <div data-reveal className="mb-14">
            <Eyebrow>What you get</Eyebrow>
            <h2 id="features" className="display mt-3 text-[26px] leading-tight sm:text-[32px]">
              Built around the four minutes after a call
            </h2>
          </div>

          <div className="flex flex-col gap-20 sm:gap-24">
            {STORY.map((slug, i) => {
              const feature = FEATURES.find(f => f.slug === slug)!
              const Mock = feature.mock ? MOCKS[feature.mock] : null
              return (
                <div key={slug} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div data-reveal className={i % 2 === 1 ? 'lg:order-2' : ''}>
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-btn bg-accent-light text-accent">
                      <Icon name={feature.icon} size={20} />
                    </span>
                    <h3 className="display mt-5 text-[22px] leading-snug sm:text-[26px]">{feature.name}</h3>
                    <p className="measure mt-3 text-[16px] leading-relaxed text-slate-600">{feature.solution}</p>
                    <div className="mt-6">
                      <CheckList items={feature.points.slice(0, 3)} />
                    </div>
                    <div className="mt-6">
                      <ArrowLink to={`/features/${feature.slug}`} label={`More on ${feature.name.toLowerCase()}`} />
                    </div>
                  </div>
                  {Mock && (
                    <div data-reveal className={`min-w-0 ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                      <Mock />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-16">
            <SecondaryCta to="/features" label="All features" />
          </div>
        </Container>
      </section>

      {/* Solutions */}
      <Section
        id="solutions"
        label="Solutions"
        title="The calls people stop dreading"
        sub="Same bot, same output — these are the meetings where it earns its keep fastest."
        tinted
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SOLUTIONS.map(s => (
            <Tile
              key={s.slug}
              icon={s.icon}
              // "For individuals" -> "Individuals": the section heading already
              // supplies the "for whom", but the tile still needs a capital.
              title={s.name.replace(/^For /, '').replace(/^./, c => c.toUpperCase())}
              body={s.tagline}
              to={`/solutions/${s.slug}`}
            />
          ))}
        </div>
      </Section>

      {/* Plans — one table, not three brochures */}
      <Section
        id="plans"
        label="Plans"
        title="Limits enforced by the service, not by trust"
        sub="Start on Basic with your Google account. Upgrade from inside the app when you outgrow it."
      >
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">Plan comparison</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="w-1/3 pb-5 text-left align-bottom" />
                {PUBLIC_PLANS.map(p => (
                  <th key={p.id} scope="col" className="pb-5 pr-4 text-left align-bottom">
                    <span className="block text-[15px] font-semibold text-ink">{p.name}</span>
                    <span className="display mt-1 block text-2xl tabular-nums">{p.price}</span>
                    <span className="block text-[11px] font-normal text-slate-500">{p.cadence}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAN_MATRIX.map(row => (
                <tr key={row.label} className="border-b border-slate-200">
                  <th scope="row" className="py-3.5 pr-4 text-left font-normal text-slate-600">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className="py-3.5 pr-4 tabular-nums text-ink">
                      {v === 'Yes' ? <Icon name="check" size={16} className="text-accent" /> : v}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="py-6" />
                {PUBLIC_PLANS.map(p => (
                  <td key={p.id} className="py-6 pr-4">
                    {p.id === 'business' ? (
                      <SecondaryCta to="/contact" label="Talk to us" size="sm" />
                    ) : (
                      <PrimaryCta label={p.id === 'free' ? 'Start free' : 'Get Pro'} size="sm" />
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-[13px] text-slate-500">
          Full breakdown on the{' '}
          <Link to="/pricing-public" className="focus-ring rounded font-medium text-accent hover:underline">
            pricing page
          </Link>
          .
        </p>
      </Section>

      {/* FAQ */}
      <Section id="faq" label="FAQ" title="Questions people actually ask" tinted>
        <Faq items={homeFaqs} />
        <p className="mt-8 text-[13px] text-slate-500">
          More on the{' '}
          <Link to="/faq" className="focus-ring rounded font-medium text-accent hover:underline">FAQ page</Link>, or{' '}
          <Link to="/contact" className="focus-ring rounded font-medium text-accent hover:underline">contact us</Link>.
        </p>
      </Section>

      <CtaBand
        title="Your next meeting could write itself up"
        sub="Sign in with Google, paste a meeting link, and read the summary instead of typing it."
      />
    </PublicShell>
  )
}
