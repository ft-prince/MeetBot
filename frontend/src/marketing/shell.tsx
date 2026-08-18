import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './icons'

/**
 * Shared chrome and primitives for every public page (marketing + legal).
 *
 * The design system in one paragraph: white page, hairline slate-200 rules,
 * three radii (btn 8 / card 12 / frame 16), one accent, one gradient wash used
 * twice. Hierarchy comes from type and space — cards and shadows are the
 * exception, not the default.
 *
 * ponytail: index.html is a single SPA shell, so per-page metadata is set
 * imperatively on mount. No react-helmet — this is 20 lines. Crawlers that do
 * not run JS will only ever see the shell's defaults; add prerendering if
 * organic search actually matters.
 */
const SITE_NAME = 'MeetMaster'

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    setMeta('name', 'description', description)
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', window.location.href)
    setMeta('name', 'twitter:card', 'summary')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
  }, [title, description])
}

/**
 * Reveal-on-scroll for anything tagged `data-reveal`.
 *
 * ponytail: IntersectionObserver + one class, no animation library. The wrapper
 * only hides children once `js-reveal` is on <html>, so a JS failure degrades to
 * plain visible content rather than a blank page. Elements are unobserved after
 * first reveal — nothing animates back out on scroll up.
 */
function useReveal() {
  const location = useLocation()

  useEffect(() => {
    // Reduced motion: never hide anything in the first place.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!targets.length) return

    document.documentElement.classList.add('js-reveal')

    const reveal = (el: HTMLElement) => {
      el.classList.add('is-in')
      io.unobserve(el)
    }

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          // Reveal everything above it too: a jump-scroll (anchor link, scroll
          // restore) never intersects the elements it skipped past, and they
          // would otherwise stay invisible until scrolled back over.
          const index = targets.indexOf(entry.target as HTMLElement)
          for (let i = 0; i <= index; i++) reveal(targets[i])
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )

    for (const el of targets) io.observe(el)
    return () => io.disconnect()
  }, [location.pathname])
}

/** Every route change starts at the top — SPA links otherwise keep the offset. */
function useScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0)
  }, [pathname])
}

const NAV = [
  { to: '/features', label: 'Features' },
  { to: '/solutions', label: 'Solutions' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/pricing-public', label: 'Pricing' },
  { to: '/security', label: 'Security' },
]

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link to="/" className="focus-ring flex items-center gap-2 rounded-md" aria-label={`${SITE_NAME} home`}>
      <div
        className={`${small ? 'w-6 h-6 text-[13px]' : 'w-7 h-7 text-sm'} bg-accent rounded-btn flex items-center justify-center text-white font-bold`}
        aria-hidden="true"
      >
        M
      </div>
      <div className={`${small ? 'text-[15px]' : 'text-base'} font-semibold tracking-[-0.02em] text-ink`}>
        Meet<span className="text-accent">Master</span>
      </div>
    </Link>
  )
}

/**
 * The one primary action on the site: start with Google. Every page uses this
 * component, so height, radius, weight, and hover are identical everywhere.
 */
export function PrimaryCta({
  label = 'Get started',
  size = 'md',
  className = '',
}: {
  label?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const pad = size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-11 px-5 text-sm'
  return (
    <a
      href="/auth/google"
      className={`focus-ring inline-flex items-center justify-center gap-2 rounded-btn bg-accent font-medium text-white
        transition-colors hover:bg-accent-hover active:bg-accent-hover ${pad} ${className}`}
    >
      {label}
      <Icon name="arrowRight" size={size === 'sm' ? 15 : 16} />
    </a>
  )
}

/** Secondary action — outlined, never coloured, never more prominent. */
export function SecondaryCta({
  to,
  label,
  size = 'md',
  icon,
}: {
  to: string
  label: string
  size?: 'sm' | 'md'
  icon?: IconName
}) {
  const pad = size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-11 px-5 text-sm'
  return (
    <Link
      to={to}
      className={`btn-outline focus-ring inline-flex items-center justify-center gap-2 font-medium ${pad}`}
    >
      {icon && <Icon name={icon} size={16} className="text-slate-500" />}
      {label}
    </Link>
  )
}

/** Text link with an arrow — the "read more" affordance across detail pages. */
export function ArrowLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="focus-ring group inline-flex items-center gap-1.5 rounded py-1.5 text-[13px] font-medium text-accent hover:underline"
    >
      {label}
      <Icon name="arrowRight" size={15} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

/** One container width for every public page. */
const WIDTH = 'max-w-6xl'

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${WIDTH} mx-auto w-full px-5 sm:px-8 ${className}`}>{children}</div>
}

const FOOTER_COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { to: '/features', label: 'Features' },
      { to: '/features/live-transcription', label: 'Live transcription' },
      { to: '/features/ai-summaries', label: 'AI summaries' },
      { to: '/integrations', label: 'Integrations' },
      { to: '/pricing-public', label: 'Pricing' },
    ],
  },
  {
    heading: 'Solutions',
    links: [
      { to: '/solutions/individuals', label: 'For individuals' },
      { to: '/solutions/teams', label: 'For teams' },
      { to: '/solutions/sales', label: 'For sales calls' },
      { to: '/solutions/interviews', label: 'For interviews' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/contact', label: 'Contact' },
      { to: '/faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { to: '/security', label: 'Security' },
      { to: '/privacy', label: 'Privacy Policy' },
      { to: '/terms', label: 'Terms of Service' },
    ],
  },
]

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes it; the sheet is only in the DOM while open so nothing
  // focusable hides behind it for keyboard or screen-reader users.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div id="mobile-nav" className="md:hidden border-t border-slate-200 bg-white">
      <Container className="py-4">
        <nav aria-label="Main" className="flex flex-col">
          {NAV.map(item => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="focus-ring rounded-btn -mx-2 px-2 py-3 text-[15px] font-medium text-ink hover:bg-slate-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4">
          <PrimaryCta label="Get started" className="w-full" />
          <a
            href="/auth/google"
            className="btn-outline focus-ring inline-flex h-11 items-center justify-center text-sm font-medium"
          >
            Log in
          </a>
        </div>
      </Container>
    </div>
  )
}

export function PublicShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useReveal()
  useScrollTop()

  // A route change from inside the sheet closes it.
  useEffect(() => setMenuOpen(false), [pathname])

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
          focus:rounded-btn focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <Container className="flex h-16 items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <Logo />
            <nav aria-label="Main" className="hidden md:flex items-center gap-6">
              {NAV.map(item => {
                const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`focus-ring rounded text-[14px] transition-colors ${
                      active ? 'font-medium text-ink' : 'text-slate-600 hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="hidden md:flex items-center gap-5">
            <a href="/auth/google" className="focus-ring rounded text-[14px] text-slate-600 hover:text-ink">
              Log in
            </a>
            <PrimaryCta size="sm" />
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="focus-ring md:hidden -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-btn text-ink hover:bg-slate-50"
          >
            <Icon name={menuOpen ? 'x' : 'menu'} size={20} />
          </button>
        </Container>
        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      </header>

      <main id="main" className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-slate-50/60">
        <Container className="py-14">
          {/* Two columns on mobile: four stacked link lists made the footer taller
              than the page it sits under. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-9 md:grid-cols-[1.4fr_repeat(4,1fr)] md:gap-10">
            <div className="col-span-2 max-w-xs md:col-span-1">
              <Logo small />
              <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
                Meeting notes as a side effect of the meeting. Google Meet, Zoom, and Microsoft Teams.
              </p>
            </div>
            {FOOTER_COLUMNS.map(col => (
              <nav key={col.heading} aria-label={col.heading}>
                <h2 className="mb-3 text-[13px] font-semibold text-ink">{col.heading}</h2>
                {/* py-1.5 lifts each link to a ~28px target without changing the
                    visual rhythm — the gap shrinks by the padding it gains. */}
                <ul className="flex flex-col text-[13px]">
                  {col.links.map(link => (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        className="focus-ring inline-block rounded py-1.5 text-slate-600 transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">© {new Date().getFullYear()} {SITE_NAME}</p>
            <p className="max-w-lg text-xs text-slate-500 sm:text-right">
              Recording laws vary by jurisdiction — you are responsible for consent from everyone on the call.
            </p>
          </div>
        </Container>
      </footer>
    </div>
  )
}

/* ── Page primitives ─────────────────────────────────────────────────────── */

export function Eyebrow({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.1em] text-accent">
      {icon && <Icon name={icon} size={14} />}
      {children}
    </p>
  )
}

/**
 * Page heading block: exactly one h1 per page comes from here.
 *
 * `aside` puts a product surface beside the copy — pages that have a relevant
 * one should pass it, so no page opens on a half-empty band of text.
 */
export function PageHeader({
  eyebrow,
  title,
  sub,
  children,
  aside,
  badge,
}: {
  eyebrow?: string
  title: string
  sub?: string
  children?: ReactNode
  aside?: ReactNode
  /** Optional mark above the title — integration pages show the partner logo. */
  badge?: ReactNode
}) {
  return (
    <header className="hero-wash relative overflow-hidden border-b border-slate-200">
      <div className="grid-wash pointer-events-none absolute inset-0" aria-hidden="true" />
      <Container
        className={`relative py-16 sm:py-20 ${
          aside ? 'grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-center lg:gap-16' : ''
        }`}
      >
        <div data-reveal className={aside ? '' : 'max-w-3xl'}>
          {badge && (
            <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-card border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.05)]">
              {badge}
            </span>
          )}
          {eyebrow && <div className="mb-4"><Eyebrow>{eyebrow}</Eyebrow></div>}
          <h1 className="display text-[34px] leading-[1.08] sm:text-[46px]">{title}</h1>
          {sub && <p className="measure mt-5 text-[16px] leading-relaxed text-slate-600 sm:text-[17px]">{sub}</p>}
          {children && <div className="mt-8">{children}</div>}
        </div>
        {aside && <div data-reveal className="min-w-0">{aside}</div>}
      </Container>
    </header>
  )
}

/** Section header: label + h2 + optional one-liner. */
export function SectionHead({ label, title, sub, id, center = false }: {
  label?: string
  title: string
  sub?: string
  id: string
  center?: boolean
}) {
  return (
    <div data-reveal className={`mb-10 ${center ? 'mx-auto max-w-2xl text-center' : ''}`}>
      {label && <div className={`mb-3 ${center ? 'flex justify-center' : ''}`}><Eyebrow>{label}</Eyebrow></div>}
      <h2 id={id} className="display text-[26px] leading-tight sm:text-[32px]">{title}</h2>
      {sub && (
        <p className={`mt-4 text-[16px] leading-relaxed text-slate-600 ${center ? 'mx-auto max-w-xl' : 'measure'}`}>
          {sub}
        </p>
      )}
    </div>
  )
}

export function Section({ children, label, title, sub, id, center, divide = true, tinted = false }: {
  children: ReactNode
  label?: string
  title: string
  sub?: string
  id: string
  center?: boolean
  divide?: boolean
  tinted?: boolean
}) {
  return (
    <section
      aria-labelledby={id}
      className={`${tinted ? 'bg-slate-50/70' : ''} ${divide ? 'border-b border-slate-200' : ''}`}
    >
      <Container className="py-16 sm:py-24">
        <SectionHead label={label} title={title} sub={sub} id={id} center={center} />
        <div data-reveal>{children}</div>
      </Container>
    </section>
  )
}

/**
 * Feature/benefit tile. Icon, heading, one paragraph, and — when it links
 * somewhere — an arrow that moves on hover. A hairline of brand colour appears
 * along the top edge on hover so the card reads as interactive without
 * floating, glowing, or growing a shadow.
 */
export function Tile({
  icon,
  media,
  title,
  body,
  to,
}: {
  icon?: IconName
  /** Overrides the icon slot — used for integration brand marks. */
  media?: ReactNode
  title: string
  body: string
  to?: string
}) {
  const inner = (
    <>
      {to && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 rounded-t-card bg-gradient-to-r from-accent to-[#5B7BEA] transition-transform duration-300 group-hover:scale-x-100"
        />
      )}
      {media ? (
        <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-btn border border-slate-200 bg-white">
          {media}
        </span>
      ) : icon ? (
        <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-btn bg-accent-light text-accent ring-1 ring-inset ring-accent/10 transition-colors group-hover:bg-accent group-hover:text-white">
          <Icon name={icon} size={19} />
        </span>
      ) : null}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{body}</p>
      {to && (
        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
          Learn more
          <Icon name="arrowRight" size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
        </span>
      )}
    </>
  )
  const className =
    'surface group relative isolate flex flex-col overflow-hidden p-6 transition-colors hover:border-slate-300'
  return to ? (
    <Link to={to} className={`${className} focus-ring`}>{inner}</Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}

/** Numbered steps on a rule — used for every "how it works" block. */
export function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.title} className="tint bg-white p-6">
          <span className="font-mono text-xs font-medium text-accent">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="mt-3 text-[15px] font-semibold text-ink">{step.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}

/** Checked capability list. The check is decorative; the text carries meaning. */
export function CheckList({ items, columns = 1 }: { items: string[]; columns?: 1 | 2 }) {
  return (
    <ul className={`grid gap-3 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {items.map(item => (
        <li key={item} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink">
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Closing conversion band — the one solid-brand surface on the site.
 * White text on the gradient's darkest third; the CTA inverts to white so it
 * still reads as the primary action.
 */
export function CtaBand({ title, sub }: { title: string; sub: string }) {
  return (
    <section aria-labelledby="cta" className="border-b border-slate-200">
      <Container className="py-20 sm:py-24">
        <div data-reveal className="brand-gradient relative overflow-hidden rounded-frame px-6 py-16 text-center sm:px-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[.18]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(60ch 24ch at 50% 0%, #000, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(60ch 24ch at 50% 0%, #000, transparent 70%)',
            }}
          />
          <div className="relative">
            <h2 id="cta" className="mx-auto max-w-2xl text-[26px] font-semibold leading-tight tracking-[-0.028em] text-white sm:text-[34px]">
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-white/90">{sub}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="/auth/google"
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-btn bg-white px-5 text-sm font-medium text-accent transition-colors hover:bg-slate-100"
              >
                Start free with Google
                <Icon name="arrowRight" size={16} />
              </a>
              <Link
                to="/pricing-public"
                className="focus-ring inline-flex h-11 items-center justify-center rounded-btn border border-white/40 px-5 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                See pricing
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-white/85">5 recorded meetings a month on the free plan. No card.</p>
          </div>
        </div>
      </Container>
    </section>
  )
}

/** Native disclosure — accordion behaviour with no JS and no library. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="border-t border-slate-200">
      {items.map(item => (
        <details key={item.q} className="group border-b border-slate-200">
          <summary className="focus-ring -mx-3 flex cursor-pointer list-none items-start gap-4 rounded-btn px-3 py-5 transition-colors hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            <span className="flex-1 text-[15px] font-medium text-ink sm:text-base">{item.q}</span>
            <span className="mt-0.5 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-45">
              <Icon name="x" size={18} className="rotate-45" />
            </span>
          </summary>
          <p className="measure -mt-1 pb-6 text-[15px] leading-relaxed text-slate-600">{item.a}</p>
        </details>
      ))}
    </div>
  )
}

/** Long-form body copy for the info pages: hairline-separated, no card. */
export function Prose({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section data-reveal className="border-b border-slate-200 py-8 last:border-0 sm:grid sm:grid-cols-[220px_1fr] sm:gap-10">
      <h2 className="mb-3 text-[15px] font-semibold text-ink sm:mb-0">{heading}</h2>
      <div className="measure flex flex-col gap-3 text-[15px] leading-relaxed text-slate-600">{children}</div>
    </section>
  )
}
