import { describe, expect, it } from 'vitest'
import { gitHostFromApiBase, parseRemoteOwnerRepo, shellQuote } from '../src/git-utils.ts'

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes for POSIX shell', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })
})

describe('gitHostFromApiBase', () => {
  it('maps api.github.com to github.com', () => {
    expect(gitHostFromApiBase('https://api.github.com')).toBe('github.com')
  })

  it('strips a GHES /api/v3 suffix', () => {
    expect(gitHostFromApiBase('https://github.example.com/api/v3')).toBe('github.example.com')
  })

  it('strips a GHES /api suffix', () => {
    expect(gitHostFromApiBase('https://github.example.com/api')).toBe('github.example.com')
  })
})

describe('parseRemoteOwnerRepo', () => {
  it('parses an https remote', () => {
    expect(parseRemoteOwnerRepo('https://github.com/octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('parses an https remote carrying a token', () => {
    expect(parseRemoteOwnerRepo('https://x-access-token:abc@github.com/octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('parses an ssh remote', () => {
    expect(parseRemoteOwnerRepo('git@github.com:octocat/hello.git')).toEqual({ owner: 'octocat', repo: 'hello' })
  })

  it('returns undefined for unparseable input', () => {
    expect(parseRemoteOwnerRepo('')).toBeUndefined()
    expect(parseRemoteOwnerRepo('octocat')).toBeUndefined()
  })
})
