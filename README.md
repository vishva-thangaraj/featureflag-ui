# Feature flag dashboard

The web console for the [feature flag platform](https://gitlab.com/featureflag/platform): create flags,
turn them on per environment, target them, issue SDK keys and manage who can change what.

Live at **https://featureflag.npexception.in**.

**It is a console for one job: changing what end users see, safely.** The flags list for one
environment is the home screen. Every flag screen is read through exactly one environment, chosen in
the page header and carried in the URL, and friction scales with blast radius: a change in development
is instant, a change in a protected environment asks first, and deleting the organization asks you to
type its name. [UI_PLAN.md](UI_PLAN.md) has the full reasoning.

---

## Stack

| | |
|---|---|
| UI | React 19, TypeScript, React Router 7, Tailwind CSS 4, shadcn/ui on Radix |
| Data | TanStack Query 5 over `openapi-fetch`, typed from the platform's OpenAPI document |
| Forms | React Hook Form with Zod |
| Tooling | Vite, Oxlint, Vitest with Testing Library and jsdom |

## Running it

The dashboard needs the platform's API on `localhost:8080`; its README covers starting the dev stack.
Then, with Node 22:

```bash
npm install
npm run dev
```

Open http://localhost:5173 and register. Vite proxies `/api` to `localhost:8080`, so the browser
sees one origin, exactly as in production. Invitation emails land in the dev stack's Mailpit at
http://localhost:8025.

| Command | |
|---|---|
| `npm run dev` | Vite on `:5173`, `/api` proxied to the platform |
| `npm test` | Vitest, once. No backend needed: tests stub `fetch` (see `src/test/fakes.ts`) |
| `npm run lint` | Oxlint |
| `npm run build` | Type-check with `tsc -b`, then build to `dist/` |
| `npm run preview` | Serve `dist/` locally |

---

## How the session works

The platform issues a 15-minute access token and a 7-day refresh token. The dashboard keeps them
apart:

- **The access token lives in memory only**, in `src/auth/session.ts`. Nothing is persisted for an
  injected script to read later, so a page load starts signed out and restores the session from the
  refresh cookie.
- **The refresh token is an `HttpOnly` cookie**, asked for with `X-Refresh-Transport: cookie` and
  scoped to `/api/v1/auth`. Script never sees it.
- **A `401` triggers one refresh and one retry** of the original request (`src/api/client.ts`).
- **Refreshes are serialized across tabs.** Refresh tokens are single-use, and the server treats a
  reused one as stolen and revokes the whole chain, so two tabs refreshing at once would sign the user
  out everywhere. Every refresh runs under a `navigator.locks` lock shared by the origin's tabs, and
  the new token is broadcast over a `BroadcastChannel`, so a tab that waited usually skips the call.

Roles decide what the dashboard offers (`src/tenant/permissions.ts`): `OWNER` and `ADMIN` can change
flags, environments, keys and members; only `OWNER` can rename or delete the organization. The server
still decides. A role changed since the page loaded gets its `403`, and the refetch that follows
corrects what is offered.

## API types

`src/api/schema.d.ts` is generated from a running backend, not written by hand. After the platform's
API changes, regenerate it against a backend on the `dev` or `docker` profile (the document is not
served on the others):

```bash
npx openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.d.ts
npm run build
```

A request or response that no longer matches the backend now fails `tsc` instead of failing in the
browser. IDs are strings in the document, because they are past the 2⁵³ where a JavaScript `Number`
stops being exact, so they are strings in the types too: treat them as opaque.

---

## Layout

```
src/
  api/          openapi-fetch client, generated schema, error mapping
  auth/         session and refresh lock, sign-in, registration, invitations
  app/          routes and the query client
  tenant/       organization picker and creation, tenant layout, role checks
  features/     one folder per screen (flags, environments, api-keys, members, settings),
                plus first-run, the setup checklist
  components/   shared UI: shadcn/ui primitives, form fields, app shell
  hooks/ lib/   small helpers
  test/         fetch fakes shared by the tests
```

## Deploying

The platform's nginx serves the built `dist/` on its own hostname and proxies `/api/` straight to the
app, so the dashboard and the API share one origin. The client needs no API URL: it calls `/api/...`
on whatever host served it, and the refresh cookie stays `SameSite=Strict` with no CORS configuration.

```
push to main ──► lint, test, build ──► dist → s3://<bucket>/ui/<sha>.tar.gz
                                                     │
                                              SSM Send-Command
                                                     ▼
                                       /opt/platform/deploy-ui.sh <sha>
                                  unpack to ui/releases/<sha>, switch ui/current
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) checks every push and pull request and deploys
`main`. It assumes an AWS role through GitHub's OIDC token, so no AWS keys are stored in the
repository. A release switch is a symlink rename: no nginx reload, and the API is never touched.

Roll back by running the workflow by hand (Actions → CI → Run workflow) with `release` set to an
earlier short SHA; each deploy prints the one before it. The workflow runs `scripts/deploy.sh`, which
works the same way by hand from a machine with credentials for the deploy role:

```bash
AWS_REGION=ap-south-2 UI_ARTIFACT_BUCKET=<bucket> EC2_INSTANCE_ID=<i-...> scripts/deploy.sh --switch <release>
```

Without `--switch`, after `npm run build`, the script uploads `dist/` as a new release and switches to
it.

The server side (nginx block, certificate, `deploy-ui.sh`, the CI role) is documented in the
platform's [deploy/README.md](https://gitlab.com/featureflag/platform/-/blob/main/deploy/README.md#dashboard).
