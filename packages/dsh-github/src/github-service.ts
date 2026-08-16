/**
 * GitHubService: host-plane capability service. It extends TypertRemoteService
 * so the same Service owns both the business methods (REST + git) and the
 * @Remote methods the Web UI calls through the Typert Gateway (SRC fallback
 * dispatch — no generated strict host artifact required).
 */
import { type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import {
  Config, GITHUB_SETTINGS_NAMESPACE, toConfigView,
  type GithubConfig, type GithubConfigView,
} from './config.ts'
import { GithubError, fetchWhoami, githubRequest } from './github-rest.ts'
import { gitHostFromApiBase, gitProxyArgs, gitProxyProbeCommand, parseRemoteOwnerRepo, shellQuote } from './git-utils.ts'
import type {
  CreatePullRequest, CreateRepoRequest, CreateRepoResult, CreateReviewRequest,
  GetPullRequest, GithubPullComment, GithubPullFile, GithubPullRequest,
  GithubProxyTestValue, GithubRepo, GithubUser, GithubWhoamiValue, ListPullsRequest,
} from './types.ts'

/**
 * Inline git credential helper. Git executes the body after the exclamation
 * mark with sh and reads username/password lines from stdout. The token stays
 * literal in the command string (single-quoted there) and is expanded by git's
 * helper shell from the per-run environment, so it never enters argv or the
 * remote URL.
 */
const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'

/**
 * Structural shape of the sandbox execution policy (@deepseek-ai/dsh-sandbox
 * SandboxExecutionPolicy) as consumed by the shell executor. Kept local so
 * the connector needs no direct dependency on dsh-sandbox types.
 */
interface SessionShellPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
}

/** The current resolved configuration source. */
type ConfigSource = () => GithubConfig

/** Reject a config section this service cannot act on (fail loud at write). */
function assertServiceableGithubConfig(config: GithubConfig): void {
  const apiBase = config.apiBase ?? 'https://api.github.com'
  if (!/^https:\/\//.test(apiBase)) {
    throw new Error(`github: apiBase must be an https URL, got ${JSON.stringify(apiBase)}`)
  }
  const proxy = config.gitProxy
  if (proxy !== undefined && proxy !== '' && !/^(https?|socks[45]h?):\/\//i.test(proxy)) {
    throw new Error(`github: gitProxy must be an http(s)/socks proxy URL, got ${JSON.stringify(proxy)}`)
  }
}


export class GitHubService extends TypertRemoteService {
  static inject = ['credentials', 'shell', 'sandboxPolicy']

  private source: ConfigSource

  constructor(ctx: Context, entry: GithubConfig) {
    super(ctx, 'github')
    this.source = () => entry
    // Register the settings namespace for local persistence + hot reload.
    // This is NOT the apiproxy settings.describe allowlist — the Web UI uses the
    // @Remote config methods below instead.
    installSettingsSection(ctx, GITHUB_SETTINGS_NAMESPACE, Config, entry, {
      setSource: (current) => { this.source = current },
      onChange: () => {},
      validate: assertServiceableGithubConfig,
    })
  }

  /** Currently authoritative resolved config. */
  get config(): GithubConfig {
    return this.source()
  }

  /** Resolve the token fresh on every operation (hot-reload). */
  async resolveToken(): Promise<string | undefined> {
    const ref = credentialRef(this.config.tokenEnv ?? 'GITHUB_TOKEN')
    return (await this.ctx.get('credentials')?.resolve(ref))?.value
  }

  /** Resolve the token or fail loud. A draft wins (connection test). */
  private async token(draft?: string): Promise<string> {
    if (draft !== undefined) return draft
    const hit = await this.resolveToken()
    if (hit === undefined) {
      throw new GithubError('MISSING_CREDENTIAL', 'github: GITHUB_TOKEN is not configured')
    }
    return hit
  }

  /** Assert one operation permission from the resolved config. */
  private assertAllowed(key: keyof GithubConfig): void {
    if (this.config[key] !== true) {
      throw new GithubError('OPERATION_FORBIDDEN', `github: ${key} is disabled`)
    }
  }

  /** The apiBase the service will use. */
  private get apiBase(): string {
    return this.config.apiBase ?? 'https://api.github.com'
  }

  // ── business: REST ────────────────────────────────────────────────────────

  /** Authenticated /user identity (also used by the @Remote connection test). */
  async whoami(draftToken?: string): Promise<GithubUser> {
    return fetchWhoami(this.apiBase, await this.token(draftToken))
  }

  /** Create a repository for the authenticated user. */
  async createRepo(req: CreateRepoRequest): Promise<CreateRepoResult> {
    this.assertAllowed('allowCreateRepo')
    const visibility = req.visibility ?? this.config.defaultVisibility ?? 'private'
    const repo = await githubRequest<GithubRepo>({
      method: 'POST',
      path: '/user/repos',
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        name: req.name,
        private: visibility === 'private',
        ...(req.description === undefined ? {} : { description: req.description }),
      },
    })
    return {
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    }
  }

  /** Create a pull request. */
  async createPull(req: CreatePullRequest): Promise<GithubPullRequest> {
    this.assertAllowed('allowPullRequest')
    return githubRequest<GithubPullRequest>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/pulls`,
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        title: req.title,
        head: req.head,
        base: req.base,
        ...(req.body === undefined ? {} : { body: req.body }),
      },
    })
  }

  /** Submit a PR review. */
  async createReview(req: CreateReviewRequest): Promise<{ state: string }> {
    this.assertAllowed('allowReview')
    return githubRequest<{ state: string }>({
      method: 'POST',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.pullNumber}/reviews`,
      token: await this.token(),
      apiBase: this.apiBase,
      body: {
        event: req.event,
        ...(req.body === undefined ? {} : { body: req.body }),
      },
    })
  }


  /** List pull requests for a repository. */
  async listPulls(req: ListPullsRequest): Promise<GithubPullRequest[]> {
    this.assertAllowed('allowPullRequest')
    const q = req.state === undefined ? '' : `?state=${req.state}`
    return githubRequest<GithubPullRequest[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls${q}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** Read one pull request. */
  async getPull(req: GetPullRequest): Promise<GithubPullRequest> {
    this.assertAllowed('allowPullRequest')
    return githubRequest<GithubPullRequest>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** List review comments on a pull request. */
  async listPullComments(req: GetPullRequest): Promise<GithubPullComment[]> {
    this.assertAllowed('allowReview')
    return githubRequest<GithubPullComment[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}/comments`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  /** List the files changed by a pull request (includes per-file patch). */
  async getPullFiles(req: GetPullRequest): Promise<GithubPullFile[]> {
    this.assertAllowed('allowReview')
    return githubRequest<GithubPullFile[]>({
      method: 'GET',
      path: `/repos/${req.owner}/${req.repo}/pulls/${req.number}/files`,
      token: await this.token(),
      apiBase: this.apiBase,
    })
  }

  // ── business: git via ctx.shell ───────────────────────────────────────────

  /** Build a clean HTTPS remote URL (no credentials embedded). */
  remoteUrl(owner: string, repo: string): string {
    return `https://${this.gitHost()}/${owner}/${repo}.git`
  }

  /** Derive the git host from apiBase (github.com, or a GHES host). */
  private gitHost(): string {
    return gitHostFromApiBase(this.apiBase)
  }

  /** Run git add/commit/remote/push (never --force). */
  async push(req: {
    cwd: string
    owner?: string
    repo?: string
    message: string
    branch: string
    add?: boolean
    session?: unknown
  }): Promise<{ pushed: boolean; branch: string }> {
    this.assertAllowed('allowPush')
    // Force-push is architecturally forbidden: no config gate unlocks it here.
    const token = await this.token()
    const shell = this.ctx.shell as ShellExecutor
    const resolved = await this.resolveOwnerRepo(req.cwd, req.owner, req.repo)
    const url = this.remoteUrl(resolved.owner, resolved.repo)
    const steps = [
      req.add === false ? undefined : 'git add -A',
      `git ${this.commitIdentityArgs()}commit -m ${shellQuote(req.message)}`,
      `git ${gitProxyArgs(this.config.gitProxy)}remote set-url origin ${shellQuote(url)}`,
      `git ${gitProxyArgs(this.config.gitProxy)}-c credential.helper='${CREDENTIAL_HELPER}' push -u origin ${req.branch}`,
    ].filter((s): s is string => s !== undefined)
    const sandboxPolicy = req.session === undefined ? undefined : this.sessionShellPolicy(req.session)
    const run = await shell.run(shell.resolve({
      command: steps.join(' && '),
      workdir: req.cwd,
      env: { GITHUB_TOKEN: token },
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    }))
    if (run.exitCode !== 0) {
      throw new Error(`github_push failed: ${run.stderr.text || run.stdout.text}`)
    }
    return { pushed: true, branch: req.branch }
  }


  /**
   * Resolve the calling session's sandbox policy so git can write inside the
   * session workspace. The DSH host confines ctx.shell by default; stamping
   * the policy resolved from the tool's owning session (same as the built-in
   * bash tool) lets the connector's git steps run under that session's mode
   * instead of the deployment default. Returns undefined for agentless calls
   * or when the sandbox-policy service is absent.
   */
  private sessionShellPolicy(session: unknown): SessionShellPolicy | undefined {
    const policy = (this.ctx as unknown as {
      sandboxPolicy?: { resolve(opts: { session: unknown }): unknown },
    }).sandboxPolicy
    return policy?.resolve({ session }) as SessionShellPolicy | undefined
  }

  /**
   * -c user.name/-c user.email flags for the commit step, derived from the
   * configured git identity (gitName/gitEmail). Empty string when unset, so
   * git falls back to its own identity resolution (global config / env).
   */
  private commitIdentityArgs(): string {
    const args: string[] = []
    if (this.config.gitName !== undefined && this.config.gitName !== '') {
      args.push(`-c ${shellQuote(`user.name=${this.config.gitName}`)}`)
    }
    if (this.config.gitEmail !== undefined && this.config.gitEmail !== '') {
      args.push(`-c ${shellQuote(`user.email=${this.config.gitEmail}`)}`)
    }
    return args.length === 0 ? '' : args.join(' ') + ' '
  }

  /**
   * Resolve owner/repo from explicit arguments, falling back to parsing the
   * cwd's origin remote URL. Fails loud when neither is available.
   */
  private async resolveOwnerRepo(
    cwd: string,
    owner?: string,
    repo?: string,
  ): Promise<{ owner: string; repo: string }> {
    if (owner !== undefined && repo !== undefined) return { owner, repo }
    const shell = this.ctx.shell as ShellExecutor
    const read = await shell.run(shell.resolve({ command: 'git remote get-url origin', workdir: cwd }))
    if (read.exitCode === 0) {
      const parsed = parseRemoteOwnerRepo(read.stdout.text)
      if (parsed !== undefined) {
        return { owner: owner ?? parsed.owner, repo: repo ?? parsed.repo }
      }
    }
    throw new GithubError(
      'OPERATION_FORBIDDEN',
      'github_push: owner/repo are required when the origin remote cannot be resolved',
    )
  }
  /** Run git pull for a branch. */
  async pull(req: { cwd: string; branch?: string; session?: unknown }): Promise<{ pulled: boolean }> {
    this.assertAllowed('allowPull')
    const token = await this.token()
    const shell = this.ctx.shell as ShellExecutor
    const branch = req.branch === undefined ? '' : ` origin ${req.branch}`
    const sandboxPolicy = req.session === undefined ? undefined : this.sessionShellPolicy(req.session)
    const run = await shell.run(shell.resolve({
      command: `git ${gitProxyArgs(this.config.gitProxy)}-c credential.helper='${CREDENTIAL_HELPER}' pull${branch}`,
      workdir: req.cwd,
      env: { GITHUB_TOKEN: token },
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    }))
    if (run.exitCode !== 0) {
      throw new Error(`github_pull failed: ${run.stderr.text || run.stdout.text}`)
    }
    return { pulled: true }
  }

  // ── Typert Remote methods (Web UI) ────────────────────────────────────────

  /**
   * Proxy health probe: git ls-remote through the configured (or draft)
   * proxy against a public repo. Validates both proxy connectivity and the
   * exact HTTPS path git push would use. No auth and no file writes, so it
   * also works under the deployment's default sandbox.
   */
  @Remote('proxy.test')
  async proxyTestRemote(request: { proxy?: string }): Promise<GithubProxyTestValue> {
    const proxy = request.proxy ?? this.config.gitProxy
    if (proxy === undefined || proxy === '') {
      return { ok: false, latencyMs: 0, host: 'github.com', error: 'github: no git proxy configured' }
    }
    if (!/^(https?|socks[45]h?):\/\//i.test(proxy)) {
      return { ok: false, latencyMs: 0, host: 'github.com', error: `github: invalid proxy URL ${JSON.stringify(proxy)}` }
    }
    const shell = this.ctx.shell as ShellExecutor
    const started = Date.now()
    const run = await shell.run(shell.resolve({
      command: gitProxyProbeCommand(proxy),
      workdir: process.cwd(),
      timeoutMs: 20000,
    }))
    const latencyMs = Date.now() - started
    if (run.exitCode !== 0) {
      const detail = (run.stderr.text || run.stdout.text || 'unknown error').trim().slice(0, 300)
      return { ok: false, latencyMs, host: 'github.com', error: detail }
    }
    return { ok: true, latencyMs, host: 'github.com', error: null }
  }

  /** Connection test; an optional draft token wins over the stored one. */
  @Remote('whoami')
  async whoamiRemote(request: { draftToken?: string }): Promise<GithubWhoamiValue> {
    const user = await this.whoami(request.draftToken)
    return {
      login: user.login,
      name: user.name,
      htmlUrl: user.html_url,
      scopes: user.scopes ?? [],
      apiBase: this.apiBase,
    }
  }

  /** Read the current resolved config (JSON-safe). */
  @Remote('config.get')
  configGet(): GithubConfigView {
    return toConfigView(this.config)
  }

  /** Merge a patch into the user config layer and return the new view. */
  @Remote('config.set')
  async configSet(request: { patch: Record<string, unknown> }): Promise<GithubConfigView> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new Error('github: settings service is absent')
    }
    await settings.update(GITHUB_SETTINGS_NAMESPACE, request.patch)
    return toConfigView(this.config)
  }
}

export default GitHubService
