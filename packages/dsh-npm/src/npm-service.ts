/**
 * npm-connector capability service: registry queries (no credentials needed)
 * and npm CLI command building for OIDC trusted publishing. Publishing itself
 * is delegated to the generated GitHub Actions workflow (OIDC), so the agent
 * never holds an npm credential.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Registry metadata projection for one package name. */
export interface NpmPackageInfo {
  /** false when the registry answers 404 (name is available). */
  exists: boolean
  name: string
  latest?: string
  description?: string
  distTags?: Record<string, string>
  versions?: string[]
}

export class NpmService {
  constructor(
    private readonly ctx: Context,
    private readonly registry = 'https://registry.npmjs.org',
  ) {}

  /** Check availability + current metadata of a package name (public read). */
  async checkPackage(name: string): Promise<NpmPackageInfo> {
    let response: Response
    try {
      response = await fetch(this.registry + '/' + encodeURIComponent(name))
    } catch (error) {
      throw new Error('npm: registry query for ' + name + ' failed: ' + String(error))
    }
    if (response.status === 404) return { exists: false, name }
    if (!response.ok) {
      throw new Error('npm: registry responded ' + response.status + ' for ' + name)
    }
    const meta = await response.json() as {
      name?: string
      description?: string
      'dist-tags'?: Record<string, string>
      versions?: Record<string, unknown>
    }
    return {
      exists: true,
      name: meta.name ?? name,
      ...(meta.description === undefined ? {} : { description: meta.description }),
      ...(meta['dist-tags'] === undefined ? {} : { distTags: meta['dist-tags'] }),
      ...(meta.versions === undefined ? {} : { versions: Object.keys(meta.versions) }),
      ...(meta['dist-tags']?.latest === undefined ? {} : { latest: meta['dist-tags'].latest }),
    }
  }

  /**
   * The npm trust github command for one package. npm >= 11.10 performs the
   * OIDC trusted-publisher setup; with a 2FA "writes" account it prompts for an
   * OTP that an agent cannot supply, so the command is surfaced to the human.
   */
  trustCommand(pkg: string, workflowFile: string, repository: string, allowPublish = true): string {
    const flags = [
      '--file ' + workflowFile,
      '--repository ' + repository,
      ...(allowPublish ? ['--allow-publish'] : []),
      '-y',
    ]
    return 'npm trust github ' + pkg + ' ' + flags.join(' ')
  }
}

/** Draft result of running npm trust github (capability check). */
export interface TrustDraft {
  ok: boolean
  needsOtp: boolean
  detail: string
}
