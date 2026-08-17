/**
 * Model-facing npm tools. Publishing is delegated to the generated GitHub
 * Actions workflow (OIDC); these tools cover package check, scaffold, trusted
 * publisher setup and the one-shot launch orchestration.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GitHubService } from 'dsh-connector-github'
import type { NpmService } from './npm-service.ts'
import { launchPackage } from './launch.ts'
import { writeScaffold } from './scaffold.ts'
import { renderScaffold } from './scaffold.ts'

export function registerNpmTools(ctx: Context, npm: NpmService, getGithub: () => GitHubService | undefined): void {
  ctx.tools.register(defineTool({
    name: 'npm_package_check',
    description:
      'Check availability and current metadata of an npm package name '
      + '(registry query, no credentials).',
    parameters: {
      name: { type: 'string', required: true, description: 'Package name, e.g. my-awesome-lib.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exists: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          latest: { type: 'string' },
          description: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.exists
          ? value.name + ' is taken (latest: ' + (value.latest ?? '?') + ')'
          : value.name + ' is available',
      }],
    },
    async execute(args) {
      const info = await npm.checkPackage(args.name)
      return {
        exists: info.exists,
        name: info.name,
        ...(info.latest === undefined ? {} : { latest: info.latest }),
        ...(info.description === undefined ? {} : { description: info.description }),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Check npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_scaffold',
    description:
      'Generate a minimal publishable TypeScript npm package: package.json, '
      + 'tsconfig, esbuild build, README/LICENSE, .github/workflows (OIDC npm '
      + 'release + Pages) and a landing/docs Pages site. Does not touch GitHub '
      + 'or npm; use npm_launch for the full pipeline.',
    parameters: {
      name: { type: 'string', required: true, description: 'Package/repo name.' },
      description: { type: 'string', description: 'One-line package description.' },
      repoOwner: { type: 'string', description: 'GitHub owner for links (defaults to current identity).' },
      author: { type: 'string', description: 'Author name (LICENSE/README).' },
      dir: { type: 'string', description: 'Output directory (defaults to ./<name>).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          files: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'Scaffolded ' + value.files + ' files -> ' + value.dir }],
    },
    async execute(args, exec) {
      const github = getGithub()
      const owner = args.repoOwner ?? (github === undefined ? '' : (await github.getIdentity()).login)
      const author = args.author ?? github?.config.gitName ?? owner
      const files = await renderScaffold({
        packageName: args.name,
        description: args.description ?? '',
        repoOwner: owner,
        repoName: args.name,
        authorName: author,
        licenseYear: String(new Date().getFullYear()),
      })
      const dir = args.dir ?? args.name
      const count = await writeScaffold(dir, files)
      return { dir, files: count }
    },
    presentCall: args => ({ card: 'generic', title: 'Scaffold npm package', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_trust_add',
    description:
      'Configure npm OIDC trusted publishing for a package (npm >= 11.10): '
      + 'the GitHub Actions workflow release.yml becomes an allowed publisher. '
      + 'With a 2FA-writes npm account the command pauses for an OTP, so the '
      + 'exact command is returned for you to run in a terminal.',
    parameters: {
      pkg: { type: 'string', required: true, description: 'npm package name.' },
      repository: { type: 'string', required: true, description: 'owner/repo on GitHub.' },
      workflowFile: { type: 'string', description: 'Workflow file name (default release.yml).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['configured', 'needs-otp', 'failed'], required: true },
          command: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'configured'
          ? 'Trusted publisher configured for ' + _args.pkg
          : value.status === 'needs-otp'
            ? 'Run in a terminal (OTP required): ' + (value.command ?? '')
            : 'npm trust failed: ' + (value.detail ?? ''),
      }],
    },
    async execute(args, exec) {
      const command = npm.trustCommand(args.pkg, args.workflowFile ?? 'release.yml', args.repository)
      const sandboxPolicy = exec.agent?.session === undefined
        ? undefined
        : (ctx.get('sandboxPolicy') as { resolve(o: { session: unknown }): unknown } | undefined)?.resolve({ session: exec.agent.session })
      const shell = ctx.shell as { run(r: { command: string; workdir: string; timeoutMs?: number; sandboxPolicy?: unknown }): Promise<{ exitCode: number; aborted?: boolean; timedOut?: boolean; stdout: { text: string }; stderr: { text: string } }> }
      const run = await shell.run({ command, workdir: process.cwd(), timeoutMs: 25000, ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }) })
      const combined = (run.stdout.text + '\n' + run.stderr.text).toLowerCase()
      const paused = run.aborted === true || run.timedOut === true
      if (run.exitCode === 0 && !paused) return { status: 'configured' as const, command, detail: 'trusted publisher configured' }
      if (paused || /otp|one-time|two-factor|two factor|2fa|passcode|authentication required|eneedauth/i.test(combined)) {
        return { status: 'needs-otp' as const, command, detail: 'npm trust requires an OTP (2FA writes mode); run it in a terminal' }
      }
      return { status: 'failed' as const, command, detail: (run.stderr.text || run.stdout.text).slice(0, 400) }
    },
    presentCall: args => ({ card: 'generic', title: 'Configure npm trusted publisher', rawInput: args.pkg }),
  }))

  ctx.tools.register(defineTool({
    name: 'npm_launch',
    description:
      'One-shot launch of an open-source npm package: validates the npm name, '
      + 'scaffolds a publishable TS package (with OIDC release workflow + Pages '
      + 'site), creates the GitHub repo, pushes the initial commit, enables Pages '
      + 'with GitHub Actions, configures the npm trusted publisher (pauses for an '
      + 'OTP when needed) and creates the v0.1.0 annotated tag to trigger the CI '
      + 'npm publish. Requires the dsh-connector-github plugin (GitHub credentials).',
    parameters: {
      name: { type: 'string', required: true, description: 'npm package name (also the GitHub repo name).' },
      description: { type: 'string', description: 'One-line package description.' },
      owner: { type: 'string', description: 'GitHub owner; defaults to the authenticated identity.' },
      visibility: { type: 'string', enum: ['private', 'public'], description: 'Repo visibility (default public).' },
      author: { type: 'string', description: 'Author name (LICENSE/README).' },
      dir: { type: 'string', description: 'Local output directory (defaults to ./<name>).' },
      initialVersion: { type: 'string', description: 'First release version (default 0.1.0).' },
      skipTrust: { type: 'boolean', description: 'Skip the npm trust step (already configured); still create the tag.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          repo: { type: 'object', additionalProperties: false, properties: { fullName: { type: 'string', required: true }, htmlUrl: { type: 'string', required: true } }, required: true },
          pushed: { type: 'boolean', required: true },
          pages: { type: 'object', additionalProperties: false, properties: { configured: { type: 'boolean', required: true }, url: { type: 'string' }, detail: { type: 'string' } }, required: true },
          trust: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true }, command: { type: 'string' }, detail: { type: 'string' } }, required: true },
          tag: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, sha: { type: 'string' } } },
          next: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: 'Launched ' + value.repo.fullName + ' (' + value.repo.htmlUrl + ')'
          + (value.tag === undefined ? '' : ' tag ' + value.tag.name)
          + (value.trust.status === 'needs-otp' ? ' — npm trust needs OTP: ' + (value.trust.command ?? '') : ''),
      }],
    },
    async execute(args, exec) {
      const github = getGithub()
      if (github === undefined) {
        throw new Error('dsh-connector-github is not loaded: add it to the profile bundles before using npm_launch')
      }
      return launchPackage(ctx, github, npm, {
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.owner === undefined ? {} : { owner: args.owner }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.dir === undefined ? {} : { dir: args.dir }),
        ...(args.initialVersion === undefined ? {} : { initialVersion: args.initialVersion }),
        ...(args.skipTrust === undefined ? {} : { skipTrust: args.skipTrust }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Launch npm package', rawInput: args.name }),
  }))
}
