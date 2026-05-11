export function Topbar({ title, subtitle, right }: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <div className="bg-white border-b border-gray-200 px-8 py-3.5 flex items-center gap-3">
      <span className="text-lg font-bold text-ink flex-1">{title}</span>
      {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      {right}
    </div>
  )
}
