# PackageFlow Scanner — Codex agent instructions

## Shared Codex workflow

Use `zhchok/engineering-playbook/START_HERE.md` and `docs/CODEX_AUTOMATIC_BOOTSTRAP.md` as the cross-project engineering baseline, with `zhchok/project-contexts` for project/role routing when needed.

At the start of a new session, recover the actual repo/branch/worktree and only relevant project context. For later tasks in the same session, reuse verified context and refresh only changes. Do not repeat full bootstrap, broad audits or completed tests without a concrete reason. Product authority, owner permissions and safety constraints prevail. This guidance does not authorize release, deployment, credentials, elevated execution or external effects.

Follow `README.md` release policy: `develop` is for DEV Mini App verification; `main` is approved production; promote only with explicit approval. Maintain the paired API contract in `zhchok/packageflow-bot`, verified Telegram identity, camera privacy and event idempotency.

Never deploy a development build to production by inference or use browser client code to expose tokens or customer data.
