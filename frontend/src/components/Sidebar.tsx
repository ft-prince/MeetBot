import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems: { to: string; label: string; section: string; icon: JSX.Element; adminOnly?: boolean }[] = [
  { section: "Workspace", to: "/", label: "Dashboard",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg> },
  { section: "Workspace", to: "/live", label: "Live Recording",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg> },
  { section: "Workspace", to: "/calendar", label: "Calendar",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> },
  { section: "Meetings", to: "/meetings", label: "All Meetings",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg> },
  { section: "Email Intelligence", to: "/emails", label: "Email Inbox",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg> },
  { section: "Email Intelligence", to: "/emails/dashboard", label: "Email Dashboard",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> },
  { section: "Account", to: "/profile", label: "Profile",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
  { section: "Account", to: "/guide", label: "How to Use",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg> },
  { section: "Account", to: "/pricing", label: "Pricing",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
  { section: "Admin", to: "/admin", label: "Admin", adminOnly: true,
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> },
  { section: "Account", to: "/help", label: "Help & Support",
    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" strokeLinecap="round" /></svg> },
]

interface SidebarProps {
  liveCount: number
  isOpen: boolean
  onClose: () => void
}

// Pick which nav item is active for a path: the one whose `to` is the LONGEST
// matching prefix. This makes nested routes highlight the right item — e.g.
// `/emails/dashboard` activates "Email Dashboard" (not "Email Inbox", whose
// `/emails` is a shorter prefix), and `/emails/:id` / `/meetings/:id` activate
// their parent. NavLink's default prefix matching can't express "deepest wins",
// which is what caused Inbox to stay highlighted on the Email Dashboard.
function activeNavTo(pathname: string): string | null {
  let best: string | null = null
  for (const { to } of navItems) {
    const matches = to === '/' ? pathname === '/' : (pathname === to || pathname.startsWith(to + '/'))
    if (matches && (best === null || to.length > best.length)) best = to
  }
  return best
}

export function Sidebar({ liveCount, isOpen, onClose }: SidebarProps) {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const activeTo = activeNavTo(pathname)
  const ini = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
  const sections: Record<string, typeof navItems> = {}
  for (const item of navItems) {
    if (item.adminOnly && !user?.isAdmin) continue
    if (!sections[item.section]) sections[item.section] = []
    sections[item.section].push(item)
  }
  const cls = isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
  return (
    <aside className={"fixed top-0 left-0 h-screen w-60 bg-white border-r border-gray-200 z-50 flex flex-col transition-transform duration-200 " + cls}>
      <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2.5">
        <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center text-white text-base font-extrabold">M</div>
        <div className="text-xl font-extrabold tracking-tight"><span className="text-accent">Meet</span>Master</div>
        <button onClick={onClose} className="ml-auto lg:hidden p-1 rounded-md text-muted hover:bg-app-bg" aria-label="Close sidebar">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-2">
            <div className="text-[10px] font-bold text-muted uppercase tracking-widest px-2 py-1.5">{section}</div>
            {items.map(item => {
              const isActive = activeTo === item.to
              return (
              <Link key={item.to} to={item.to} onClick={onClose}
                aria-current={isActive ? 'page' : undefined}
                className={'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ' + (isActive ? 'bg-accent-light text-accent font-semibold' : 'text-muted hover:bg-app-bg hover:text-ink')}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.to === "/live" && liveCount > 0 && (<span className="bg-accent text-white text-[10px] font-bold px-1.5 rounded-full">{liveCount}</span>)}
              </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-gray-200">
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden">
              {user.picture ? <img src={user.picture} alt="" className="w-full h-full object-cover" /> : ini}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-ink truncate">{user.name}</div>
              <div className="text-[11px] text-muted truncate">{user.email}</div>
            </div>
            <button onClick={signOut} className="px-2 py-1 text-[11px] text-muted border border-gray-200 rounded-md hover:border-danger hover:text-danger transition-colors">Exit</button>
          </div>
        ) : (
          <a href="/auth/google" className="flex items-center justify-center gap-2 px-3 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
            Connect Google
          </a>
        )}
      </div>
    </aside>
  )
}