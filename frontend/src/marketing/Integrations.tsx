import { Link, Navigate, useParams } from 'react-router-dom'
import {
  CheckList,
  CtaBand,
  PageHeader,
  PrimaryCta,
  PublicShell,
  Section,
  SecondaryCta,
  Steps,
  Tile,
  usePageMeta,
} from './shell'
import { Icon } from './icons'
import { BrandMark } from './brands'
import { MOCKS } from './mocks'
import { INTEGRATIONS, featureBySlug, integrationBySlug, type Feature, type Integration } from './content'

const CATEGORIES: Integration['category'][] = ['Meetings', 'Google Workspace']

/**
 * ponytail: the grid is five items in two categories — a search box would be
 * decoration. Add one when the list outgrows a single screen.
 */
export function Integrations() {
  usePageMeta(
    'Integrations — MeetMaster',
    'MeetMaster connects to Google Meet, Zoom, Microsoft Teams, Google Calendar, and Gmail. What each connection does, and which plan it is on.',
  )

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Integrations"
        title="Connect the tools your team already uses"
        sub="Five connections, all of them real. Meetings are joined on three platforms; Google Workspace supplies the calendar and, optionally, email context."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Start free with Google" />
          <SecondaryCta to="/pricing-public" label="See which plan" />
        </div>
      </PageHeader>

      {CATEGORIES.map(category => (
        <Section
          key={category}
          id={category.toLowerCase().replace(/\s+/g, '-')}
          label={category}
          title={category === 'Meetings' ? 'Where the bot joins' : 'What it reads, with your permission'}
          sub={
            category === 'Meetings'
              ? 'The same bot, the same transcript and summary, on all three platforms.'
              : 'Both connections are granted through Google sign-in and can be revoked at any time.'
          }
          tinted={category === 'Google Workspace'}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {INTEGRATIONS.filter(i => i.category === category).map(i => (
              <Link key={i.slug} to={`/integrations/${i.slug}`} className="surface tint focus-ring block p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-btn border border-slate-200 bg-white">
                    <BrandMark slug={i.slug} size={24} />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-ink">{i.name}</h3>
                    <p className="text-[12px] text-slate-500">{i.plan}</p>
                  </div>
                </div>
                <p className="mt-4 text-[14px] leading-relaxed text-slate-600">{i.blurb}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
                  How it works <Icon name="arrowRight" size={14} />
                </span>
              </Link>
            ))}
          </div>
        </Section>
      ))}

      <CtaBand
        title="One sign-in covers all of it"
        sub="Google sign-in sets up meetings, calendar, and — only if you want it — email context."
      />
    </PublicShell>
  )
}

export function IntegrationDetail() {
  const { slug } = useParams()
  const integration = integrationBySlug(slug)

  usePageMeta(
    integration ? `${integration.name} integration — MeetMaster` : 'Integrations — MeetMaster',
    integration?.blurb ?? '',
  )

  if (!integration) return <Navigate to="/integrations" replace />

  const Mock = MOCKS[integration.mock]
  const features = integration.features.map(featureBySlug).filter((f): f is Feature => Boolean(f))
  const others = INTEGRATIONS.filter(i => i.slug !== integration.slug).slice(0, 3)

  return (
    <PublicShell>
      <PageHeader
        eyebrow={integration.plan}
        title={`${integration.name} + MeetMaster`}
        badge={<BrandMark slug={integration.slug} size={30} />}
        sub={integration.description}
        aside={<Mock />}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryCta label="Connect with Google" />
          <SecondaryCta to="/integrations" label="All integrations" />
        </div>
      </PageHeader>

      <Section id="how" label="How it works" title="From connection to summary">
        <Steps steps={integration.steps} />
      </Section>

      <Section id="notes" label="Good to know" title="The honest fine print" tinted>
        <div className="max-w-2xl">
          <CheckList items={integration.notes} />
        </div>
      </Section>

      <Section
        id="features"
        label="What you get"
        title="Capabilities this connection unlocks"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {features.map(f => (
            <Tile key={f.slug} icon={f.icon} title={f.name} body={f.tagline} to={`/features/${f.slug}`} />
          ))}
        </div>
      </Section>

      <Section id="others" label="Also available" title="The rest of the connections" tinted>
        <div className="grid gap-4 sm:grid-cols-3">
          {others.map(o => (
            <Tile
              key={o.slug}
              media={<BrandMark slug={o.slug} size={22} />}
              title={o.name}
              body={o.blurb}
              to={`/integrations/${o.slug}`}
            />
          ))}
        </div>
      </Section>

      <CtaBand
        title={
          integration.category === 'Meetings'
            ? `Put MeetMaster in your next ${integration.name} call`
            : `Connect ${integration.name} and stop pasting links`
        }
        sub="Sign in with Google — the free plan covers five recorded meetings a month."
      />
    </PublicShell>
  )
}
