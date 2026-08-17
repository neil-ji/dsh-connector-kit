# DSH GitHub 连接器 —— 第三方标准插件设计方案（不改 dsh 源码）

> 目标：以一个**独立 npm bundle** 接入 DeepSeek Harness（DSH），用户 `dsh plugin add` 一次安装即可获得：Agent 侧 GitHub 工具（建仓/推送/PR/审查等）+ Web 设置页（设置 Modal 侧边栏新增 Github 项，用于 token 配置、连接测试、权限开关等）。**不 fork、不修改 `~/AIGC/dsh` 任何源码。**
>
> 本方案基于对 dsh 源码的核实：第三方接入走官方 `dsh.bundle` + `cordis.patch.yml` + `dsh.client` 机制；Agent 工具、凭证、Web slot 均对第三方开放。唯一需要绕开的现有限制是 apiproxy 的 settings namespace 白名单，方案用标准 Typert Remote 自建配置读写通道解决。

---

## 0. 结论摘要

- **交付物**：两个第三方 npm 包（可放进一个仓库）：
  - `dsh-github` — 组合包（bundle）+ host 面插件（能力 + 工具 + Remote 服务）。
  - `dsh-github-ui` — client 面插件（设置页）。
- **安装**：`dsh plugin --profile <name> add dsh-github`（或 git/tarball 安装）。
- **不改 dsh 源码**：不动 `packages/**`、`apps/**`、`bundle/**`、`SettingsRoot.tsx`、`apiproxy` 白名单。
- **能力层**：token 走 `ctx.credentials`（无白名单）；配置走 `ctx.settings`（host 面本地持久化）；Agent 工具走 `ctx.tools`；git 命令走 `ctx.shell`。
- **Web 配置读写**：走标准 **Typert Remote**（host 侧 `@Remote` 反射分发 + client 侧手写 strict contribution `$mount`），绕开 `settings.describe` 白名单。
- **危险操作默认禁止**：删除仓库/删除分支不提供入口；force push 默认关且工具参数不可达。

---

## 1. 需求分解

### 1.1 功能

**Agent 工具（model-facing）**
- `github_repo_create`：创建远端仓库（核心：本地建目录 → 写代码 → 自动建仓 → 推送）。
- `github_push`：ensure remote、建分支、add/commit/push（**永不 force**）。
- `github_pull`：fetch/pull/clone。
- `github_pr`：创建/列取/查看 PR。
- `github_review`：列 PR diff、提交 review comment、approve/request-changes。

**Web 设置页（设置 Modal 侧边栏 `Github`）**
- token 填写/移除/状态（已配置来源、只写不回显）。
- 连接测试（显示登录身份、scopes）。
- 权限开关、git 身份、默认可见性。
- 复用 DSH 主题与组件。

**危险操作默认禁止**
- 删除仓库、删除分支、强制覆盖：不提供 tool 入口 / 默认关。

### 1.2 约束
- 纯第三方，不改 dsh 源码。
- token 值只进 credentials seam，settings 文档只存引用。
- 凭证每操作重解析（hot-reload）。
- 无 token / 服务缺失时 fail loud。

---

## 2. 第三方接入机制（已核实的官方路径）

### 2.1 组合包（bundle）与 profile

- bundle 是 npm 包，`package.json` 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`；patch 里 `insert` 插件行，行 `name` 是包名（Node 解析到已安装代码）。
- 用户安装：`dsh plugin --profile demo add dsh-github`（或 `github:you/dsh-github#<sha>`、tarball、npm）。
- 加载顺序：`@deepseek-ai/dsh-base` → 已安装 bundle → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。

### 2.2 host 面插件（普通插件，函数/类形态）

- 导出 `apply(ctx, config)`；`inject` 声明依赖服务（`credentials`/`settings`/`tools`/`shell` 等内置 seam 都可注入）。
- 内置 seam 全在 base 层：`settings`（dsh-settings-file）、`credentials`（dsh-credentials-local）、`shell`（bash-sandbox）、`tools`。

### 2.3 client 面插件（`dsh.client`）

- client 包 `package.json` 声明 `"dsh": { "client": { "platform": "web", "inject": [...] } }`，且 `exports["./client"]` 指向构建好的浏览器 bundle。
- bundle 的 `cordis.patch.yml` 里 insert 一行（`name` 指向该 client 包）后，host 的 `dsh-client-modules` node 半边会**自动扫描**到它，serve `/plugins/<id>/client.js` 并注入 `window.__DSH_BOOT__`（无需改 web-app roster）。
- 一行两用：该行既是 host loader entry（node 半边 `apply` 空壳），也是 client 插件（browser 半边）。

### 2.4 关键限制与绕法

| 限制 | 影响 | 本方案绕法 |
|---|---|---|
| apiproxy `WEB_SETTINGS_NAMESPACES` 白名单 | 第三方 settings namespace 无法通过 `settings.describe` 暴露给 Web | 配置读写走**自定义 Typert Remote**，host 侧内部仍用 `ctx.settings` 持久化 |
| `credentials` 无白名单 | 无 | token 直接走 `api.credentials.describe/set/unset` |
| `SettingsRoot.navIcon` 硬编码 | 未知 section id 回退齿轮图标 | 接受齿轮（与系统风格一致）；GitHub 品牌标识放页面内容内 |
| `settings.section` slot | 完全开放 | 第三方 client 插件直接注册 |

---

## 3. 包结构

```
dsh-connector-kit/                    # 你的第三方仓库
├── packages/
│   ├── dsh-github/                  # bundle + host 面插件
│   │   ├── package.json             # dsh.bundle.patch + 依赖 dsh-github-ui
│   │   ├── cordis.patch.yml         # insert host 行 + client 行
│   │   ├── src/
│   │   │   ├── index.ts             # 主插件：装配 service + tools + remote
│   │   │   ├── github-service.ts    # GitHubService（REST + credential + settings）
│   │   │   ├── github-rest.ts       # fetch 封装 / REST 客户端
│   │   │   ├── github-remote.ts     # GithubRemote extends TypertRemoteService
│   │   │   ├── tools.ts             # defineTool x N
│   │   │   ├── config.ts            # settings schema + namespace
│   │   │   └── types.ts
│   │   └── tsconfig.json / tsdown.config.ts
│   └── dsh-github-ui/               # client 面插件
│       ├── package.json             # dsh.client + exports["./client"]
│       ├── src/
│       │   ├── index.ts             # host 半边（空壳 apply）
│       │   ├── client/
│       │   │   ├── index.ts         # 注册 settings.section + remote + token
│       │   │   ├── GithubSection.tsx
│       │   │   ├── store.ts
│       │   │   ├── remote-contribution.ts   # 手写 strict TypertRemoteContribution
│       │   │   ├── locales.ts
│       │   │   └── *.module.css
│       │   └── invariant.ts
│       └── tsconfig.json / tsdown.config.ts
└── package.json                     # monorepo 根（可选）
```

---

## 4. Host 面设计（`dsh-github`）

### 4.1 cordis.patch.yml

```yaml
- insert:
    - id: github
      name: 'dsh-github'          # host 面主插件
      config:
        apiBase: 'https://api.github.com'
    - id: github-ui
      name: 'dsh-github-ui'       # client 面（package.json 有 dsh.client）
```

`dsh-github/package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，并 `dependencies` 含 `dsh-github-ui`（及内置 `@deepseek-ai/*` peerDependencies）。

### 4.2 配置 schema（`config.ts`）

```ts
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const GITHUB_SETTINGS_NAMESPACE = settingsNamespace('github')

export interface GithubConfig {
  tokenEnv?: string                  // 默认 'GITHUB_TOKEN'（credential-ref）
  apiBase?: string                   // 默认 https://api.github.com
  gitName?: string
  gitEmail?: string
  defaultVisibility?: 'private' | 'public'   // 默认 private
  allowCreateRepo?: boolean          // 默认 true
  allowPush?: boolean                // 默认 true
  allowPull?: boolean                // 默认 true
  allowPullRequest?: boolean         // 默认 true
  allowReview?: boolean              // 默认 true
  allowForcePush?: boolean           // 默认 false（危险）
}

export const Config: Schema<GithubConfig> = Schema.object({
  tokenEnv: Schema.string().role('credential-ref').default('GITHUB_TOKEN'),
  apiBase: Schema.string().default('https://api.github.com'),
  gitName: Schema.string(),
  gitEmail: Schema.string(),
  defaultVisibility: Schema.union(['private', 'public']).default('private'),
  allowCreateRepo: Schema.boolean().default(true),
  allowPush: Schema.boolean().default(true),
  allowPull: Schema.boolean().default(true),
  allowPullRequest: Schema.boolean().default(true),
  allowReview: Schema.boolean().default(true),
  allowForcePush: Schema.boolean().default(false),
})
```

- token 是 **credential-ref**（对齐 `llm-pi-ai` 的 `apiKeyEnv`）：值在 credentials seam，settings 文档只存引用。
- 危险项默认 `false`；`allowDeleteRepo`/`allowDeleteBranch` **不设字段**（架构性禁止）。

### 4.3 GitHubService（`github-service.ts`）

```ts
import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { GITHUB_SETTINGS_NAMESPACE, type GithubConfig } from './config.ts'

export class GithubError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message); this.name = 'GithubError'
  }
}

export class GitHubService extends Service {
  static inject = ['credentials', 'settings', 'shell']

  private source: () => GithubConfig

  constructor(ctx: Context, entry: GithubConfig) {
    super(ctx, 'github')
    this.source = () => entry
    // 本地持久化 + hot-reload（不经 apiproxy 白名单，仅 host 内部使用）
    ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(GITHUB_SETTINGS_NAMESPACE, Config, { base: entry })
      this.source = () => scope.get()
      scope.watch(() => { /* 配置变化时无需重建，读到即用 */ })
    })
  }

  get config() { return this.source() }

  async resolveToken(): Promise<string | undefined> {
    const ref = credentialRef(this.config.tokenEnv ?? 'GITHUB_TOKEN')
    return (await this.ctx.get('credentials')?.resolve(ref))?.value
  }

  private async token(draft?: string): Promise<string> {
    if (draft !== undefined) return draft
    const hit = await this.resolveToken()
    if (hit === undefined) throw new GithubError('MISSING_CREDENTIAL', 'GITHUB_TOKEN 未配置')
    return hit
  }

  private assertAllowed(key: keyof GithubConfig): void {
    if (this.config[key] !== true) throw new GithubError('OPERATION_FORBIDDEN', `github: ${key} 未启用`)
  }

  async whoami(draftToken?: string): Promise<GithubUser> {
    return this.request('GET', '/user', undefined, await this.token(draftToken))
  }

  async createRepo(req: CreateRepoRequest): Promise<CreateRepoResult> {
    this.assertAllowed('allowCreateRepo')
    return this.request('POST', '/user/repos', {
      name: req.name,
      private: req.visibility ?? this.config.defaultVisibility === 'private',
      description: req.description,
    }, await this.token())
  }

  // 干净 URL（不含 token）；认证走 per-run env + 内联 credential helper
  remoteUrl(owner: string, repo: string): string {
    return `https://${this.gitHost()}/${owner}/${repo}.git`
  }
  // push 时：env 传 GITHUB_TOKEN，git -c credential.helper='!f(){ echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f' push …

  // createPull / listPulls / getPull / createReview …同构
  private async request<T>(method: string, path: string, body: unknown, token: string): Promise<T> {
    const res = await fetch(this.config.apiBase + path, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) {
      // 错误信息永不回显 token
      const text = await res.text()
      throw new GithubError(res.status === 401 ? 'AUTH_FAILED' : 'REQUEST_FAILED', text.slice(0, 500), res.status)
    }
    return res.json() as Promise<T>
  }
}
```

要点：
- `ctx.settings.register` 只在 host 面持久化配置，**不依赖** apiproxy 白名单（白名单只作用于 wire 的 `settings.describe`）。
- `resolveToken()` 每操作调用（hot-reload）。
- `ctx.shell` 供 push/pull 工具执行 git（见 tools.ts）。

### 4.4 Typert Remote（`github-remote.ts`）

```ts
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

/** Wire namespace 'github'（service key 即 namespace）。 */
export class GithubRemote extends TypertRemoteService {
  static inject = ['github']

  constructor(ctx: Context) {
    super(ctx, 'github')
  }

  @Remote('whoami')
  async whoami(request: { draftToken?: string }): Promise<GithubWhoamiValue> {
    const user = await this.ctx.github.whoami(request.draftToken)
    return { login: user.login, name: user.name, htmlUrl: user.html_url, scopes: this.scopes(user) }
  }

  @Remote('config.get')
  configGet(_request: Record<string, never>): GithubConfigView {
    const c = this.ctx.github.config
    return { apiBase: c.apiBase, gitName: c.gitName, gitEmail: c.gitEmail,
      defaultVisibility: c.defaultVisibility, allowCreateRepo: c.allowCreateRepo,
      allowPush: c.allowPush, allowPull: c.allowPull, allowPullRequest: c.allowPullRequest,
      allowReview: c.allowReview, allowForcePush: c.allowForcePush }
  }

  @Remote('config.set')
  async configSet(request: { patch: Record<string, unknown> }): Promise<GithubConfigView> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('github: settings service absent')
    await settings.update(GITHUB_SETTINGS_NAMESPACE, request.patch)
    return this.configGet({})
  }
}
```

机制（已核实）：
- host 侧 **无需生成 Typert strict artifact**：gateway 的 SRC fallback 通过 `typertRemote` binding + `@Remote` marker 反射分发（`api/gateway/src/index.ts` 的 `collectSrcClaims`/`resolveSrcDescriptor`）。
- client 侧手写 strict contribution（见 §5.3），`$mount` 后得到 `ctx.remote.github.*`。
- `@Remote` 是标准 decorator（`ClassMethodDecoratorContext`），TS 5.x 默认支持。

### 4.5 Agent 工具（`tools.ts`）

```ts
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'github_repo_create',
    description: 'Create a remote GitHub repository…',
    parameters: {
      name: { type: 'string', required: true },
      description: { type: 'string' },
      visibility: { type: 'string', enum: ['private', 'public'] },
      // 刻意无 delete/force 字段
    },
    output: { schema: {/* … */}, render: (_a, v) => [{ type: 'text', text: `Created ${v.htmlUrl}` }] },
    async execute(args) {
      const repo = await this.ctx.github.createRepo({ name: args.name, … })
      return { htmlUrl: repo.html_url, cloneUrl: repo.clone_url, sshUrl: repo.ssh_url }
    },
    presentCall: args => ({ card: 'generic', title: 'Create GitHub repo', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'github_push',
    description: 'Commit and push the current working tree to GitHub (never force-push)…',
    parameters: {
      message: { type: 'string', required: true },
      branch: { type: 'string' },
      add: { type: 'boolean' },
      // 无 --force
    },
    async execute(args, exec) {
      const github = ctx.github
      const shell = ctx.shell
      // 1) 推断或读缓存的 owner/repo；2) remoteUrl 干净 URL；3) token 走 env + credential helper 执行 push -u
      const url = github.remoteUrl(owner, repo)
      const run = await shell.run({
        command: `git remote set-url origin '${url}' && git -c credential.helper='…$GITHUB_TOKEN…' push -u origin ${branch}`,
        workdir: exec.cwd,
        env: { GITHUB_TOKEN: token },
      })
      if (run.exitCode !== 0) throw new Error(run.stderr.text || 'push failed')
      return { pushed: true, branch }
    },
    presentCall: …,
  }))
  // github_pull / github_pr / github_review 同构
}
```

---

## 5. Client 面设计（`dsh-github-ui`）

### 5.1 挂载设置侧边栏 item

```ts
// packages/dsh-github-ui/src/client/index.ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'   // settings.section 类型
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'          // ctx.remote 类型
import { GithubSection } from './GithubSection.tsx'
import { GithubSettingsStore } from './store.ts'
import { githubRemoteContribution } from './remote-contribution.ts'
import { en, zh, type GithubKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.github': GithubKey }
}

const NS = 'settings.github'
export const inject = ['slots', 'locale', 'connection', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'github-ui: copy')
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new GithubSettingsStore(connection.api, ctx.remote)

  // 挂载自定义 Remote namespace
  ctx.remote.$mount(githubRemoteContribution)

  ctx.effect(() => {
    const refresh = () => { controller.refreshIfLoaded() }
    return () => { /* disposer */ }
  }, 'github-ui: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'github',
    order: 20,
    label: () => t('nav'),
    inject: () => ({ controller, useSnapshot: controller.hook, api: connection.api, t }),
  }, GithubSection))
}
```

### 5.2 页面内容

复用 `@deepseek-ai/dsh-client-ui-primitives`（`Button`/`Input`/`DisclosureRow`/`StateDot`/`Pill`/`Toast`/CSS Modules）与 Models 页同风格：

- **连接状态卡片**：`StateDot` + 登录身份 + scopes。
- **Token（credential-ref，无白名单）**：`api.credentials.describe({refs:['GITHUB_TOKEN']})` 显示状态；`api.credentials.set/unset` 写入/移除；输入框 `type=password` 只写不回显。
- **连接测试**：`ctx.remote.github.whoami({draftToken?})`。
- **权限/git 身份/可见性**：读 `ctx.remote.github.config.get()`，写 `ctx.remote.github.config.set({patch})`。
- 订阅 `ctx.remote.$on('credentials/updated')` / `settings/document-updated` 刷新。

### 5.3 手写 strict Remote contribution（`remote-contribution.ts`）

无需跑 typert-generator，手写 `TypertRemoteContribution`（`$mount` 只要求 strict codec）：

```ts
import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

const whoamiValueSchema = z.object({
  login: z.string(), name: z.string().nullable(), htmlUrl: z.string(), scopes: z.array(z.string()).optional(),
})

export const githubRemoteContribution: TypertRemoteContribution = {
  package: 'dsh-github',
  descriptors: [
    {
      id: 'dsh-github#github/whoami',
      service: 'github', namespace: 'github', method: 'whoami',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'request', wire: 'request', source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-github#WhoamiRequest', schema: z.object({ draftToken: z.string().optional() }) } },
      ],
      result: { mode: 'strict', typeSymbol: 'dsh-github#GithubWhoamiValue', schema: whoamiValueSchema },
    },
    {
      id: 'dsh-github#github/config.get', service: 'github', namespace: 'github', method: 'config.get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-github#GithubConfigView', schema: configViewSchema },
    },
    {
      id: 'dsh-github#github/config.set', service: 'github', namespace: 'github', method: 'config.set',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'request', wire: 'request', source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-github#ConfigPatch', schema: z.object({ patch: z.record(z.unknown()) }) } },
      ],
      result: { mode: 'strict', typeSymbol: 'dsh-github#GithubConfigView', schema: configViewSchema },
    },
  ],
}
```

- descriptor 的 `wire` 必须与 host 方法参数名一致（gateway SRC fallback 以参数名为 wire）。
- 也可选用官方 `@deepseek-ai/dsh-typert-generator`（`./tsdown` 插件）自动生成，二者等价；手写更轻。

### 5.4 client 包 manifest（`dsh-github-ui/package.json`）

```json
{
  "name": "dsh-github-ui",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-ui-settings": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-api-remotes": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-client-connection": "^0.1.0-rc.5",
    "@deepseek-ai/dsh-typert-protocol": "^0.1.0-rc.5",
    "@deepseek-ai/cordis": "^0.1.0-rc.5"
  }
}
```

---

## 6. 数据流

**配置 / 连接测试**
```
Web Github 页
  ├─ token: api.credentials.describe/set/unset  → ctx.credentials（无白名单）
  ├─ 配置: ctx.remote.github.config.get/set     → Typert Gateway → GithubRemote（ctx.settings 持久化）
  └─ 测试: ctx.remote.github.whoami({draft})    → Typert Gateway → GitHubService.whoami → GET /user
```

**Agent 建仓 → 推送**
```
github_repo_create → ctx.github.createRepo → resolveToken() → POST /user/repos → cloneUrl
github_push       → ctx.github.remoteUrl() → 干净 URL → token 走 env + credential helper → ctx.shell.run(push -u)
```

---

## 7. 权限与安全

1. token 只进 credentials seam；settings 只存 `tokenEnv: GITHUB_TOKEN`。
2. 每操作 resolve token（改 token 立即生效）。
3. Web 永不回传 token（`credentials.describe` 只给 configured/source/writable）。
4. 危险操作架构性禁止：schema 无 delete 字段、`allowForcePush` 默认 false、tool 无 force/delete 参数、service `assertAllowed` 兜底。
5. git 认证已改走 per-run env + 内联 credential helper：token 不进 argv、不进 remote URL，正常路径不落 stdout/stderr。

---

## 8. 实施步骤

1. **脚手架**：建仓库，`dsh-github` + `dsh-github-ui` 两个包，配 tsdown（`prepare` 自包含构建，供 git 安装）。
2. **host 能力**：`config.ts` + `github-service.ts`（mock fetch 单测）。
3. **Remote**：`github-remote.ts`（`@Remote`）+ 手写 contribution。
4. **tools**：`tools.ts` 五个工具 + git 编排（单测）。
5. **client**：`GithubSection` + `store` + `remote-contribution`（单测 + Playwright）。
6. **装配**：`dsh-github/cordis.patch.yml` insert 两行。
7. **安装验收**：
   ```sh
   dsh plugin --profile demo add ./packages/dsh-github
   dsh --profile demo --dump-config
   dsh --profile demo web   # 打开设置 Modal → Github
   ```
8. **收尾**：`pnpm test/typecheck/build`；README（git 安装的 allowBuilds 说明）。

---

## 9. 风险与待确认

1. **`@deepseek-ai/*` 发布状态**：当前 `0.1.0-rc.5`（pre-release，AGENTS.md 声明无外部消费者）；第三方 peer 依赖版本以 npm 实际发布为准，或从 git 子包安装。
2. **手写 strict contribution 的维护**：host 方法签名与 client wire 名/chema 需同步；可升级 typert-generator 自动生成。
3. **SRC fallback 是 gateway 的保守路径**：无 strict host artifact 时参数用 `src-json` codec；行为正确但错误信息/性能略逊，可后续接 generator。
4. **navIcon**：第三方 section 显示齿轮图标（回退），无法换 GitHub 图标（除非改 `SettingsRoot.tsx`——本方案不改）。
5. **GHES/SSO**：首版仅 PAT；企业 `apiBase` 可配。
6. **git 认证日志脱敏**：已实现为 credential helper + env（见 §4.3）；DSH subprocess 仅 scrub ambient env、无 stdout mask，实现层不再把 token 放进任何可回显位置。
```

> 依据：`docs/user/develop/basic/publish.md`（bundle/profile 安装）、`docs/user/develop/basic/index.md`（插件形态）、`packages/client/modules/src/index.ts`（dsh.client 扫描）、`packages/typert/protocol` + `packages/api/gateway`（Typert Remote SRC fallback 与 `$mount` strict 校验）、`packages/host/apiproxy/src/api-proxy.ts`（settings 白名单限制）。
