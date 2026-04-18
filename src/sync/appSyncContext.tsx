import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type AppSyncContextValue = {
  supabaseConfigured: boolean
  session: Session | null | undefined
  online: boolean
  syncRunning: boolean
  lastSyncError: string | null
  lastSyncedAt: number | null
  openAuthModal: () => void
  closeAuthModal: () => void
  authModalOpen: boolean
  syncNow: () => Promise<void>
  signOutCloud: () => Promise<void>
}

export const AppSyncContext = createContext<AppSyncContextValue | null>(null)
