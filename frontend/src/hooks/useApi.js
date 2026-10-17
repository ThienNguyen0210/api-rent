import { useEffect, useState } from 'react'
// Runs an API call and exposes { data, loading, error, reload }. Re-runs when deps change.
export function useApi(fn, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let off = false
    // Guard: if the API method does not exist (e.g. keysApi.otpStatus was never added to api/index.js),
    // show an error state instead of crashing the whole page with "fn is not a function".
    if (typeof fn !== 'function') {
      set({ data: null, loading: false, error: new Error('API method is not defined (check frontend/src/api/index.js)') })
      return
    }
    set(s => ({ ...s, loading: true, error: null }))
    fn().then(data => !off && set({ data, loading: false, error: null }))
        .catch(error => !off && set({ data: null, loading: false, error }))
    return () => { off = true }
  }, [...deps, tick])
  return { ...state, reload: () => setTick(t => t + 1) }
}