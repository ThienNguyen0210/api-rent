import { Link } from 'react-router-dom'

export default function ErrorPage() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: '4rem', margin: 0 }}>404</h1>
      <h2 style={{ margin: '0.5rem 0' }}>Page Not Found</h2>
      <p style={{ opacity: 0.7, maxWidth: '28rem' }}>
        The page you're looking for doesn't exist or may have been moved.
      </p>
      <Link to="/" style={{ marginTop: '1.5rem' }}>
        Back to home
      </Link>
    </div>
  )
}