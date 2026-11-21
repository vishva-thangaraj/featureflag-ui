# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Deploying

`main` deploys to https://featureflag.npexception.in through [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
lint, test and build on every push and pull request, then on `main` the `deploy` job uploads `dist/` to S3
and asks the instance, through AWS SSM, to switch to it. The UI is served by the API's nginx on the same
origin, so the client needs no API URL: it calls `/api/...` on whatever host served it. The server side is
in the platform repository: `deploy/README.md`, section "Dashboard".

Roll back by running the workflow by hand (Actions → CI → Run workflow) with `release` set to an earlier
short SHA; each deploy prints the one before it. By hand from a machine with credentials for the deploy role:

```bash
AWS_REGION=ap-south-2 UI_ARTIFACT_BUCKET=<bucket> EC2_INSTANCE_ID=<i-...> scripts/deploy.sh --switch <release>
```
