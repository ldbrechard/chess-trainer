import './App.css'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BuildMode } from './features/build/BuildMode'
import { AuthScreen } from './components/AuthScreen'
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabaseClient'

function App() {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null | undefined>(() => (configured ? undefined : null))

  useEffect(() => {
    if (!configured) return
    const supabase = getSupabaseClient()
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [configured])

  if (session === undefined) {
    return (
      <div id="center" className="text-[var(--text-h)]">
        <p>Chargement…</p>
      </div>
    )
  }

  if (!configured) {
    return (
      <div id="center" className="max-w-lg px-4 text-left text-[var(--text-h)]">
        <h1 className="text-xl font-semibold">Configuration Supabase</h1>
        <p className="mt-3 text-sm opacity-90">
          Ajoute <span className="font-mono">VITE_SUPABASE_URL</span> et{' '}
          <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> dans ton fichier{' '}
          <span className="font-mono">.env</span>, puis relance <span className="font-mono">npm run dev</span>.
        </p>
      </div>
    )
  }

  if (!session) return <AuthScreen />

  return <BuildMode />
}

export default App
