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
- **网络代理**：`gitProxy`（如 `http://127.0.0.1:7897`，支持 http/https/socks）供 push/pull 走本地 VPN/Clash 代理；Web 设置页可配，留空直连（不覆盖用户全局 git 代理配置）。
- **配置**：`ctx.settings.register('github', …)` 本地持久化；Web 读写走自定义 Typert Remote（绕开 apiproxy settings 白名单）。
- **Typert 手写契约**：generator 未随 dsh 分发，因此 `dsh-github-wire` 手写 strict `InvocationDescriptor[]`；host 侧 `ctx.typert.register(GITHUB_HOST_CONTRIBUTION)`，client 侧 `ctx.remote.$mount(GITHUB_REMOTE_CONTRIBUTION)`，两端共享同一份 descriptor 不漂移。
- **危险操作零入口**：删除仓库/分支不提供；push 无 `--force`。

## 依赖版本

依赖 `@deepseek-ai/*` 当前 `0.1.0-rc.5`（pre-release），以 npm 实际发布版本为准。client bundle 的 external 清单与 `window.__ModuleLoader__.load` 契约见 `packages/dsh-github-ui/tsdown.config.ts`。

## 当前状态 / 路线图

### 已实现

- host 面 `ctx.github`（GitHubService extends TypertRemoteService）：REST + git（push/pull）。
- 40 个 Agent 工具（按领域）：

  **仓库 / 身份**

  | 工具 | 说明 |
  |---|---|
  | `github_whoami` | 认证身份 + token scopes（classic PAT） |
  | `github_repo_get` | 仓库元数据（描述、默认分支、star 等） |
  | `github_repo_create` | 创建远程仓库（owner/repo 名被拒绝） |
  | `github_repo_edit` | 改安全元数据（描述/homepage/topics/开关） |
  | `github_user_repos` | 列出当前账号可访问的仓库 |
  | `github_search_repos` | 搜索仓库 |
  | `github_fork` | fork 到自己的账号 |

  **内容**

  | 工具 | 说明 |
  |---|---|
  | `github_content` | 读文件（UTF-8 解码）或列目录 |
  | `github_repo_tree` | 递归文件树（带 sha） |
  | `github_readme` | 读 README |
  | `github_file_write` | Contents API 单文件提交 |
  | `github_commits` | 提交列表（可按路径/分支过滤） |
  | `github_commit_get` | 单提交 + 变更文件 patch |

  **分支 / 标签**

  | 工具 | 说明 |
  |---|---|
  | `github_branches` / `github_branch_get` | 分支列表 / 分支保护规则 |
  | `github_tags` | 标签列表 |

  **git 操作（走 ctx.shell + 会话沙箱策略 + 可选 gitProxy）**

  | 工具 | 说明 |
  |---|---|
  | `github_clone` | clone 到本地（配合 fork→改→推→PR 流程） |
  | `github_pull` | pull |
  | `github_push` | add/commit/set-url/push（origin 推断，**永不 force**） |

  **PR / 审查**

  | 工具 | 说明 |
  |---|---|
  | `github_pr` / `github_pr_list` / `github_pr_get` | 创建 / 列表 / 读取 PR |
  | `github_review` | 提交 review（APPROVE / REQUEST_CHANGES / COMMENT） |
  | `github_review_list` | PR 变更文件 + 已有评论 |

  **Issue**

  | 工具 | 说明 |
  |---|---|
  | `github_issue_create` / `github_issues` / `github_issue_get` | 创建 / 列表 / 读取（PR 也出现） |
  | `github_issue_comment` | 评论 issue/PR |

  **Release**

  | 工具 | 说明 |
  |---|---|
  | `github_releases` / `github_release_create` | 列表 / 创建（支持 draft/prerelease，tag 缺失自动创建） |

  **Pages**

  | 工具 | 说明 |
  |---|---|
  | `github_pages_status` / `github_pages_build` | Pages 配置与构建状态 / 触发构建 |

  **Actions**

  | 工具 | 说明 |
  |---|---|
  | `github_workflows` | 工作流列表 |
  | `github_workflow_dispatch` | 触发 workflow_dispatch（支持 inputs） |
  | `github_workflow_runs` / `github_workflow_run` | 运行列表（可按状态过滤）/ 单次运行 |
  | `github_workflow_jobs` | 作业与步骤（失败诊断） |
  | `github_workflow_artifacts` / `github_artifact_download` | artifacts 列表 / 下载 zip |
  | `github_secrets` | 密钥**名称**列表（值永不暴露） |

  > 全部输出经 service 层投影 + 工具 schema 严格校验（additionalProperties: false），不会泄露 REST 原始字段。
- 权限闸门：`allowCreateRepo` / `allowPush` / `allowPull` / `allowPullRequest` / `allowReview` / `allowPages` / `allowActions` / `allowIssues` / `allowRelease`（Web 设置页可关）。推送 `.github/workflows` 文件需要 token 含 `workflow` scope（fine-grained PAT 需 Workflows 写入），设置页有提示。
- 刻意不提供：删除仓库/分支、force push、visibility 变更、webhook/secret 写入等任何危险操作。
- Web 设置页：token 写入/移除、连接测试、权限开关、git 身份、默认可见性。
- 单测：`git-utils`、`github-rest`（mock fetch + token 不回显）。

### 修复记录

- 2026-08-16 — **github_push/pull/clone 内部报错（Cordis inject）**：`GitHubService` 直接访问 `ctx.sandboxPolicy`，但插件级 inject 未声明该服务，Cordis 抛 `cannot get property "sandboxPolicy" without inject`（工具在跑 git 之前就失败）。改为 `ctx.get('sandboxPolicy')`（与内置 bash 工具一致）。
- 2026-08-16 — **REST 工具输出超 schema（dogfooding 发现）**：一批只读/写工具把完整 REST 对象透传给工具输出，严格 schema（`additionalProperties: false`）拒绝。已在 service 层统一投影（repo/tree/release/workflow/job/artifact/pages/identity/review）。
- 2026-08-16 — **`github_whoami` scopes 恒为空**：`X-OAuth-Scopes` 响应头从未解析；`fetchWhoami` 现在读取该头并合并进结果。
- 2026-08-16 — **`github_content` 目录条目 size**：REST 对 symlink/submodule 条目无 size 字段（undefined 触发 lossless JSON 拒绝）；schema 改为可选并在 execute 侧守卫。

### 待办

- 在装有 `@deepseek-ai/*` 依赖的环境跑 `pnpm install && pnpm test && pnpm build`。
- 联调 Typert Remote（host `ctx.typert.register` 与 client `$mount` 的 endpoint/wire 一致性）。
- Web e2e（Playwright）。
- 可选：`github_review` 行级 inline comments、Actions secrets 管理、OAuth device flow / GHES SSO、OIDC 云部署凭证。

