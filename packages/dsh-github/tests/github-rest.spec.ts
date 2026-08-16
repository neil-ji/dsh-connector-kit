import { afterEach, describe, expect, it, vi } from 'vitest'
import { GithubError, githubRequest } from '../src/github-rest.ts'

describe('githubRequest', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends an authorized request and returns parsed json', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const value = await githubRequest<{ login: string }>({
      method: 'GET', path: '/user', token: 't', apiBase: 'https://api.github.com',
    })

    expect(value).toEqual({ login: 'octocat' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer t' }),
    }))
  })

  it('throws AUTH_FAILED on a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad credentials', { status: 401 })))
    await expect(githubRequest({ method: 'GET', path: '/user', token: 't', apiBase: 'https://api.github.com' }))
      .rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('throws a GithubError on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(githubRequest({ method: 'GET', path: '/x', token: 't', apiBase: 'https://api.github.com' }))
      .rejects.toBeInstanceOf(GithubError)
  })

  it('never echoes the token into the failure message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    const failure = await githubRequest({ method: 'GET', path: '/x', token: 'super-secret', apiBase: 'https://api.github.com' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GithubError)
    expect((failure as Error).message).not.toContain('super-secret')
  })
})
