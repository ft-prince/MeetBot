import { Navigate, useParams } from 'react-router-dom'
import {
  ArrowLink,
  Container,
  CtaBand,
  Eyebrow,
  PageHeader,
  PrimaryCta,
  PublicShell,
  Section,
  SecondaryCta,
  Tile,
  usePageMeta,
} from './shell'
import { Icon } from './icons'
import { MOCKS } from './mocks'
import { SOLUTIONS, featureBySlug, solutionBySlug, type Feature } from './content'

/**
 * Solutions are audience framings of the same product — every capability named
 * here links back to a real feature page. Nothing vertical-specific is implied.
 */
export function Solutions() {
  usePageMeta(
    'Solutions — MeetMaster',
    'How MeetMaster fits individuals, teams, sales and customer calls, and interviews. One bot, one set of capabilities, four ways of working.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Solutions"
        title="One bot, four kinds of meeting worth keeping"
        sub="The product does not change per audience. What changes is which part of it you lean on."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Start free with Google" />
          <SecondaryCta to="/features" label="See all features" />
        </div>
      </PageHeader>

      {SOLUTIONS.map((s, i) => {
        const Mock = MOCKS[s.mock]
        return (
          <section key={s.slug} aria-labelledby={s.slug} className="border-b border-slate-200">
            <Container className="grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
              <div data-reveal className={i % 2 === 1 ? 'lg:order-2' : ''}>
                <Eyebrow icon={s.icon}>{s.name}</Eyebrow>
                <h2 id={s.slug} className="display mt-4 text-[24px] leading-tight sm:text-[30px]">{s.tagline}</h2>
                <p className="measure mt-4 text-[16px] leading-relaxed text-slate-600">{s.problem}</p>
                <dl className="mt-7 border-t border-slate-200">
                  {s.outcomes.map(o => (
                    <div key={o.title} className="border-b border-slate-200 py-3.5 sm:grid sm:grid-cols-[180px_1fr] sm:gap-6">
                      <dt className="text-[14px] font-medium text-ink">{o.title}</dt>
                      <dd className="mt-1 text-[14px] leading-relaxed text-slate-600 sm:mt-0">{o.body}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-7">
                  <ArrowLink to={`/solutions/${s.slug}`} label={`${s.name} in detail`} />
                </div>
              </div>
              <div data-reveal className={`min-w-0 ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                <Mock />
              </div>
            </Container>
          </section>
        )
      })}

      <CtaBand
        title="Whichever meeting it is, it writes itself up"
        sub="Sign in with Google and try it on the next call in your calendar."
      />
    </PublicShell>
  )
}

export function SolutionDetail() {
  const { slug } = useParams()
  const solution = solutionBySlug(slug)

  usePageMeta(
    solution ? `${solution.name} — MeetMaster` : 'Solutions — MeetMaster',
    solution?.tagline ?? '',
  )

  if (!solution) return <Navigate to="/solutions" replace />

  const Mock = MOCKS[solution.mock]
  const features = solution.features.map(featureBySlug).filter((f): f is Feature => Boolean(f))

  return (
    <PublicShell>
      <PageHeader eyebrow={solution.name} title={solution.tagline} sub={solution.problem}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Start free with Google" />
          <SecondaryCta to="/solutions" label="All solutions" />
        </div>
      </PageHeader>

      <section aria-labelledby="outcomes" className="border-b border-slate-200">
        <Container className="grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div data-reveal>
            <h2 id="outcomes" className="display text-[22px] leading-snug sm:text-[26px]">What changes</h2>
            <ul className="mt-6 flex flex-col gap-5">
              {solution.outcomes.map(o => (
                <li key={o.title} className="flex items-start gap-3">
                  <Icon name="checkCircle" size={18} className="mt-0.5 shrink-0 text-accent" />
                  <div>
                    <h3 className="text-[15px] font-semibold text-ink">{o.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-slate-600">{o.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal className="min-w-0"><Mock /></div>
        </Container>
      </section>

      <Section
        id="capabilities"
        label="What you use"
        title="The parts of the product this leans on"
        sub="Every one of these is a real capability with its own page."
        tinted
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {features.map(f => (
            <Tile key={f.slug} icon={f.icon} title={f.name} body={f.tagline} to={`/features/${f.slug}`} />
          ))}
        </div>
      </Section>

      <CtaBand
        title="Try it on the next one in your calendar"
        sub="Sign in with Google. Five recorded meetings a month on the free plan, no card."
      />
    </PublicShell>
  )
}
