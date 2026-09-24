# Repository and deployment workflow

- `/home/leona/projects/hermes-dashboard` on `sato-agents-vm` is the live
  deployment checkout. Keep it on clean `main`; use a separate Git worktree
  for feature work. Do not switch the live checkout to a feature branch.
- Push changes on a branch and open a pull request. The owner merges PRs;
  do not commit directly to or merge into `main` without an explicit request.
- Fetch before interpreting ahead/behind counts. Confirm exclusive commits
  with `git log origin/main..HEAD`; an old remote-tracking ref is not evidence
  of unpublished changes. Preserve any actual local work.
- The no-agent updater is `tools/update_dashboard.sh`, installed as
  `~/.hermes/scripts/update-dashboard.sh`. It fetches public main without a
  GitHub token and restarts the service only after a safe fast-forward.
- For GitHub writes, check `gh auth status` and repository access. On the VM,
  `gh` is authenticated using the existing Hermes credential. MCP/environment
  authentication and CLI authentication are distinct. Never print credentials
  or ask the owner to paste a token into chat.
