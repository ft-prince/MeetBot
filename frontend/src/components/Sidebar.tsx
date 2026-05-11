import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems: { to: string; label: string; section: string; icon: JSX.Element }[] = [
  {
    section: 'Workspace',
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    section: 'Workspace',
    to: '/live',
    label: 'Live Recording',
    icon: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    section: 'Workspace',
    to: '/calendar',
    label: 'Calendar',
    icon: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    section: 'Meetings',
    to: '/meetings',
    label: 'All Meetings',
    icon: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
      </svg>
    ),
  },
  {
    section: 'Account',
    to: '/profile',
    label: 'Profile',
    icon: (
      <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
]

export function Sidebar({ liveCount }: { liveCount: number }) {
  const { user, signOut } = useAuth()
  const ini = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''

  // Group items by section
  const sections: Record<string, typeof navItems> = {}
  for (const item of navItems) {
    if (!sections[item.section]) sections[item.section] = []
    sections[item.section].push(item)
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-white border-r border-gray-200 z-50 flex flex-col">
      <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white text-base font-extrabold">⬡</div>
        <div className="text-xl font-extrabold tracking-tight"><span className="text-accent">Note</span>AI</div>
      </div>

      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-2">
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest px-2 py-1.5">{section}</div>
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                   ${isActive ? 'bg-accent-light text-accent font-semibold' : 'text-muted hover:bg-app-bg hover:text-ink'}`
                }
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.to === '/live' && liveCount > 0 && (
                  <span className="bg-accent text-white text-[10px] font-bold px-1.5 rounded-full">{liveCount}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-gray-200">
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden">
              {user.picture ? <img src={user.picture} alt="" className="w-full h-full object-cover" /> : ini}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-ink truncate">{user.name}</div>
              <div className="text-[11px] text-muted truncate">{user.email}</div>
            </div>
            <button
              onClick={signOut}
              className="px-2 py-1 text-[11px] text-muted border border-gray-200 rounded-md hover:border-danger hover:text-danger transition-colors"
            >
              Out
            </button>
          </div>
        ) : (
          <a
            href="/auth/google"
            className="flex items-center justify-center gap-2 px-3 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Connect Google
          </a>
        )}
      </div>
    </aside>
  )
}
