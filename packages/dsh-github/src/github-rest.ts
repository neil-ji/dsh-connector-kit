/**
 * Minimal GitHub REST client over Node fetch. All requests are authenticated
 * with the resolved token; error messages never echo the token.
 */
import type { GithubUser } from './types.ts'

/** Stable connector failure with a machine-readable code. */
export class GithubError extends Error {
  constructor(
    readonly code: 'MISSING_CREDENTIAL' | 'OPERATION_FORBIDDEN' | 'AUTH_FAILED' | 'REQUEST_FAILED',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

/** GitHub REST response envelope for one request. */
export interface GithubRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  token: string
  apiBase: string
  body?: unknown
}

/**
 * Perform one authenticated GitHub API request.
 * @param options - method, path, token, base url and optional JSON body.
 * @returns the parsed JSON value.
 */
export async function githubRequest<T>(options: GithubRequestOptions): Promise<T> {
  const { method, path, token, apiBase, body } = options
  let response: Response
  try {
    response = await fetch(apiBase + path, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'dsh-github-connector',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new GithubError('REQUEST_FAILED', `github request to ${path} failed: ${String(error)}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new GithubError(
      response.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED',
      `GitHub ${path} responded ${response.status}: ${text.slice(0, 500)}`,
      response.status,
    )
  }
  return response.json() as Promise<T>
}

/** Fetch the authenticated /user identity (connection test). */
export async function fetchWhoami(apiBase: string, token: string): Promise<GithubUser> {
  return githubRequest<GithubUser>({ method: 'GET', path: '/user', token, apiBase })
}
