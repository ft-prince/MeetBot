import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Container, PublicShell, usePageMeta } from '../marketing/shell'
import { Icon, type IconName } from '../marketing/icons'

/**
 * The sign-in page is a public entry point, so it wears the same chrome, type,
 * and surfaces as the marketing site — only the card is specific to it.
 */
const POINTS: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'calendar', title: 'Calendar auto-join', desc: 'The bot turns up on its own.' },
  { icon: 'mic', title: 'Live transcription', desc: 'Speaker labels as the call runs.' },
  { icon: 'sparkles', title: 'AI summaries', desc: 'Decisions and action items.' },
  { icon: 'video', title: 'Meet, Zoom, Teams', desc: 'One bot, three platforms.' },
]

export function SignIn() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = params.get('auth_error')

  usePageMeta(
    'Sign in — MeetMaster',
    'Sign in to MeetMaster with your Google account to record, transcribe, and summarise your meetings.',
  )

  // Already signed in — go to dashboard
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [loading, user, navigate])

  // Session check in flight. Keeps the site's chrome and brand rather than
  // flashing an unstyled white screen between the marketing site and the app.
  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent text-base font-bold text-white" aria-hidden="true">
          M
        </span>
        <p role="status" className="text-sm text-slate-500">Checking your session…</p>
      </div>
    )
  }

  return (
    <PublicShell>
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div data-reveal>
          <p className="text-[12px] font-semibold uppercase tracking-[.1em] text-accent">Meeting intelligence</p>
          <h1 className="display mt-4 text-[30px] leading-[1.06] lg:text-[40px]">Every meeting, written down.</h1>
          <p className="measure mt-5 text-[16px] leading-relaxed text-slate-600 lg:text-[17px]">
            Stop taking notes. MeetMaster joins your calls, transcribes them with speaker labels, and
            sends the summary when everyone hangs up.
          </p>
          {/* The proof points are supporting detail — the card comes first on mobile. */}
          <ul className="mt-10 hidden gap-6 sm:grid-cols-2 lg:grid">
            {POINTS.map(p => (
              <li key={p.title} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-accent-light text-accent">
                  <Icon name={p.icon} size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-ink">{p.title}</h2>
                  <p className="mt-1 text-[14px] leading-snug text-slate-600">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div data-reveal className="surface mx-auto w-full max-w-md p-8 sm:p-10 lg:justify-self-end">
          <h2 className="display text-[24px] leading-tight">Welcome back</h2>
          <p className="mt-2 text-[15px] text-slate-600">
            Sign in with your Google account to continue.
          </p>

          {error && (
            <p role="alert" className="mt-6 rounded-btn border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
              Sign-in failed: {error.replace(/_/g, ' ')}
            </p>
          )}

          <a
            href="/auth/google"
            className="focus-ring mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-btn border border-slate-300 bg-white text-[15px] font-medium text-ink transition-colors hover:bg-slate-50"
          >
            {/* Google's own mark — not redrawn, not substituted with a generic icon. */}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>

          <p className="mt-6 border-t border-slate-200 pt-6 text-[13px] leading-relaxed text-slate-500">
            By signing in you agree to our{' '}
            <Link to="/terms" className="focus-ring rounded font-medium text-accent hover:underline">Terms of Service</Link>{' '}
            and{' '}
            <Link to="/privacy" className="focus-ring rounded font-medium text-accent hover:underline">Privacy Policy</Link>.
            Your Google account is used only to authenticate and to access the data you grant.
          </p>
        </div>
      </Container>
    </PublicShell>
  )
}
