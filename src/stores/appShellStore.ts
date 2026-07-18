import { create } from 'zustand'

import type { Mode, MobileBuildTab, MobileHomeSideTab, View } from '../features/build/buildTypes'

type AppShellState = {
  view: View
  mode: Mode
  settingsOpen: boolean
  mobileBuildTab: MobileBuildTab
  mobileHomeSideTab: MobileHomeSideTab
  setView: (view: View) => void
  setMode: (mode: Mode) => void
  setSettingsOpen: (open: boolean) => void
  setMobileBuildTab: (tab: MobileBuildTab) => void
  setMobileHomeSideTab: (tab: MobileHomeSideTab) => void
}

export const useAppShellStore = create<AppShellState>((set) => ({
  view: 'home',
  mode: 'build',
  settingsOpen: false,
  mobileBuildTab: 'tree',
  mobileHomeSideTab: 'all',
  setView: (view) => set({ view }),
  setMode: (mode) => set({ mode }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setMobileBuildTab: (mobileBuildTab) => set({ mobileBuildTab }),
  setMobileHomeSideTab: (mobileHomeSideTab) => set({ mobileHomeSideTab }),
}))
