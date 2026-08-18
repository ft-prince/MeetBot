import { Navigate, useParams } from 'react-router-dom'
import {
  ArrowLink,
  CheckList,
  Container,
  CtaBand,
  Eyebrow,
  PageHeader,
  PrimaryCta,
  PublicShell,
  Section,
  SecondaryCta,
  Steps,
  Tile,
  usePageMeta,
} from './shell'
import { MOCKS } from './mocks'
import { FEATURES, featureBySlug, type Feature } from './content'

/** Overview of the whole product, one entry per real capability. */
export function Features() {
  usePageMeta(
    'Features — MeetMaster',
    'Live transcripts with speaker labels, AI summaries and action items, Google Meet / Zoom / Teams support, calendar auto-join, meeting search, and email intelligence.',
  )

  const [lead, ...rest] = FEATURES
  const LeadMock = lead.mock ? MOCKS[lead.mock] : null

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Features"
        title="Everything you need to turn meetings into useful information"
        sub="No feature-tour theatre — the actual list, and which plan each part is on."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Start free with Google" />
          <SecondaryCta to="/pricing-public" label="Compare plans" />
        </div>
      </PageHeader>

      {/* Lead feature gets the full treatment; the rest are a clean grid. */}
      <section aria-labelledby="lead" className="border-b border-slate-200">
        <Container className="grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div data-reveal>
            <Eyebrow icon={lead.icon}>{lead.plan}</Eyebrow>
            <h2 id="lead" className="display mt-4 text-[26px] leading-tight sm:text-[32px]">{lead.name}</h2>
            <p className="measure mt-4 text-[16px] leading-relaxed text-slate-600">{lead.solution}</p>
            <div className="mt-6">
              <CheckList items={lead.points} />
            </div>
            <div className="mt-7">
              <ArrowLink to={`/features/${lead.slug}`} label="Read more" />
            </div>
          </div>
          <div data-reveal className="min-w-0">{LeadMock && <LeadMock />}</div>
        </Container>
      </section>

      <Section
        id="all"
        label="The rest of it"
        title="Capability by capability"
        sub="Each one has its own page with the problem it solves and how it works."
        tinted
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map(f => (
            <Tile key={f.slug} icon={f.icon} title={f.name} body={f.tagline} to={`/features/${f.slug}`} />
          ))}
        </div>
      </Section>

      <CtaBand
        title="See it on a real meeting"
        sub="Sign in with Google and send the bot into your next call — the free plan covers five a month."
      />
    </PublicShell>
  )
}

/** Detail page for one capability, driven entirely by content.ts. */
export function FeatureDetail() {
  const { slug } = useParams()
  const feature = featureBySlug(slug)

  usePageMeta(
    feature ? `${feature.name} — MeetMaster` : 'Features — MeetMaster',
    feature?.tagline ?? '',
  )

  if (!feature) return <Navigate to="/features" replace />

  const Mock = feature.mock ? MOCKS[feature.mock] : null
  // Unknown slugs (a related page that is not a feature) simply drop out.
  const related = feature.related.map(featureBySlug).filter((f): f is Feature => Boolean(f))

  return (
    <PublicShell>
      <PageHeader eyebrow={feature.plan} title={feature.name} sub={feature.tagline}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Start free with Google" />
          <SecondaryCta to="/features" label="All features" />
        </div>
      </PageHeader>

      {/* Problem → solution → the surface it produces */}
      <section aria-labelledby="problem" className="border-b border-slate-200">
        <Container className="grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div data-reveal>
            <h2 id="problem" className="display text-[22px] leading-snug sm:text-[26px]">The problem</h2>
            <p className="measure mt-4 text-[16px] leading-relaxed text-slate-600">{feature.problem}</p>
            <h3 className="display mt-10 text-[22px] leading-snug sm:text-[26px]">What MeetMaster does</h3>
            <p className="measure mt-4 text-[16px] leading-relaxed text-slate-600">{feature.solution}</p>
          </div>
          {Mock && <div data-reveal className="min-w-0 lg:pt-2"><Mock /></div>}
        </Container>
      </section>

      <Section id="how" label="How it works" title="Start to finish" tinted>
        <Steps steps={feature.steps} />
      </Section>

      <Section id="detail" label="In detail" title="What you get">
        <div className="max-w-3xl">
          <CheckList items={feature.points} columns={2} />
        </div>
      </Section>

      {related.length > 0 && (
        <Section id="related" label="Related" title="Works with the rest of the product" tinted>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map(r => (
              <Tile key={r.slug} icon={r.icon} title={r.name} body={r.tagline} to={`/features/${r.slug}`} />
            ))}
          </div>
        </Section>
      )}

      <CtaBand
        title={`Try ${feature.name.toLowerCase()} on your next call`}
        sub="Sign in with Google and send the bot into a meeting. Five a month on the free plan."
      />
    </PublicShell>
  )
}
