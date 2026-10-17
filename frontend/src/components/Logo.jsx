import { Link } from 'react-router-dom'
import logoImage from '../assets/logo.png'

export default function Logo() {
  return (
    <Link to="/" className="logo">
      <img
        src={logoImage}
        alt="NEXORA Logo"
        className="logo-img"
        // Thêm style trực tiếp ở đây (ví dụ: đặt chiều rộng là 32px)
        style={{ width: '32px', height: 'auto', objectFit: 'contain' }}
      />
      NEXORA
    </Link>
  )
}