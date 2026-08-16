/**
 * Pure git/shell helpers for the GitHub connector (kept side-effect free
 * so unit tests can exercise them without a Cordis context).
 */

/** Quote a value for safe embedding inside a POSIX shell command string. */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Derive the git host from an apiBase URL: github.com for api.github.com,
 * or the bare host for a GHES instance (stripping any /api or /api/v3 suffix).
 * @param apiBase - the configured GitHub API base URL.
 * @returns the git host used in remote/clone URLs.
 */
export function gitHostFromApiBase(apiBase: string): string {
  const base = apiBase.replace(/^https:\/\//, '').replace(/\/$/, '')
  if (base === 'api.github.com') return 'github.com'
  return base.replace(/\/api\/v3$/, '').replace(/\/api$/, '')
}

/**
 * Parse owner/repo out of a git remote URL (https, https+token, or ssh form).
 * @param url - the remote URL reported by git.
 * @returns owner and repo, or undefined when the URL cannot be parsed.
 */
export function parseRemoteOwnerRepo(url: string): { owner: string; repo: string } | undefined {
  const trimmed = url.trim()
  if (trimmed === '') return undefined
  // ssh form: git@host:owner/repo.git
  if (!/^https?:\/\//.test(trimmed) && trimmed.includes(':')) {
    return splitOwnerRepo(trimmed.slice(trimmed.indexOf(':') + 1))
  }
  // https form: https://[token@]host/owner/repo[.git]
  const noProtocol = trimmed.replace(/^https?:\/\//, '')
  const noAuth = noProtocol.replace(/^[^@/]+@/, '')
  return splitOwnerRepo(noAuth.replace(/^[^/]+\//, ''))
}

function splitOwnerRepo(path: string): { owner: string; repo: string } | undefined {
  const normalized = path.replace(/\.git$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  return { owner: parts[0], repo: parts[parts.length - 1] }
}
