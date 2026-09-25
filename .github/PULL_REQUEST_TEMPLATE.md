## What changes for a user

<!-- Behaviour, its boundaries, and how outcomes are reported. -->

## How it was validated

<!-- Commands run and what they showed: npm run check, npm run test:browser, mix precommit. -->

## Checklist

- [ ] `npm run check` passes; `npm run test:browser` was run for browser, storage, transport or ownership changes
- [ ] `mix precommit` passes in `packages/phoenix` if it changed
- [ ] `docs/status.md` and the relevant `CHANGELOG.md` `[Unreleased]` section are updated
- [ ] No tokens, customer artifacts or private URLs in the diff or this description
- [ ] Uncertain mutations are still never replayed automatically
