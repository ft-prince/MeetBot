import { Navigate, Route, Routes } from 'react-router-dom'
import { MainLayout } from './components/MainLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LiveMeetingsProvider } from './hooks/useLiveMeetings'
import { Dashboard } from './pages/Dashboard'
import { LiveRecording } from './pages/LiveRecording'
import { Calendar } from './pages/Calendar'
import { AllMeetings } from './pages/AllMeetings'
import { MeetingDetail } from './pages/MeetingDetail'
import { Profile } from './pages/Profile'
import { HelpSupport } from './pages/HelpSupport'
import { SignIn } from './pages/SignIn'

export default function App() {
  return (
    <LiveMeetingsProvider>
      <Routes>
        {/* Public */}
        <Route path="/signin" element={<SignIn />} />

        {/* Auth gate — redirects to /signin when no session */}
        <Route element={<ProtectedRoute />}>
          {/* App shell with sidebar */}
          <Route element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="live" element={<LiveRecording />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="meetings" element={<AllMeetings />} />
            <Route path="meetings/:id" element={<MeetingDetail />} />
            <Route path="profile" element={<Profile />} />
            <Route path="help" element={<HelpSupport />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LiveMeetingsProvider>
  )
}