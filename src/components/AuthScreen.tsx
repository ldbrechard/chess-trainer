import { useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

export function AuthScreen() {
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
      setMessage('Email et mot de passe requis.')
      return
    }
    setBusy(true)
    try {
      const supabase = getSupabaseClient()
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: em, password })
        if (error) throw error
        setMessage('Compte créé. Si la confirmation email est activée, vérifie ta boîte.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password })
        if (error) throw error
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erreur de connexion.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 text-left text-[var(--text-h)]">
      <div>
        <h1 className="text-2xl font-semibold">Chess Trainer</h1>
        <p className="mt-2 text-sm opacity-80">Connecte-toi pour accéder à tes répertoires (Supabase).</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`counter ${mode === 'signin' ? 'ring-2 ring-[var(--accent)]' : ''}`}
          onClick={() => setMode('signin')}
        >
          Connexion
        </button>
        <button
          type="button"
          className={`counter ${mode === 'signup' ? 'ring-2 ring-[var(--accent)]' : ''}`}
          onClick={() => setMode('signup')}
        >
          Inscription
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
          Mot de passe
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
          {mode === 'signup' ? "S'inscrire" : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
