/** Wire-safe business types for the GitHub connector. */

/** GitHub REST /user projection. */
export interface GithubUser {
  login: string
  name: string | null
  html_url: string
  scopes?: string[]
}

/** GitHub REST repository projection. */
export interface GithubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  clone_url: string
  ssh_url: string
}

/** GitHub REST pull-request projection (subset). */
export interface GithubPullRequest {
  number: number
  title: string
  state: string
  html_url: string
  head: { ref: string }
  base: { ref: string }
}

/** Agent-facing create-repository request. */
export interface CreateRepoRequest {
  name: string
  description?: string
  visibility?: 'private' | 'public'
}

/** Agent-facing create-repository result. */
export interface CreateRepoResult {
  fullName: string
  htmlUrl: string
  cloneUrl: string
  sshUrl: string
}

/** Agent-facing create-PR request. */
export interface CreatePullRequest {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body?: string
}

/** Agent-facing review request. */
export interface CreateReviewRequest {
  owner: string
  repo: string
  pullNumber: number
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body?: string
}

/** One pull-request review comment (GitHub REST projection). */
export interface GithubPullComment {
  id: number
  path: string
  body: string
  user: { login: string }
  created_at: string
}

/** One file changed in a pull request (GitHub REST projection). */
export interface GithubPullFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

/** List pull requests for a repository. */
export interface ListPullsRequest {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
}

/** Read one pull request. */
export interface GetPullRequest {
  owner: string
  repo: string
  number: number
}

/** Wire value returned by the github/whoami Remote method. */
export interface GithubWhoamiValue {
  login: string
  name: string | null
  htmlUrl: string
  scopes: string[]
  apiBase: string
}
