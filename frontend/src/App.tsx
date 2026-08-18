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
import { HowToUse } from './pages/HowToUse'
import { Pricing } from './pages/Pricing'
import { SignIn } from './pages/SignIn'
import { EmailInbox } from './pages/EmailInbox'
import { EmailThreadDetail } from './pages/EmailThreadDetail'
import { EmailDashboard } from './pages/EmailDashboard'
import { Admin } from './pages/Admin'
import { Privacy, Terms } from './pages/Legal'
import { FeatureDetail, Features } from './marketing/Features'
import { SolutionDetail, Solutions } from './marketing/Solutions'
import { IntegrationDetail, Integrations } from './marketing/Integrations'
import { FaqPage } from './marketing/FaqPage'
import { PricingPublic } from './marketing/PricingPublic'
import { About, Contact, Security } from './marketing/Info'

export default function App() {
  return (
    <LiveMeetingsProvider>
      <Routes>
        {/* Public — Google OAuth verification requires these to be reachable
            without signing in. */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        {/* Public marketing pages. "/" is handled by ProtectedRoute below: it
            renders <Landing /> when signed out and the Dashboard when signed in. */}
        <Route path="/features" element={<Features />} />
        <Route path="/features/:slug" element={<FeatureDetail />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/solutions/:slug" element={<SolutionDetail />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/integrations/:slug" element={<IntegrationDetail />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/pricing-public" element={<PricingPublic />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/security" element={<Security />} />

        {/* Auth gate — redirects to /signin when no session */}
        <Route element={<ProtectedRoute />}>
          {/* App shell with sidebar */}
          <Route element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="live" element={<LiveRecording />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="meetings" element={<AllMeetings />} />
            <Route path="meetings/:id" element={<MeetingDetail />} />
            <Route path="emails" element={<EmailInbox />} />
            <Route path="emails/dashboard" element={<EmailDashboard />} />
            <Route path="emails/:id" element={<EmailThreadDetail />} />
            <Route path="profile" element={<Profile />} />
            <Route path="guide" element={<HowToUse />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="help" element={<HelpSupport />} />
            {/* The API enforces admin access; this route only hides the link. */}
            <Route path="admin" element={<Admin />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LiveMeetingsProvider>
  )
}