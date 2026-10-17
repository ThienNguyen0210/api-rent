import { useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
export default function CodeBlock({ title, code }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }
  return (
    <div className="code">
      <div className="code-head"><span>{title}</span><button onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}
