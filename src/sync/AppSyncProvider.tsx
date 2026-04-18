import type { ReactNode } from 'react'
import { AppSyncContext, type AppSyncContextValue } from './appSyncContext'

export function AppSyncProvider({ value, children }: { value: AppSyncContextValue; children: ReactNode }) {
  return <AppSyncContext.Provider value={value}>{children}</AppSyncContext.Provider>
}
