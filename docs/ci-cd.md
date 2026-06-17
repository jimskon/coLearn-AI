# CI/CD Plan
# James Skon

This repository now has a first-pass GitHub Actions CI workflow in `.github/workflows/ci.yml`.

## Current CI gates

- Server: installs `server/` dependencies and runs `npm run test:ci`.
- Client: installs `client/` dependencies with `npm ci` and runs the production Vite build through `npm run test:ci`.
- End-to-end: present as an opt-in scaffold. It runs only when manually requested with the workflow input or when the repository variable `RUN_E2E` is set to `true`.

## Runner setup

The workflow defaults to `ubuntu-latest`. When a self-hosted runner is ready, add a repository variable named `CI_RUNNER` with the runner label, for example `self-hosted`.

Use a self-hosted runner when the test suite needs local services, larger build caches, private network access, or long-running browser tests.

## Next steps

1. Add real server unit and integration tests, then keep `server/package.json` pointed at that test suite.
2. Add a frontend test runner, such as Vitest and React Testing Library, and update `client/package.json` so `test:ci` runs both tests and `vite build`.
3. Add Playwright or Cypress for end-to-end tests and expose it through an `e2e` npm script.
4. Add CD as a separate workflow after CI is stable. The deployment job should depend on passing CI, build the client, install server dependencies, and restart the production process manager.
