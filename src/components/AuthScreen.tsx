import { useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'
import { useI18n } from '../i18n'

type Props = {
  /** When true, tighter copy for modal overlay */
  embedded?: boolean
  onAuthenticated?: () => void
}

export function AuthScreen({ embedded, onAuthenticated }: Props) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    const em = email.trim()
    if (!em || !password) {
      setMessage(t({ en: 'Email and password are required.', fr: 'Email et mot de passe requis.' }))
      return
    }
    setBusy(true)
    try {
      const supabase = getSupabaseClient()
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: em, password })
        if (error) throw error
        setMessage(
          t({
            en: 'Account created. If email confirmation is enabled, check your inbox.',
            fr: 'Compte créé. Si la confirmation email est activée, vérifie ta boîte.',
          }),
        )
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password })
        if (error) throw error
        onAuthenticated?.()
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t({ en: 'Sign-in error.', fr: 'Erreur de connexion.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 text-left text-[var(--text-h)]">
      <div>
        <h1 className="text-2xl font-semibold">Chess Trainer</h1>
        <p className="mt-2 text-sm opacity-80">
          {embedded
            ? t({
                en: 'Sign in to sync your repertoires with the cloud.',
                fr: 'Connecte-toi pour synchroniser tes répertoires avec le cloud.',
              })
            : t({
                en: 'Sign in to sync your repertoires (Supabase).',
                fr: 'Connecte-toi pour synchroniser tes répertoires (Supabase).',
              })}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`counter ${mode === 'signin' ? 'ring-2 ring-[var(--accent)]' : ''}`}
          onClick={() => setMode('signin')}
        >
          {t({ en: 'Sign in', fr: 'Connexion' })}
        </button>
        <button
          type="button"
          className={`counter ${mode === 'signup' ? 'ring-2 ring-[var(--accent)]' : ''}`}
          onClick={() => setMode('signup')}
        >
          {t({ en: 'Sign up', fr: 'Inscription' })}
        </button>
      </div>

      <form className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]" onSubmit={submit}>
        <label className="block text-sm font-medium" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <label className="block text-sm font-medium" htmlFor="auth-password">
          {t({ en: 'Password', fr: 'Mot de passe' })}
        </label>
        <input
          id="auth-password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {message ? <p className="text-sm opacity-90">{message}</p> : null}
        <button type="submit" className="counter w-full" disabled={busy}>
          {mode === 'signup' ? t({ en: 'Create account', fr: "S'inscrire" }) : t({ en: 'Sign in', fr: 'Se connecter' })}
        </button>
      </form>
    </div>
  )
}
