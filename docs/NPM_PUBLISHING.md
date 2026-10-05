# Staged publishing to npm

The public package is `@m407/opencode-mattermost-bot`, with the CLI `opencode-mattermost`.

`.github/workflows/publish.yml` runs on pushes to `main`, or manually through **Actions → Publish → Run workflow** with `main` selected. The job's ref guard also blocks manual runs on other branches. Stable versions (`X.Y.Z`) use `latest`; release candidates (`X.Y.Z-rc.N`) use `next`.

## Configure the stage-only token

The npm account must have publishing access to the `@m407` scope and 2FA enabled.

1. On npmjs.com, open **Access Tokens → Generate New Token** and create a granular token with **Read and write (stage only)** permission. Select only this package or its scope. For the first publication, select the `@m407` scope because the package does not yet exist. Organization management permissions alone do not grant package publishing access.
2. Leave **Bypass two-factor authentication** disabled. Staging does not require an OTP; approval does. Set a short expiry and rotate the token before it expires.
3. In GitHub repository `m407/opencode-mattermost-bot`, save it as repository Actions secret **NPM_TOKEN** under **Settings → Secrets and variables → Actions**. Never put the value in source, logs, issues, or chat.

The workflow uses Node.js's latest LTS and installs the latest npm 11. Staged publishing requires npm **11.15.0 or newer** and Node.js **22.14.0 or newer**. `actions/setup-node` configures registry authentication; only the stage inspection/upload steps receive `NODE_AUTH_TOKEN`.

This workflow deliberately uses a granular token for stage inspection, including retries. OIDC can upload stages but cannot list/review/approve them. If switching to OIDC later, redesign the stage inspection authentication as well; removing `NPM_TOKEN` is not sufficient.

## Prepare and stage a version

```sh
npm run release:prepare -- patch
# Or prepare a release candidate:
npm run release:rc
```

Review the changes to `package.json`, `package-lock.json`, and release notes, commit them, and merge into `main`. The workflow checks whether the exact version is public or already staged. Registry errors other than 404, invalid metadata, and stage-list authentication failures stop the run rather than being interpreted as permission to upload.

For a missing version, lint, typecheck, build, tests, runtime smoke test, and package inspection run before:

```sh
npm stage publish --access public --tag latest --provenance
# Release candidates use --tag next.
```

Public GitHub repositories use provenance; private repositories omit that flag. `repository.url` must identify `https://github.com/m407/opencode-mattermost-bot`. The package's `prepack` hook rebuilds `dist` before packing/staging. Staging succeeds without bypassing 2FA and does not make the actual version available to users. For a new package, npm creates a public placeholder `0.0.0-stage`.

A successful Actions upload means **waiting for approval**, not **published**. No release tag or GitHub Release is created at this point.

## Review and approve with 2FA

Sign in to npmjs.com, open **Staged Packages**, inspect the package/version, and choose **Approve**, completing the 2FA challenge. Alternatively use your own interactive npm session with npm >=11.15.0:

```sh
npm login
npm stage list @m407/opencode-mattermost-bot
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Approval prompts for 2FA. Do not store an OTP in GitHub secrets or try to approve with the CI token. Reject unwanted stages with `npm stage reject <stage-id>` (also requires 2FA).

After approval, verify the exact version and run **Actions → Publish → Run workflow** on `main` again. Keep the approved version in `main`'s `package.json` until finalization; the workflow processes the current version, not an arbitrary old release.

```sh
npm view @m407/opencode-mattermost-bot@0.26.3 version gitHead
```

When the exact version is publicly available, the workflow validates its `gitHead` against `main` history, reads release notes from that source commit, and creates the Git tag and GitHub Release for that commit. It repairs a missing GitHub Release even if the tag already exists. A tag pointing at another commit fails explicitly; it is never moved automatically.

## Retries and staging versus dist-tags

- An existing staged version is retained, and its stage ID is reported. Inspect its contents before approving; later commits are not automatically substituted. Reject and restage if the contents need correction.
- A pending version's dist-tag is immutable. A mismatched tag fails the workflow; reject the stage before uploading with a different tag.
- Already public versions skip stage credentials and uploads. Public npm versions cannot be overwritten: change the version for changed contents.
- `npm publish --tag staging` immediately publishes a public version with the dist-tag `staging`; it is not staged publishing. A stage-only token rejects direct `npm publish` with `E_STAGE_REQUIRED`.
- A stage-only token still has other write capabilities (including dist-tag changes and deprecation). Limit scope and lifetime and protect it accordingly.

## Installation

After approval and confirmed publication:

```sh
npm install --global @m407/opencode-mattermost-bot
opencode-mattermost config
opencode-mattermost start
```

Use `@m407/opencode-mattermost-bot@next` for release candidates.

## References

- [Staged publishing](https://docs.npmjs.com/staged-publishing)
- [Stage-only tokens](https://docs.npmjs.com/about-access-tokens#about-stage-only-tokens)
- [npm stage commands](https://docs.npmjs.com/cli/v11/commands/npm-stage)
