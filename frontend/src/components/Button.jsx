import { Link } from 'react-router-dom'
export default function Button({ to, variant = 'primary', children, ...rest }) {
  const cls = `btn btn-${variant}`
  return to ? <Link to={to} className={cls} {...rest}>{children}</Link> : <button type="button" className={cls} {...rest}>{children}</button>
}
