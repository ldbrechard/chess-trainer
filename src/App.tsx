import './App.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from './components/AuthScreen'
import { SharedRepertoirePage } from './components/SharedRepertoirePage'
import { BuildMode } from './features/build/BuildMode'
import { useI18n } from './i18n'
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabaseClient'
import { AppSyncProvider } from './sync/AppSyncProvider'
import { runRepertoireSync } from './sync/repertoireSync'

function AppShell() {
  const { t } = useI18n()
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null | undefined>(() => (configured ? undefined : null))
  const [online, setOnline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine)
  const [syncRunning, setSyncRunning] = useState(false)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const sharedMatch = pathname.match(/^\/share\/r\/([0-9a-fA-F-]{36})$/)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!configured) return
    const supabase = getSupabaseClient()
    void supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [configured])

  const syncNow = useCallback(async () => {
    if (!configured) return
    setSyncRunning(true)
    setLastSyncError(null)
    try {
      const r = await runRepertoireSync()
      if (!r.ok) setLastSyncError(r.error ?? t({ en: 'Sync error', fr: 'Erreur de synchronisation' }))
      else setLastSyncedAt(Date.now())
    } finally {
      setSyncRunning(false)
    }
  }, [configured])

  useEffect(() => {
    if (!configured || !online) return
    if (!session?.user) return
    void syncNow()
  }, [configured, online, session, syncNow])

  const signOutCloud = useCallback(async () => {
    if (!configured) return
    await getSupabaseClient().auth.signOut()
  }, [configured])

  const ctx = useMemo(
    () => ({
      supabaseConfigured: configured,
      session,
      online,
      syncRunning,
      lastSyncError,
      lastSyncedAt,
      openAuthModal: () => setAuthModalOpen(true),
      closeAuthModal: () => setAuthModalOpen(false),
      authModalOpen,
      syncNow,
      signOutCloud,
    }),
    [configured, session, online, syncRunning, lastSyncError, lastSyncedAt, authModalOpen, syncNow, signOutCloud],
  )

  return (
    <AppSyncProvider value={ctx}>
      {configured && authModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12">
          <div className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-lg">
            <button
              type="button"
              className="counter absolute right-2 top-2 text-sm"
              onClick={() => setAuthModalOpen(false)}
              aria-label={t({ en: 'Close', fr: 'Fermer' })}
            >
              ✕
            </button>
            <AuthScreen embedded onAuthenticated={() => setAuthModalOpen(false)} />
          </div>
        </div>
      ) : null}
      {sharedMatch ? (
        <SharedRepertoirePage
          shareId={sharedMatch[1]!}
          onOpenApp={() => {
            history.replaceState({}, '', '/')
            setPathname('/')
          }}
        />
      ) : (
        <BuildMode />
      )}
    </AppSyncProvider>
  )
}

function App() {
  return <AppShell />
}

export default App
