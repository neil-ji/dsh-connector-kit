# dsh-connector-kit 开源项目发布 SOP(从零到全自动)

> 本 SOP 由 dsh-connector-kit 真实发布过程提炼(2026-08,改名 + kit 化 + OIDC 自动化),含所有实测教训。
> 目标:把"一个 npm 包名想法"变成"打 tag 即全自动发布",人工只出现在绕不开的 2FA 环节。

---

## 总览

想法 → 命名 → 检查 → scaffold → 建仓/推送/Pages → 首次发布(2FA 人工) → OIDC trust(2FA 人工,一次性) → 打 tag 全自动

人工成本:**首次发布 + trust 各一次**(浏览器 2FA),之后打 tag 零人工。

---

## 阶段 0:准备

1. **命名决策**(改名前先定,改一次少一次):
   - 包家族:`dsh-connector-<域>`(host / -ui / -wire / -npm …)
   - 仓库名:通常与伞包同名(如 `dsh-connector-kit`)
   - 插件 id(运行时契约)一旦定,永不改(`ctx.github` / 工具注册 / composed tree 绑死)
2. **npm 包名可用性检查**:`npm_package_check` / `curl registry.npmjs.org/<name>`(404 = 可用)
3. **GitHub 仓库名可用性**:同名 repo 不存在即可

---

## 阶段 1:GitHub 侧(scaffold → 建仓 → push → Pages)

1. `npm_scaffold`:生成可发布的 TS 包(devDeps 必须含 typescript/esbuild/@types/node,否则 CI build 挂)
2. `github_repo_create`:建仓(开源项目默认 public,Pages 免费档要求 public)
3. `github_push`:git init + 初始提交
4. Pages 开启(build_type: workflow)—— push 的 `.github/workflows/{release,pages}.yml` 随之生效

---

## 阶段 2:首次发布(2FA 人工,绕不开)

### npm 2FA 现实(2025-11 起,实测)

- **Classic/Automation token 已死**:2025-11 禁创建、2025-12 吊销存量(免 OTP 的自动化 token 不存在了)
- **2FA 是浏览器会话认证**:命令触发后打开授权 URL,浏览器确认即完成(不是 6 位 TOTP 码,虽然配了 TOTP 也能用)
- **`npm publish` 支持 `--otp <码>`**(TOTP 模式可代跑)
- **`npm trust` 不支持 `--otp`**(实测被拒),必须交互执行

### 动作

- 首次发布 4 包(拓扑序 wire → ui → host → npm),浏览器 2FA 逐次确认
- **`npm publish` 前 package.json 必须有 `repository.url` 匹配仓库**(provenance 校验;npm auto-correct 会补 `git+` 前缀)

---

## 阶段 3:OIDC trust(2FA 人工,一次性 = 自动化解锁点)

### 关键教训(E404 实测)

    POST /-/package/<name>/trust → 404 = 包不存在!

**trust 要求包已存在** → 顺序必须是:先发布,再 trust。

### 动作

    npm trust github <pkg> --file release.yml --repository <owner>/<repo> --allow-publish -y   # 每包一次,浏览器 2FA

- trust 配好后,**CI 打 tag 发布免 2FA**(OIDC 换发短期 registry token)
- 4 条 trust 封装成一个脚本(如 `release-kit.sh`)让人跑一次

---

## 阶段 4:tag → CI 全自动

    git tag vX.Y.Z
    git push origin vX.Y.Z        # 触发 release.yml
    # CI 自动:对齐版本 → build → typecheck → test → npm publish ×N(OIDC,免 2FA)→ Pages

---

## 阶段 5:改名 SOP(本会话实战)

GitHub 与 npm 的"改名"完全不同:

| 层 | 改名机制 | 注意 |
|---|---|---|
| **GitHub 仓库** | `PATCH /repos/{owner}/{repo} {"name": …}` | 同一对象改名:history/issues/PRs/tags/CI 全继承;旧 URL **301 自动跳转**;Pages URL 随之变 |
| **npm 包** | **无真 rename** = 旧名 deprecate + 新名 publish | 旧名永久挂 registry(deprecated);改名要一次性做对 |
| **OIDC trust** | 按包名绑定,**改名后必须对新名重配 trust** | `npm trust github <新名>` |
| **插件 id / 别名** | 永不改 | `github` / `github-ui` / `npm`;`dsh-github` 别名可保留 |

### 改名流程

1. 全仓库批量替换包名(最长前缀优先:wire → ui → host,避免子串误伤)
2. 改 `package.json` name + 交叉依赖 + `repository.url` + workflows(`-w` 包名)+ README/site
3. 仓库改名(GitHub API),本地 `git remote set-url`
4. 新名 publish(2FA)+ deprecate 旧名(2FA,指向新名)
5. 新名重配 trust(2FA)
6. 打新 tag 验证 CI 链路(注意:**旧 tag 会随仓库继承**,新 tag 版本号要避开,如旧有 v0.1.1 → 用 v0.1.2)

---

## 实测教训清单(避坑)

1. **trust 要求包已存在**(E404 于 POST /trust)—— 先发布再 trust
2. **npm 2FA 浏览器会话,无 automation token**(2025-11/12 收紧)
3. **`npm trust` 无 `--otp`**,只能交互;publish/deprecate 有 `--otp`
4. **首次发布人工不可避免**(2FA);之后全靠 OIDC 自动化
5. **仓库改名继承旧 tag/CI 历史** → 版本号递增避开冲突
6. **npm publish 需 repository.url 匹配**(provenance 422 教训)
7. **devDeps 必须含 typescript/esbuild**(scaffold 生成包 CI build 才过)
8. **`nodeLinker: hoisted` 会把插件 devDeps 的 `@deepseek-ai/*` hoist 到 profile 根** → shadow 全局单拷贝 → Symbol 错位 → 工具崩(用 `isolated` + peer-only 声明规避)
