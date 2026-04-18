import { useContext } from 'react'
import { AppSyncContext, type AppSyncContextValue } from './appSyncContext'

export function useAppSync(): AppSyncContextValue {
  const v = useContext(AppSyncContext)
  if (!v) throw new Error('useAppSync must be used within AppSyncProvider')
  return v
}
