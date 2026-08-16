# dsh-github-connector

第三方 DeepSeek Harness（DSH）插件：为 DSH 接入 GitHub 能力。**不改 dsh 源码**，通过官方 bundle/profile 机制安装。

## 包结构（树外三包）

| 包 | 角色 | 关键声明 |
|---|---|---|
| `dsh-github` | bundle + host 面插件 | `dsh.bundle.patch` + `cordis.patch.yml` |
| `dsh-github-ui` | client 面插件（设置页） | `dsh.client` + `exports["./client"]` |
| `dsh-github-wire` | 共享 wire 契约（zod + strict Typert descriptors） | 被 host/client 同时依赖 |

## 安装（用户侧）

```sh
# 本地打包安装：必须 file: 前缀（默认 link: 不会安装 bundle 的子依赖）
dsh plugin --profile <name> add file:./packages/dsh-github

# git 安装（拉源码，pnpm ≥10 会拦截 build 脚本，需按提示放行）
dsh plugin --profile <name> add github:you/dsh-github-connector#<sha>
# 在 profile 的 pnpm-workspace.yaml 里加：
#   allowBuilds:
#     dsh-github: true
#     dsh-github-ui: true
#     dsh-github-wire: true

# npm / tarball 安装（发布产物，无需 build 授权）
dsh plugin --profile <name> add dsh-github
dsh plugin --profile <name> add ./dsh-github-0.1.0.tgz
```

## 隔离验证（dogfooding）

```sh
# 3080 是你正在用的工作实例，不要动它。用独立端口验证：
pnpm -r build
dsh plugin --profile web remove dsh-github && dsh plugin --profile web add file:./packages/dsh-github
dsh --profile web --port 3999    # 独立进程/端口，同 profile 共享数据
# 服务端冒烟：curl /plugins/dsh-github-ui/client.js + POST /api github/whoami
```

## 开发

```sh
pnpm install
pnpm test          # 纯函数单测（不依赖 @deepseek-ai 运行时）
pnpm build
pnpm typecheck
```

## 架构要点

- **token**：走 `ctx.credentials`（credential-ref `GITHUB_TOKEN`），值只存 `$DSH_HOME/.credentials.yaml`，Web 只写不回读。
- **git 认证**：per-run env + 内联 credential helper（token 不进 argv / remote URL / `.git/config`）。
- **配置**：`ctx.settings.register('github', …)` 本地持久化；Web 读写走自定义 Typert Remote（绕开 apiproxy settings 白名单）。
- **Typert 手写契约**：generator 未随 dsh 分发，因此 `dsh-github-wire` 手写 strict `InvocationDescriptor[]`；host 侧 `ctx.typert.register(GITHUB_HOST_CONTRIBUTION)`，client 侧 `ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)`，两端共享同一份 descriptor 不漂移。
- **危险操作零入口**：删除仓库/分支不提供；push 无 `--force`。

## 依赖版本

依赖 `@deepseek-ai/*` 当前 `0.1.0-rc.5`（pre-release），以 npm 实际发布版本为准。client bundle 的 external 清单与 `window.__ModuleLoader__.load` 契约见 `packages/dsh-github-ui/tsdown.config.ts`。

## 当前状态 / 路线图

### 已实现

- host 面 `ctx.github`（GitHubService extends TypertRemoteService）：REST + git（push/pull）。
- 8 个 Agent 工具：`github_repo_create` / `github_push`（origin 推断）/ `github_pull` / `github_pr` / `github_pr_list` / `github_pr_get` / `github_review` / `github_review_list`。
- Web 设置页：token 写入/移除、连接测试、权限开关、git 身份、默认可见性。
- 单测：`git-utils`、`github-rest`（mock fetch + token 不回显）。

### 待办

- 在装有 `@deepseek-ai/*` 依赖的环境跑 `pnpm install && pnpm test && pnpm build`。
- 联调 Typert Remote（host `ctx.typert.register` 与 client `$mount` 的 endpoint/wire 一致性）。
- Web e2e（Playwright）。
- 可选：`github_pull` clone 到目录、`github_review` 行级 inline comments、OAuth device flow / GHES SSO。

