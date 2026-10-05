# Publishing to npm

The public package is `@m407/opencode-mattermost-bot`, with the CLI `opencode-mattermost`.

`.github/workflows/publish.yml` runs on pushes to `main`, or manually through **Actions → Publish → Run workflow** with `main` selected. Other branches cannot publish. Stable versions (`X.Y.Z`) use the `latest` npm tag; release candidates (`X.Y.Z-rc.N`) use `next`.

## First publication

The npm account must own or have publishing access to the `@m407` scope. For the first publication of a package that does not yet exist on npm:

1. Create an npm granular access token with write access to the scope/package and permission to bypass 2FA for automated publishing. Use a short expiry and the narrowest permissions available.
2. In `m407/opencode-telegram-bot`, add that token as the GitHub Actions repository secret **NPM_TOKEN** under **Settings → Secrets and variables → Actions**. Never commit it to the repository.
3. Merge the workflow changes and run **Publish** on `main` if the push-triggered run has not already published the package.

The workflow publishes publicly to `https://registry.npmjs.org/`. A public GitHub repository also produces npm provenance. The package's `prepack` hook builds `dist` before packing or publishing, including when publishing manually.

## Subsequent publications without an npm token

After the package exists, open its npm **Settings → Trusted publishing** and add GitHub Actions with these values:

| Field                | Value                                           |
| -------------------- | ----------------------------------------------- |
| Organization or user | `m407`                                          |
| Repository           | `opencode-telegram-bot`                         |
| Workflow filename    | `publish.yml`                                   |
| Environment          | Leave empty (the job has no GitHub environment) |

The workflow uses a GitHub-hosted runner, Node.js 24, npm 11 with OIDC support, and `id-token: write`. Once Trusted Publishing is configured, remove the GitHub `NPM_TOKEN` secret and revoke the bootstrap token in npm. npm will authenticate through GitHub OIDC.

## Releasing a version

```sh
npm run release:prepare -- patch
# Or prepare a release candidate:
npm run release:rc
```

Review the version changes in `package.json` and `package-lock.json`, and the generated notes for stable releases. Commit them and merge into `main`. The workflow runs lint, type checking, build, tests and the compiled runtime smoke test before publishing. It also checks the package contents with `npm pack --dry-run`.

Publishing is determined by whether that exact package version exists in npm, independently of Git tags. An existing Git tag cannot block a missing npm version, and an already published npm version is skipped on retries. Registry errors other than 404 fail the job instead of being treated as a missing package. Missing Git tags/releases are created after successful publication (or when the version already exists in npm).

If publication succeeds but a later step fails, rerun the workflow. If the Git tag was already pushed but GitHub release creation failed, create the GitHub release for that tag manually. Published npm versions cannot be overwritten: use a new version for changed package contents.

## Installation

After the first successful publication:

```sh
npm install --global @m407/opencode-mattermost-bot
opencode-mattermost config
opencode-mattermost start
```

Use `@m407/opencode-mattermost-bot@next` to install a release candidate.
