/**
 * Model-facing GitHub tools. Every tool delegates to GitHubService; dangerous
 * operations are absent from the parameter schemas (no force, no delete).
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GitHubService } from './github-service.ts'

/** Register all GitHub tools on the host tool registry. */
export function registerGithubTools(ctx: Context, github: GitHubService): void {
  ctx.tools.register(defineTool({
    name: 'github_repo_create',
    description:
      'Create a remote GitHub repository for the authenticated user. '
      + 'Use this as the first step of the publish flow: create a local project, '
      + 'write the code, then call this to create the remote and github_push to publish.',
    parameters: {
      name: { type: 'string', required: true, description: 'Repository name (owner/repo-style names are rejected).' },
      description: { type: 'string', description: 'Optional repository description.' },
      visibility: { type: 'string', enum: ['private', 'public'], description: 'Defaults to the configured visibility.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
          cloneUrl: { type: 'string', required: true },
          sshUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Created ${value.fullName} (\${value.htmlUrl})` }],
    },
    async execute(args) {
      return github.createRepo({
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub repo', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_push',
    description:
      'Commit and push the working tree to GitHub. Never force-pushes and never '
      + 'deletes branches or repositories.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory (defaults to the host cwd).' },
      owner: { type: 'string', description: 'Repository owner; defaults to the origin remote.' },
      repo: { type: 'string', description: 'Repository name; defaults to the origin remote.' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      branch: { type: 'string', description: 'Branch to push (default main).' },
      add: { type: 'boolean', description: 'Run git add -A first (default true).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pushed: { type: 'boolean', required: true },
          branch: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Pushed branch ${value.branch}` }],
    },
    async execute(args, exec) {
      return github.push({
        cwd: args.cwd ?? process.cwd(),
        ...(args.owner === undefined ? {} : { owner: args.owner }),
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        message: args.message,
        branch: args.branch ?? 'main',
        ...(args.add === undefined ? {} : { add: args.add }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Push to GitHub', rawInput: { owner: args.owner ?? 'origin', repo: args.repo ?? 'origin', branch: args.branch ?? 'main' } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pull',
    description: 'Pull the latest changes for a GitHub repository branch.',
    parameters: {
      cwd: { type: 'string', description: 'Working directory (defaults to the host cwd).' },
      branch: { type: 'string', description: 'Branch to pull (defaults to the current branch).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { pulled: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'Pulled' }],
    },
    async execute(args, exec) {
      return github.pull({
        cwd: args.cwd ?? process.cwd(),
        ...(args.branch === undefined ? {} : { branch: args.branch }),
        ...(exec.agent?.session === undefined ? {} : { session: exec.agent.session }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Pull from GitHub', rawInput: args.branch }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pr',
    description: 'Create a GitHub pull request between two branches.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      title: { type: 'string', required: true },
      head: { type: 'string', required: true, description: 'Source branch.' },
      base: { type: 'string', required: true, description: 'Target branch.' },
      body: { type: 'string', description: 'PR body.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `PR #${value.number}: ${value.title} (\${value.htmlUrl})` }],
    },
    async execute(args) {
      const pr = await github.createPull({
        owner: args.owner,
        repo: args.repo,
        title: args.title,
        head: args.head,
        base: args.base,
        ...(args.body === undefined ? {} : { body: args.body }),
      })
      return { number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url }
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub PR', rawInput: { owner: args.owner, repo: args.repo, head: args.head, base: args.base } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_review',
    description: 'Submit a GitHub pull-request review (approve, request changes, or comment).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      pullNumber: { type: 'integer', required: true },
      event: { type: 'string', required: true, enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
      body: { type: 'string', description: 'Review body.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { state: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Review submitted: ${value.state}` }],
    },
    async execute(args) {
      return github.createReview({
        owner: args.owner,
        repo: args.repo,
        pullNumber: args.pullNumber,
        event: args.event,
        ...(args.body === undefined ? {} : { body: args.body }),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Review GitHub PR', rawInput: { owner: args.owner, repo: args.repo, pullNumber: args.pullNumber, event: args.event } }),
  }))
  ctx.tools.register(defineTool({
    name: 'github_pr_list',
    description: 'List pull requests for a GitHub repository.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Defaults to open.' },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'integer', required: true },
            title: { type: 'string', required: true },
            state: { type: 'string', required: true },
            htmlUrl: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Found ${value.length} pull request(s)` }],
    },
    async execute(args) {
      const pulls = await github.listPulls({
        owner: args.owner,
        repo: args.repo,
        ...(args.state === undefined ? {} : { state: args.state }),
      })
      return pulls.map(pr => ({ number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url }))
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub PRs', rawInput: { owner: args.owner, repo: args.repo } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_pr_get',
    description: 'Read one GitHub pull request by number.',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      number: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          state: { type: 'string', required: true },
          htmlUrl: { type: 'string', required: true },
          head: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string' } } },
          base: { type: 'object', additionalProperties: false, properties: { ref: { type: 'string' } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `PR #${value.number}: ${value.title}` }],
    },
    async execute(args) {
      const pr = await github.getPull({ owner: args.owner, repo: args.repo, number: args.number })
      return { number: pr.number, title: pr.title, state: pr.state, htmlUrl: pr.html_url, head: { ref: pr.head.ref }, base: { ref: pr.base.ref } }
    },
    presentCall: args => ({ card: 'generic', title: 'Get GitHub PR', rawInput: { owner: args.owner, repo: args.repo, number: args.number } }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_review_list',
    description: 'List the files changed and existing review comments on a pull request (read before reviewing).',
    parameters: {
      owner: { type: 'string', required: true },
      repo: { type: 'string', required: true },
      pullNumber: { type: 'integer', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                filename: { type: 'string', required: true },
                status: { type: 'string', required: true },
                additions: { type: 'integer', required: true },
                deletions: { type: 'integer', required: true },
                changes: { type: 'integer', required: true },
                patch: { type: 'string' },
              },
            },
          },
          comments: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer', required: true },
                path: { type: 'string', required: true },
                body: { type: 'string', required: true },
                user: { type: 'object', additionalProperties: false, properties: { login: { type: 'string' } } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.files.length} file(s), ${value.comments.length} comment(s)` }],
    },
    async execute(args) {
      const [files, comments] = await Promise.all([
        github.getPullFiles({ owner: args.owner, repo: args.repo, number: args.pullNumber }),
        github.listPullComments({ owner: args.owner, repo: args.repo, number: args.pullNumber }),
      ])
      return {
        files: files.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes, ...(f.patch === undefined ? {} : { patch: f.patch }) })),
        comments: comments.map(c => ({ id: c.id, path: c.path, body: c.body, user: { login: c.user.login } })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List GitHub review details', rawInput: { owner: args.owner, repo: args.repo, pullNumber: args.pullNumber } }),
  }))

}
