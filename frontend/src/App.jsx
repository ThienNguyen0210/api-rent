import { Routes, Route, Navigate } from 'react-router-dom'
import MarketingLayout from './layouts/MarketingLayout.jsx'
import DashboardLayout from './layouts/DashboardLayout.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import ContactBubble from './components/ContactBubble.jsx'
import Home from './pages/Home.jsx'
import Pricing from './pages/Pricing.jsx'
import Login from './pages/Login.jsx'
import Overview from './pages/dashboard/Overview.jsx'
import ApiKeys from './pages/dashboard/ApiKeys.jsx'
import Models from './pages/dashboard/Models.jsx'
import Cache from './pages/dashboard/Cache.jsx'
import Chat from './pages/dashboard/Chat.jsx'
import Billing from './pages/dashboard/Billing.jsx'
import Deposit from './pages/dashboard/Deposit.jsx'
import Referral from './pages/dashboard/Referral.jsx'
import Support from './pages/dashboard/Support.jsx'
import Notifications from './pages/dashboard/Notifications.jsx'
import Notes from './pages/dashboard/Notes.jsx'
import Settings from './pages/dashboard/Settings.jsx'
import Terms from './pages/Terms.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import ErrorPage from './pages/error.jsx'

export default function App() {
  return (
    <>
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route index element={<Home />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="login" element={<Login />} />
        <Route path="terms" element={<Terms />} />
        {/* Catch-all: any unknown URL shows the 404 page */}
        <Route path="*" element={<ErrorPage />} />
      </Route>
      {/* Password-protected by ADMIN_PASSWORD (see backend/src/services/adminService.js) */}
      <Route path="admin-panel" element={<AdminPanel />} />
      <Route path="dashboard" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="keys" element={<ApiKeys />} />
        {/* Usage was merged into Overview; keep old links and bookmarks working */}
        <Route path="usage" element={<Navigate to="/dashboard" replace />} />
        <Route path="cache" element={<Cache />} />
        <Route path="models" element={<Models />} />
        <Route path="chat" element={<Chat />} />
        <Route path="billing" element={<Billing />} />
        <Route path="deposit" element={<Deposit />} />
        <Route path="referral" element={<Referral />} />
        <Route path="support" element={<Support />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="notes" element={<Notes />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
    <ContactBubble />
    </>
  )
}
