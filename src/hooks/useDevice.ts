import { useCallback, useEffect, useState } from 'react'

/** Aligné sur la breakpoint `lg` de Tailwind (1024px). */
export const MOBILE_MAX_WIDTH_PX = 1023

export type DeviceInfo = {
  width: number
  /** Largeur ≤ 1023px — UI type téléphone / petite tablette. */
  isMobile: boolean
  isDesktop: boolean
}

function readWidth(): number {
  if (typeof window === 'undefined') return MOBILE_MAX_WIDTH_PX + 1
  return window.innerWidth
}

function compute(width: number): DeviceInfo {
  const isMobile = width <= MOBILE_MAX_WIDTH_PX
  return {
    width,
    isMobile,
    isDesktop: !isMobile,
  }
}

/**
 * Largeur viewport + flag mobile (pour interactions tactiles, layout, etc.).
 */
export function useDevice(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(() => compute(readWidth()))

  const update = useCallback(() => {
    setInfo(compute(readWidth()))
  }, [])

  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [update])

  return info
}
