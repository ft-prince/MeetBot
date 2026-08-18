import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Landing } from '../marketing/Landing'

/**
 * Used as a layout route element. When authenticated it renders the nested
 * routes via <Outlet>; otherwise redirects to /signin preserving the intended
 * destination so the user lands back after sign-in.
 *
 * "/" is the one exception: signed out it renders the public landing page
 * instead of redirecting, so the marketing site and the Dashboard share a URL.
 * Nothing renders until `loading` clears, so neither one flashes.
 */
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <div className="text-muted text-sm">Loading…</div>
      </div>
    )
  }

  if (!user) {
    if (location.pathname === '/') return <Landing />
    return <Navigate to="/signin" state={{ from: location }} replace />
  }

  return <Outlet />
}
