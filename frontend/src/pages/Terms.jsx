import { useI18n } from '../i18n' // adjust to your i18n hook: must return { t }
import '../styles/Terms.css'

const p = (...keys) => ({ type: 'p', keys })
const ul = (count) => ({ type: 'ul', keys: Array.from({ length: count }, (_, i) => `i${i + 1}`) })

// Each section renders its blocks in order. Keys resolve to `terms.<id>.<key>`.
const SECTIONS = [
  { id: 's1', blocks: [p('p1')] },
  { id: 's2', blocks: [p('p1', 'p2', 'p3', 'p4')] },
  { id: 's3', blocks: [p('p1', 'p2'), ul(5)] },
  { id: 's4', blocks: [p('p1', 'p2', 'p3')] },
  { id: 's5', blocks: [p('p1', 'p2', 'p3')] },
  { id: 's6', blocks: [p('p1', 'p2', 'p3', 'p4')] },
  { id: 's7', blocks: [p('p1'), ul(7)] },
  { id: 's8', blocks: [p('p1', 'p2', 'p3', 'p4')] },
  { id: 's9', blocks: [p('p1'), ul(5), p('p2')] },
  { id: 's10', blocks: [p('p1', 'p2')] },
  { id: 's11', blocks: [p('p1', 'p2')] },
  { id: 's12', blocks: [] },
]

const CONTACT_WEBSITE = 'nexora'
const CONTACT_EMAIL = 'thiennguyenchi235aa@gmail.com'

export default function Terms() {
  const { t } = useI18n()

  return (
    <main className="terms">
      <header className="terms-header">
        <h1>{t('terms.title')}</h1>
        <p className="terms-updated">
          {t('terms.updated')}: {t('terms.updatedDate')}
        </p>
        <p>{t('terms.intro')}</p>
      </header>

      <div className="terms-layout">
        <nav className="terms-toc" aria-label={t('terms.contents')}>
          <h2>{t('terms.contents')}</h2>
          <ol>
            {SECTIONS.map(({ id }) => (
              <li key={id}>
                <a href={`#${id}`}>{t(`terms.${id}.title`)}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="terms-body">
          {SECTIONS.map(({ id, blocks }, index) => (
            <section key={id} id={id} className="terms-section">
              <h2>
                <span className="terms-num">{index + 1}.</span>
                <span>{t(`terms.${id}.title`)}</span>
              </h2>

              {blocks.map((block, i) =>
                block.type === 'ul' ? (
                  <ul key={i}>
                    {block.keys.map((k) => (
                      <li key={k}>{t(`terms.${id}.${k}`)}</li>
                    ))}
                  </ul>
                ) : (
                  block.keys.map((k) => <p key={k}>{t(`terms.${id}.${k}`)}</p>)
                )
              )}

              {id === 's12' && (
                <dl className="terms-contact">
                  <dt>{t('terms.s12.website')}</dt>
                  <dd>{CONTACT_WEBSITE}</dd>
                  <dt>{t('terms.s12.email')}</dt>
                  <dd>
                    <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                  </dd>
                </dl>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}