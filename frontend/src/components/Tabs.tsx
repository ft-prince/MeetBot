import { useEffect, useRef, useState } from 'react'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = () => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState)
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', updateScrollState); ro.disconnect() }
  }, [tabs])

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' })
  }

  const select = (id: string) => {
    setActive(id)
    onChange?.(id)
    // Scroll the active tab into view
    const el = scrollRef.current
    if (!el) return
    const btn = el.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)
    btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="card overflow-hidden">
      {/* Tab strip */}
      <div className="relative border-b border-gray-200 bg-app-bg flex items-stretch">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="flex-shrink-0 z-10 px-2 bg-app-bg hover:bg-white text-muted hover:text-ink transition-colors border-r border-gray-200"
            aria-label="Scroll tabs left"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {/* Scrollable tab list */}
        <div
          ref={scrollRef}
          className="flex items-stretch overflow-x-auto scrollbar-none flex-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {tabs.map(t => {
            const isActive = t.id === active
            return (
              <button
                key={t.id}
                data-tab={t.id}
                onClick={() => select(t.id)}
                className={
                  'px-4 py-3 text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors border-b-2 flex-shrink-0 ' +
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

        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="flex-shrink-0 z-10 px-2 bg-app-bg hover:bg-white text-muted hover:text-ink transition-colors border-l border-gray-200"
            aria-label="Scroll tabs right"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Right fade gradient — always visible when there's overflow to the right */}
        {canScrollRight && (
          <div className="absolute right-8 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-r from-transparent to-app-bg" />
        )}
      </div>

      <div className="bg-white">{renderContent(active)}</div>
    </div>
  )
}
