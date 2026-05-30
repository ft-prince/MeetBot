import { createContext, useContext, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useLiveMeetings } from '../hooks/useLiveMeetings'

interface SidebarCtxValue {
  toggle: () => void
}

const SidebarCtx = createContext<SidebarCtxValue>({ toggle: () => {} })

export function useSidebarToggle(): SidebarCtxValue {
  return useContext(SidebarCtx)
}

export function MainLayout() {
  const { meetings } = useLiveMeetings()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <SidebarCtx.Provider value={{ toggle: () => setIsOpen(o => !o) }}>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setIsOpen(false)}
          />
        )}

        <Sidebar
          liveCount={meetings.size}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />

        <main className="lg:ml-60 flex-1 flex flex-col min-w-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </SidebarCtx.Provider>
  )
}
