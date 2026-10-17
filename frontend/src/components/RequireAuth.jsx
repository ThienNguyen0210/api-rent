import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useI18n } from '../i18n/index.jsx'
export default function RequireAuth({ children }) {
  const { user, ready } = useAuth()
  const { t } = useI18n()
  if (!ready) return <div className="state">{t('app.loading')}</div>
  return user ? children : <Navigate to="/login" replace />
}
