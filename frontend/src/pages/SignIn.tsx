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
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="text-muted text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white text-xl font-extrabold">⬡</div>
          <span className="text-2xl font-extrabold tracking-tight">
            <span className="text-accent">Note</span>AI
          </span>
        </div>

        <div className="card p-8 text-center">
          <h1 className="text-xl font-extrabold mb-1">Welcome back</h1>
          <p className="text-sm text-muted mb-8">Sign in to access your meeting recordings, transcripts, and AI summaries.</p>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              Sign-in failed: {error.replace(/_/g, ' ')}
            </div>
          )}

          <a
            href="/auth/google"
            className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-ink hover:bg-gray-50 hover:border-gray-400 transition-colors shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </a>

          <p className="mt-6 text-xs text-muted leading-relaxed">
            NoteAI uses Google OAuth to access your Calendar and record meetings.<br />
            Your data is only visible to you.
          </p>
        </div>
      </div>
    </div>
  )
}
