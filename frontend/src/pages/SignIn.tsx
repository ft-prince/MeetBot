import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function SignIn() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = params.get('auth_error')

  // Already signed in — go to dashboard
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [loading, user, navigate])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-app-bg">
        <div className="text-muted text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-[#FAF9F6] text-ink font-sans antialiased flex flex-col">
      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <nav className="flex-shrink-0 max-w-[1400px] w-full mx-auto px-[5%] py-5 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 text-2xl font-extrabold text-accent tracking-tight">
          <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          NoteAI
        </a>
        <div className="hidden sm:flex gap-10 items-center">
          <a href="#features" className="relative text-base font-semibold text-accent after:content-[''] after:absolute after:-bottom-1 after:left-0 after:w-full after:h-0.5 after:bg-accent after:rounded-sm">
            Features
          </a>
        </div>
      </nav>

      {/* ── Hero + Auth Card (fills remaining height) ───────────────────── */}
      <main className="flex-1 min-h-0 max-w-[1400px] w-full mx-auto px-[5%] pb-6 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
        {/* Hero copy + compact features */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.1em] text-accent">
            <span className="w-7 h-0.5 bg-accent" />
            Meeting Intelligence
          </div>
          <h1 className="text-5xl xl:text-6xl font-extrabold leading-[1.05] tracking-[-0.02em] text-[#1a1a1a]">
            Every meeting,
            <span className="block text-accent">captured &amp; transcribed.</span>
          </h1>
          <p className="text-lg text-muted max-w-[520px] leading-relaxed">
            Stop taking notes. NoteAI joins your calls, records audio, and delivers searchable transcripts automatically.
          </p>

          {/* Inline compact features */}
          <div id="features" className="grid grid-cols-2 gap-x-6 gap-y-4 mt-3 max-w-[560px]">
            <Feature
              title="Calendar sync"
              desc="Imported automatically."
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
            />
            <Feature
              title="Auto-join bot"
              desc="Meet, Zoom &amp; Teams."
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" />
                </svg>
              }
            />
            <Feature
              title="AI transcription"
              desc="Speaker identification."
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
            />
            <Feature
              title="AI summaries"
              desc="Action items &amp; insights."
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-[20px] p-10 lg:p-12 border border-black/[0.03] shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05),0_2px_8px_-1px_rgba(0,0,0,0.03)] w-full max-w-md justify-self-center lg:justify-self-end">
          <h2 className="text-3xl font-extrabold tracking-tight mb-3">Welcome back</h2>
          <p className="text-base text-muted mb-8">Sign in with your Google account to continue.</p>

          {error && (
            <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 mb-6 text-sm font-semibold">
              Sign-in failed: {error.replace(/_/g, ' ')}
            </div>
          )}

          <a
            href="/auth/google"
            className="flex items-center justify-center gap-3 w-full py-3.5 px-4 border-[1.5px] border-gray-200 rounded-[10px] bg-white font-semibold text-base hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>

          <div className="flex items-center gap-4 my-7 text-[11px] font-bold tracking-wider uppercase text-gray-300">
            <span className="flex-1 h-px bg-gray-100" />
            secure - encrypted
            <span className="flex-1 h-px bg-gray-100" />
          </div>

          <div className="text-center text-sm text-muted leading-relaxed">
            By signing in you agree to our <a href="#" className="text-accent font-semibold hover:underline">Terms of Service</a>.
            <br />
            Your Google account is used only to authenticate and access your calendar.
          </div>
        </div>
      </main>
    </div>
  )
}

function Feature({ title, desc, icon }: { title: string; desc: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-[#FFF0E9] text-accent rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <h4 className="text-base font-bold leading-tight">{title}</h4>
        <p className="text-sm text-muted leading-snug mt-1">{desc}</p>
      </div>
    </div>
  )
}
