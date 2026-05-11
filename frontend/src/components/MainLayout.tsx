import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useLiveMeetings } from '../hooks/useLiveMeetings'

export function MainLayout() {
  const { meetings } = useLiveMeetings()
  return (
    <div className="flex min-h-screen">
      <Sidebar liveCount={meetings.size} />
      <main className="ml-60 flex-1 flex flex-col min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
