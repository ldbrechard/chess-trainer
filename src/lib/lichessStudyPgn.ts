/**
 * Lichess study PGN: append `.pgn` to the study (or chapter) page URL path — see Lichess behaviour / user docs.
 * Fetched directly from lichess.org (no dev proxy: avoids spurious 502 from the proxy layer).
 */

/**
 * Turns a Lichess study or chapter **page** URL into the matching PGN download URL
 * (same path + `.pgn` before any query; hash stripped).
 */
export function studyPageUrlToPgnFetchUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    const host = u.hostname.replace(/^www\./i, '')
    if (host !== 'lichess.org') return null
    if (!/\/study\//i.test(u.pathname)) return null

    let path = u.pathname.replace(/\/+$/, '')
    if (!path.toLowerCase().endsWith('.pgn')) {
      path += '.pgn'
    }
    u.pathname = path
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

export async function fetchLichessStudyPgnText(rawUrl: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const url = studyPageUrlToPgnFetchUrl(rawUrl)
  if (!url)
    return {
      ok: false,
      error: 'URL non reconnue (colle une adresse lichess.org contenant /study/… ).',
    }

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/x-chess-pgn, text/plain;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: 'Étude ou chapitre introuvable (vérifiez que l’étude est publique).' }
      return { ok: false, error: `Lichess a répondu HTTP ${res.status}.` }
    }
    const text = await res.text()
    if (!text.trim()) return { ok: false, error: 'Réponse vide depuis Lichess.' }
    return { ok: true, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error:
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? 'Réseau ou blocage CORS : télécharge le PGN depuis Lichess puis utilise « Upload PGN ».'
          : msg,
    }
  }
}
