import { useState } from 'react'

export interface TabDef {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: string | number | null
}

interface Props {
  tabs: TabDef[]
  defaultId?: string
  onChange?: (id: string) => void
  renderContent: (id: string) => React.ReactNode
}

export function Tabs({ tabs, defaultId, onChange, renderContent }: Props) {
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id ?? '')

  const select = (id: string) => {
    setActive(id)
    onChange?.(id)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-stretch overflow-x-auto border-b border-gray-200 bg-app-bg">
        {tabs.map(t => {
          const isActive = t.id === active
          return (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={
                'px-4 py-3 text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors border-b-2 ' +
                (isActive
                  ? 'text-accent border-accent bg-white'
                  : 'text-muted border-transparent hover:text-ink hover:bg-white/60')
              }
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge !== undefined && t.badge !== null && t.badge !== 0 && (
                <span
                  className={
                    'ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ' +
                    (isActive ? 'bg-accent text-white' : 'bg-gray-200 text-gray-700')
                  }
                >
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="bg-white">{renderContent(active)}</div>
    </div>
  )
}
