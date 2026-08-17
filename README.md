# dsh-connector-kit

> 第三方 DeepSeek Harness（DSH）连接器套件：为 DSH 接入 **GitHub 自动化**（建仓 / 推送 / PR / 审查 / Actions / Pages 等 40 个工具）+ **npm 一键发布管线**（7 个工具，scaffold → 建仓 → OIDC release → Pages），两套连接器都有 **Web 设置页 UI**（GitHub 连接配置 + npm 发布状态/launch 向导）。**不改 dsh 源码**，通过官方 bundle/profile 机制安装。

[![Docs](https://img.shields.io/badge/📖%20Pages-在线文档-4f8cff)](https://neil-ji.github.io/dsh-connector-kit/)
[![npm](https://img.shields.io/npm/v/dsh-connector-github?label=npm)](https://www.npmjs.com/package/dsh-connector-github)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**快速入口**：功能落地页 <https://neil-ji.github.io/dsh-connector-kit/> · 官方文档 <https://neil-ji.github.io/dsh-connector-kit/docs/> · 发布 SOP [`docs/SOP.md`](docs/SOP.md) · 设计文档 [`DESIGN.md`](DESIGN.md)

---

## 目录

- [快速开始](#快速开始)
- [安装](#安装)
- [包结构](#包结构)
- [工具参考（GitHub 40 + npm 7）](#工具参考github-40--npm-7)
- [npm 一键发布（SOP）](#npm-一键发布sop)
- [网络与代理](#网络与代理)
- [架构要点](#架构要点)
- [安全设计](#安全设计)
- [发布 / CICD](#发布--cicd)
- [开发](#开发)
- [隔离验证（dogfooding）](#隔离验证dogfooding)
- [FAQ](#faq)
- [当前状态 / 路线图](#当前状态--路线图)

---

## 快速开始

```sh
# 1. 安装插件（npm 发布产物，无需 build 授权）
dsh plugin --profile <name> add dsh-connector-github

# 2. 重启 dsh，在 Web 设置页（设置 → GitHub 连接）粘贴 GitHub PAT
#    （需 repo + workflow scope；值只写不回读，存 ~/.dsh/.credentials.yaml）

# 3. 让 Agent 直接使用 github_* / npm_* 工具
```

## 安装

| 方式 | 命令 | 说明 |
|---|---|---|
| **npm（推荐）** | `dsh plugin --profile <name> add dsh-connector-github` | 发布产物，无需 build 授权 |
| git / 源码 | `dsh plugin --profile <name> add github:neil-ji/dsh-connector-kit#<sha>` | 拉源码构建；pnpm ≥10 需放行 build 脚本 |
| 本地构建 | `pnpm -r build && dsh plugin --profile <name> add file:./packages/dsh-github` | 必须 `file:` 前缀（`link:` 不装子依赖） |

> **git 安装放行**：在 profile 的 `pnpm-workspace.yaml` 添加
>
> ```yaml
> allowBuilds:
>   dsh-connector-github: true
>   dsh-connector-github-ui: true
>   dsh-connector-wire: true
> ```

## 包结构（树外四包）

| 包 | 角色 | 关键声明 |
|---|---|---|
| `dsh-connector-github`（源码目录 `dsh-github`） | bundle + host 面插件，npm 包 | `dsh.bundle.patch` + `cordis.patch.yml` |
| `dsh-connector-github-ui`（源码目录 `dsh-github-ui`） | client 面插件（设置页），npm 包 | `dsh.client` + `exports["./client"]` |
| `dsh-connector-wire`（源码目录 `dsh-github-wire`） | 共享 wire 契约（zod + strict Typert descriptors），npm 包 | 被 host/client 同时依赖 |
| `dsh-connector-npm-wire`（源码目录 `dsh-npm-wire`） | npm 连接器 wire 契约（状态/脚本生成 Remote），npm 包 | 被 dsh-npm / dsh-npm-ui 同时依赖 |
| `dsh-connector-npm`（源码目录 `dsh-npm`） | npm 一键发布 bundle（host 面），npm 包 | `dsh.bundle.patch`，复用 `ctx.github` |
| `dsh-connector-npm-ui`（源码目录 `dsh-npm-ui`） | npm 发布状态面板 + launch 向导（client 面），npm 包 | `dsh.client` + `exports["./client"]` |

> npm 包名用 `dsh-connector-*` 系列（`dsh-github` 在 npm 已被占用）；仓库名 `dsh-connector-kit`；运行时插件标识仍为 `dsh-github` / `github-ui` / `npm`，不影响已安装配置。

## 工具参考（GitHub 40 + npm 7）

全部输出经 service 层投影 + 工具 schema 严格校验（`additionalProperties: false`），不会泄露 REST 原始字段。

### GitHub（40 个）

**仓库 / 身份（7）**

| 工具 | 说明 |
|---|---|
| `github_whoami` | 认证身份 + token scopes（classic PAT） |
| `github_repo_get` | 仓库元数据（描述、默认分支、star 等） |
| `github_repo_create` | 创建远程仓库（owner/repo 名被拒绝） |
| `github_repo_edit` | 改安全元数据（描述/homepage/topics/开关） |
| `github_user_repos` | 列出当前账号可访问的仓库 |
| `github_search_repos` | 搜索仓库 |
| `github_fork` | fork 到自己的账号 |

**内容（6）**

| 工具 | 说明 |
|---|---|
| `github_content` | 读文件（UTF-8 解码）或列目录 |
| `github_repo_tree` | 递归文件树（带 sha） |
| `github_readme` | 读 README |
| `github_file_write` | Contents API 单文件提交 |
| `github_commits` | 提交列表（可按路径/分支过滤） |
| `github_commit_get` | 单提交 + 变更文件 patch |

**分支 / 标签（3）**

| 工具 | 说明 |
|---|---|
| `github_branches` / `github_branch_get` | 分支列表 / 分支保护规则 |
| `github_tags` | 标签列表 |

**git 操作（3，走 ctx.shell + 会话沙箱策略 + 可选 gitProxy）**

| 工具 | 说明 |
|---|---|
| `github_clone` | clone 到本地（配合 fork→改→推→PR 流程） |
| `github_pull` | pull |
| `github_push` | add/commit/set-url/push（origin 推断，**永不 force**） |

**PR / 审查（5）**

| 工具 | 说明 |
|---|---|
| `github_pr` / `github_pr_list` / `github_pr_get` | 创建 / 列表 / 读取 PR |
| `github_review` | 提交 review（APPROVE / REQUEST_CHANGES / COMMENT） |
| `github_review_list` | PR 变更文件 + 已有评论 |

**Issue（4）**

| 工具 | 说明 |
|---|---|
| `github_issue_create` / `github_issues` / `github_issue_get` | 创建 / 列表 / 读取（PR 也出现） |
| `github_issue_comment` | 评论 issue/PR |

**Release（2）**

| 工具 | 说明 |
|---|---|
| `github_releases` / `github_release_create` | 列表 / 创建（支持 draft/prerelease，tag 缺失自动创建） |

**Pages（2）**

| 工具 | 说明 |
|---|---|
| `github_pages_status` / `github_pages_build` | Pages 配置与构建状态 / 触发构建 |

**Actions（8）**

| 工具 | 说明 |
|---|---|
| `github_workflows` | 工作流列表 |
| `github_workflow_dispatch` | 触发 workflow_dispatch（支持 inputs） |
| `github_workflow_runs` / `github_workflow_run` | 运行列表（可按状态过滤）/ 单次运行 |
| `github_workflow_jobs` | 作业与步骤（失败诊断） |
| `github_workflow_artifacts` / `github_artifact_download` | artifacts 列表 / 下载 zip |
| `github_secrets` | 密钥**名称**列表（值永不暴露） |

### npm（7 个）

| 工具 | 说明 |
|---|---|
| `npm_package_check` | 检查 npm 包名可用性与元数据（免凭证） |
| `npm_scaffold` | 生成可发布的 TS 包：package.json、tsconfig、esbuild、README/LICENSE、OIDC release 工作流 + Pages 站点（不触碰 GitHub/npm） |
| `npm_trust_add` | 配置 OIDC trusted publishing（npm ≥ 11.10）；2FA 写入模式下返回命令到终端执行 |
| `npm_launch` | 两阶段 SOP：stage `launch` 走完 scaffold→建仓→push→Pages 并返回人工 2FA 脚本；stage `tag` 打 v<next> tag 触发 CI OIDC 发布 |
| `npm_first_publish` | 生成首次发布人工脚本（`npm publish` + `npm trust`，浏览器 2FA） |
| `npm_deprecate` | 生成旧包名 deprecate 命令（改名 SOP） |
| `npm_trust_status` | 报告包是否已发布 + trust 状态核实链接 |

## npm 一键发布（SOP）

把「一个 npm 包名想法」变成「打 tag 即全自动发布」，人工只出现在绕不开的 2FA 环节：

1. **`npm_launch`（stage: `launch`）**：校验包名 → scaffold 可发布 TS 包 → `github_repo_create` 建仓 → 推初始提交 → 开启 Pages，返回人工脚本；
2. **人工执行 2FA 脚本（一次性）**：首次 `npm publish` + `npm trust`（浏览器会话 2FA，Agent 无法代跑）；
3. **`npm_launch`（stage: `tag`）**：打 `v<next>` tag → CI 经 OIDC trusted publishing **免 2FA** 全自动发布并部署 Pages。

> 完整 SOP（含命名、改名、2FA 现实、避坑清单）见 [`docs/SOP.md`](docs/SOP.md)。

## 网络与代理

- git push/pull 走 HTTPS + token；本机如遇 github.com 直连受限，配置 `gitProxy` 指向本地代理：

  ```yaml
  gitProxy: http://127.0.0.1:7897   # 支持 http/https/socks；设置页可配，留空直连（不覆盖用户全局 git 代理配置）
  ```

- 设置页内置「测试代理」（`github/proxy.test`），用 `git ls-remote` 验证与 push 完全相同的 HTTPS 路径。
- **SSH-over-443**（`ssh://git@ssh.github.com:443/<owner>/<repo>.git`）可作为兜底出口，多数受限网络下比 HTTPS 代理更可靠。

## 架构要点

- **token**：走 `ctx.credentials`（credential-ref `GITHUB_TOKEN`），值只存 `$DSH_HOME/.credentials.yaml`，Web 只写不回读。
- **git 认证**：per-run env + 内联 credential helper（token 不进 argv / remote URL / `.git/config`）。
- **配置**：`ctx.settings.register('github', …)` 本地持久化；Web 读写走自定义 Typert Remote（绕开 apiproxy settings 白名单）。
- **Typert 手写契约**：generator 未随 dsh 分发，因此 `dsh-github-wire` 手写 strict `InvocationDescriptor[]`；host 侧 `ctx.typert.register`，client 侧 `ctx.remote.$mount`，两端共享同一份 descriptor 不漂移。
- **危险操作零入口**：删除仓库/分支不提供；push 无 `--force`。

## 安全设计

- **token 隔离**：只存在于 `ctx.credentials` 与请求头 / per-run 环境，Web 设置页只写不回读。
- **git 认证**：内联 credential helper，token 不进 argv / remote URL / `.git/config`。
- **权限闸门**：九个 `allow*` 开关（CreateRepo / Push / Pull / PullRequest / Review / Pages / Actions / Issues / Release）可在设置页逐项关闭。
- **危险操作零入口**：不提供删除仓库/分支/文件、force push、visibility 变更、webhook/secret 值写入；破坏性操作请在 GitHub Web/CLI 处理。

## 发布 / CICD

打 tag 即自动发布 npm 并更新 GitHub Pages（功能落地页 + 官方文档页）：

```sh
git tag vX.Y.Z
git push origin vX.Y.Z   # 触发 .github/workflows/release.yml
```

工作流依次执行：对齐四包版本（tag 为准）→ typecheck → build → test → npm 发布（wire → ui → host → npm 拓扑序，OIDC trusted publishing）→ 版本号注入构建 `site/` → 部署 Pages。`main` 上 `site/**` 变更会触发 `pages.yml` 直接预览更新（不发布 npm）。

**前置条件（一次性）**

1. **npm 首次发布**：本地用 npm 账号手动 publish 六个包各一次（`dsh-connector-wire` → `dsh-connector-npm-wire` → `dsh-connector-github-ui` → `dsh-connector-npm-ui` → `dsh-connector-github` → `dsh-connector-npm`），建立包名记录；后续新版本由 CI 自动发布；
2. 仓库 **Settings → Secrets → Actions** 新建 `NPM_TOKEN`（npmjs.com → Access Tokens → Generate New Token → Automation）；
3. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

**站点结构**（`site/`）：`landing/index.html` 为功能落地页（部署在站点根 `/`），`docs/index.html` 为官方文档（`/docs/`），两页互相导航；版本号占位符 `__DSH_VERSION__` 在构建时替换为 tag 版本。

**Trusted publisher 批量配置（npm ≥ 11.10）**：新增 npm 包或重配信任关系时，一条命令搞定（需 npm 登录态 + 2FA OTP；先 `--dry-run` 验证）：

```sh
npm trust github dsh-connector-wire --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
npm trust github dsh-connector-npm-wire    --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
npm trust github dsh-connector-github-ui   --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
npm trust github dsh-connector-npm-ui      --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
npm trust github dsh-connector-github      --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
npm trust github dsh-connector-npm         --file release.yml --repository neil-ji/dsh-connector-kit --allow-publish -y
```

## 开发

```sh
pnpm install
pnpm test          # 纯函数单测（不依赖 @deepseek-ai 运行时）
pnpm build
pnpm typecheck
```

依赖 `@deepseek-ai/*` 当前 `0.1.0-rc.5`（pre-release），以 npm 实际发布版本为准。client bundle 的 external 清单与 `window.__ModuleLoader__.load` 契约见 `packages/dsh-github-ui/tsdown.config.ts`。

## 隔离验证（dogfooding）

```sh
# 3080 是你正在用的工作实例，不要动它。用独立端口验证：
pnpm -r build
dsh plugin --profile web remove dsh-github && dsh plugin --profile web add file:./packages/dsh-github
dsh --profile web --port 3999    # 独立进程/端口，同 profile 共享数据
# 服务端冒烟：curl /plugins/dsh-github-ui/client.js + POST /api github/whoami
```

## FAQ

**为什么 npm 包名不是 dsh-github？**

npm 上 `dsh-github` 已被占用（kazii 的另一项目）。本套件以 `dsh-connector-*` 系列发布（仓库 `dsh-connector-kit`）；运行时插件标识仍为 `dsh-github` / `github-ui` / `npm`，不影响已安装配置。

**push 失败 / Connection reset？**

多为网络问题：确认 `gitProxy` 可达（设置页「测试代理」），或换 SSH-over-443 兜底。

**npm trust 报 404？**

trust 要求包已存在——顺序必须是先 publish 再 trust（`POST /-/package/<name>/trust` 404 = 包不存在）。

**如何删除仓库 / 分支 / 文件？**

插件刻意不提供任何破坏性操作，请在 GitHub Web / CLI 处理。

## 当前状态 / 路线图

### 已实现

- host 面 `ctx.github`（GitHubService extends TypertRemoteService）：REST + git（push/pull）。
- 47 个 Agent 工具：**GitHub 40 + npm 7**（完整清单见 [工具参考](#工具参考github-40--npm-7)）。
- Web UI：**GitHub 设置页**（token/权限/代理，`dsh-connector-github-ui`）+ **npm 发布状态页**（注册表与四包状态、包名检查、trust 查询、首次发布脚本生成，`dsh-connector-npm-ui`）。
- 权限闸门：九个 `allow*` 开关（Web 设置页可关）。
- 刻意不提供：删除仓库/分支、force push、visibility 变更、webhook/secret 写入等任何危险操作。
- Web 设置页：token 写入/移除、连接测试、权限开关、git 身份、默认可见性、gitProxy。
- 单测：`git-utils`、`github-rest`（mock fetch + token 不回显）、npm scaffold/launch。

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