import { fmtCompact } from '../lib/format.js'
export default function BarChart({ data }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return <div className="bars">{data.map(d => (
    <div key={d.label} className="bar-col"><span className="bar-val">{fmtCompact(d.value)}</span><div className="bar" style={{ height: `${(d.value / max) * 100}%` }} /><span>{d.label}</span></div>))}</div>
}
