import { useSidebarToggle } from './MainLayout'

export function Topbar({ title, subtitle, right }: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  const { toggle } = useSidebarToggle()
  return (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 sm:px-6 py-3.5 flex items-center gap-3">
      <button
        onClick={toggle}
        className="lg:hidden p-1.5 rounded-md text-muted hover:bg-app-bg transition-colors"
        aria-label="Open sidebar"
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span className="text-lg font-bold text-ink flex-1">{title}</span>
      {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      {right}
    </div>
  )
}