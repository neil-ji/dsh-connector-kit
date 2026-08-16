/**
 * npm_launch orchestration: scaffold -> GitHub repo -> initial push -> Pages
 * (workflow build) -> npm trust (OIDC publisher; OTP pauses for the human) ->
 * annotated tag (triggers the CI release). Publishing itself runs in CI via
 * OIDC, so the agent never needs an npm credential.
 */
import { type Context } from '@deepseek-ai/cordis'
import { mkdir } from 'node:fs/promises'
import type { GitHubService } from 'dsh-github-connector'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { NpmService } from './npm-service.ts'
import { renderScaffold, writeScaffold } from './scaffold.ts'
import { shellQuote } from './github-shell.ts'

export interface LaunchRequest {
  name: string
  description?: string
  owner?: string
  visibility?: 'private' | 'public'
  author?: string
  dir?: string
  initialVersion?: string
  skipTrust?: boolean
  session?: unknown
}

export interface LaunchResult {
  dir: string
  repo: { fullName: string; htmlUrl: string }
  pushed: boolean
  pages: { configured: boolean; url?: string; detail?: string }
  trust: {
    status: 'configured' | 'needs-otp' | 'skipped' | 'failed'
    command?: string
    detail?: string
  }
  tag?: { name: string; sha?: string }
  next: string[]
}

interface ShellPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
}

export async function launchPackage(
  ctx: Context,
  github: GitHubService,
  npm: NpmService,
  req: LaunchRequest,
): Promise<LaunchResult> {
  const next: string[] = []
  const owner = req.owner ?? (await github.getIdentity()).login
  const repoName = req.name
  const version = req.initialVersion ?? '0.1.0'
  const tagName = 'v' + version
  const dir = req.dir ?? repoName

  // 1. npm package name must be available
  const info = await npm.checkPackage(req.name)
  if (info.exists) {
    throw new Error('npm package ' + req.name + ' is already taken (latest: ' + (info.latest ?? '?') + ')')
  }

  // 2. scaffold into dir
  const author = req.author ?? github.config.gitName ?? owner
  const year = String(new Date().getFullYear())
  const files = await renderScaffold({
    packageName: req.name,
    description: req.description ?? '',
    repoOwner: owner,
    repoName: repoName,
    authorName: author,
    licenseYear: year,
  })
  await mkdir(dir, { recursive: true })
  await writeScaffold(dir, files)

  // 3. create the GitHub repository
  const repo = await github.createRepo({
    name: repoName,
    ...(req.description === undefined ? {} : { description: req.description }),
    ...(req.visibility === undefined ? {} : { visibility: req.visibility }),
  })

  // 4. git init + origin + initial push (github.push handles add/commit/set-url/push)
  await runShell(ctx, 'git init -b main', dir, req.session)
  await runShell(ctx, 'git remote add origin ' + shellQuote('https://github.com/' + owner + '/' + repoName + '.git'), dir, req.session)
  const pushed = await github.push({
    cwd: dir,
    owner,
    repo: repoName,
    message: 'feat: initial scaffold for ' + repoName,
    branch: 'main',
    ...(req.session === undefined ? {} : { session: req.session }),
  })

  // 5. enable Pages with GitHub Actions build (workflow) — no branch source needed
  const pagesResult = await createPages(ctx, github, owner, repoName)

  // 6. npm trust github (OIDC trusted publisher); OTP pauses for the human
  const trustCommand = npm.trustCommand(req.name, 'release.yml', owner + '/' + repoName)
  let trust: LaunchResult['trust']
  if (req.skipTrust === true) {
    trust = { status: 'skipped', command: trustCommand }
    next.push('npm_trust_add: ' + trustCommand + '  (需在终端执行并输入 OTP)')
  } else {
    trust = await runTrust(ctx, trustCommand, dir, req.session)
    if (trust.status === 'configured') {
      // 7. annotated tag -> CI release (only when trust is configured)
      const tag = await createAnnotatedTag(ctx, github, owner, repoName, version, tagName)
      trust = { ...trust }
      return {
        dir, repo: { fullName: repo.fullName, htmlUrl: repo.htmlUrl }, pushed: pushed.pushed,
        pages: pagesResult, trust, tag: { name: tagName, sha: tag.sha }, next: [],
      }
    }
    if (trust.status === 'needs-otp') {
      next.push('在终端执行 ' + trustCommand + ' 并输入 OTP，完成后重新调用 npm_launch（skipTrust: true 会跳过这一步，只打 tag）')
    } else {
      next.push('修正 npm trust 问题后重跑 npm_launch')
    }
  }

  return {
    dir, repo: { fullName: repo.fullName, htmlUrl: repo.htmlUrl }, pushed: pushed.pushed,
    pages: pagesResult, trust, next,
  }
}

/** Resolve the calling session's sandbox policy (same as the built-in bash tool). */
function sessionShellPolicy(ctx: Context, session: unknown): ShellPolicy | undefined {
  const policy = (ctx.get('sandboxPolicy') as
    | { resolve(opts: { session: unknown }): unknown }
    | undefined)
  return policy?.resolve({ session }) as ShellPolicy | undefined
}

async function runShell(ctx: Context, command: string, workdir: string, session: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const shell = ctx.shell as ShellExecutor
  const sandboxPolicy = session === undefined ? undefined : sessionShellPolicy(ctx, session)
  const run = await shell.run(shell.resolve({
    command,
    workdir,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  }))
  if (run.exitCode !== 0) {
    throw new Error('command failed (' + command.slice(0, 60) + '): ' + (run.stderr.text || run.stdout.text).slice(0, 500))
  }
  return { exitCode: run.exitCode, stdout: run.stdout.text, stderr: run.stderr.text }
}

async function githubApi(
  github: GitHubService,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const token = await github.resolveToken()
  if (token === undefined) throw new Error('github: token is not configured')
  const response = await fetch(github.config.apiBase + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'dsh-npm-connector',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  return { status: response.status, data }
}

/** POST /repos/{owner}/{repo}/pages with build_type workflow (GitHub Actions deploys). */
async function createPages(ctx: Context, github: GitHubService, owner: string, repo: string): Promise<LaunchResult['pages']> {
  const { status, data } = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/pages', { build_type: 'workflow' })
  if (status === 201 || status === 200) {
    const htmlUrl = (data as { html_url?: string } | undefined)?.html_url
    return { configured: true, url: htmlUrl ?? 'https://' + owner + '.github.io/' + repo + '/', detail: 'Pages enabled with GitHub Actions build' }
  }
  const detail = (data as { message?: string } | undefined)?.message ?? String(data).slice(0, 200)
  return { configured: false, detail: 'GitHub /pages responded ' + status + ': ' + detail }
}

/** Create an annotated tag via the git data API (triggers the tag release workflow). */
async function createAnnotatedTag(
  ctx: Context,
  github: GitHubService,
  owner: string,
  repo: string,
  version: string,
  tagName: string,
): Promise<{ sha: string }> {
  const head = await githubApi(github, 'GET', '/repos/' + owner + '/' + repo + '/git/ref/heads/main')
  if (head.status !== 200) throw new Error('github: cannot resolve main head for tag (HTTP ' + head.status + ')')
  const headSha = (head.data as { object?: { sha?: string } }).object?.sha
  if (headSha === undefined) throw new Error('github: main head sha missing')

  const taggerName = github.config.gitName ?? 'dsh-npm-bot'
  const taggerEmail = github.config.gitEmail ?? 'npm@localhost'
  const tag = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/git/tags', {
    tag: tagName,
    message: 'Release ' + tagName,
    object: headSha,
    type: 'commit',
    tagger: { name: taggerName, email: taggerEmail, date: new Date().toISOString() },
  })
  if (tag.status !== 201) {
    const detail = (tag.data as { message?: string } | undefined)?.message ?? ''
    throw new Error('github: annotated tag creation failed (HTTP ' + tag.status + '): ' + detail)
  }
  const tagSha = (tag.data as { sha?: string }).sha
  if (tagSha === undefined) throw new Error('github: tag sha missing')

  const ref = await githubApi(github, 'POST', '/repos/' + owner + '/' + repo + '/git/refs', {
    ref: 'refs/tags/' + tagName,
    sha: tagSha,
  })
  if (ref.status !== 201) {
    const detail = (ref.data as { message?: string } | undefined)?.message ?? ''
    throw new Error('github: tag ref creation failed (HTTP ' + ref.status + '): ' + detail)
  }
  return { sha: tagSha }
}

/** Run npm trust github for real; a 2FA-writes account pauses on an OTP prompt. */
async function runTrust(ctx: Context, command: string, workdir: string, session: unknown): Promise<LaunchResult['trust']> {
  const shell = ctx.shell as ShellExecutor
  const sandboxPolicy = session === undefined ? undefined : sessionShellPolicy(ctx, session)
  const run = await shell.run(shell.resolve({
    command,
    workdir,
    timeoutMs: 25000,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  }))
  const combined = (run.stdout.text + '\n' + run.stderr.text).toLowerCase()
  const paused = run.aborted === true || run.timedOut === true
  if (run.exitCode === 0 && !paused) {
    return { status: 'configured', command, detail: 'trusted publisher configured' }
  }
  if (paused || /otp|one-time|two-factor|two factor|2fa|passcode|authentication required|eneedauth/i.test(combined)) {
    return { status: 'needs-otp', command, detail: 'npm trust requires an OTP (2FA writes mode); run it in a terminal' }
  }
  return { status: 'failed', command, detail: (run.stderr.text || run.stdout.text).slice(0, 400) }
}
