/**
 * dsh-connector-npm bundle entry: mounts the npm capability service and the
 * model-facing tools. GitHub steps reuse the dsh-connector-github plugin via
 * ctx.github (loaded as a separate bundle).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GitHubService } from 'dsh-connector-github'
import { NpmService } from './npm-service.ts'
import { registerNpmTools } from './tools.ts'

export { NpmService } from './npm-service.ts'
export { renderScaffold, writeScaffold, type ScaffoldOptions } from './scaffold.ts'
export { launchPackage, type LaunchRequest, type LaunchResult } from './launch.ts'

export const name = 'dsh-connector-npm'
export const inject = ['shell', 'tools']

/**
 * @param ctx - host context; ctx.github is provided by dsh-connector-github.
 */
export function apply(ctx: Context, config: Record<string, never> = {}): void {
  const npm = new NpmService(ctx)
  registerNpmTools(ctx, npm, () => ctx.get('github') as GitHubService | undefined)
}
