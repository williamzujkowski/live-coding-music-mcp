# Contributing

Thanks for considering a contribution. This is an open-source fan project that drives [strudel.cc](https://strudel.cc) from Claude. PRs of any size are welcome — bug fixes, docs, tests, new tools.

The development workflow, code standards, and release process live in **[DEVELOPMENT.md](DEVELOPMENT.md)**. The high-level system design is in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Ways to help

- **Report bugs.** Include repro steps, OS, Node version, and what you saw vs. what you expected.
- **Improve docs.** Typos, unclear sections, missing examples — small PRs welcome without an issue.
- **Add tests.** Coverage is ~86% statement / ~76% branch; gaps are tracked as `testing`-labelled issues.
- **Fix issues.** Look for [`good first issue`](https://github.com/williamzujkowski/live-coding-music-mcp/labels/good%20first%20issue) or [`help wanted`](https://github.com/williamzujkowski/live-coding-music-mcp/labels/help%20wanted).
- **Add features.** New tools, new music-theory helpers, new genre templates.

## Before substantive work

For anything beyond a typo or single-function fix, open a GitHub issue first. The issue policy is in [CLAUDE.md](CLAUDE.md#github-issues-workflow). In short:

- Required for: features >50 LOC, architecture changes, new dependencies, breaking changes, multi-file refactors, performance work, security fixes.
- Optional for: typos, comments, single-function bug fixes (<20 LOC), test additions.

Issues need a category label (`bug`, `feature`, `enhancement`, `testing`, `docs`, `refactor`, `performance`, `security`) and a priority (`critical`, `high`, `medium`, `low`).

## PR flow

1. Fork and clone:
   ```bash
   git clone https://github.com/YOUR_USERNAME/live-coding-music-mcp.git
   ```
2. Branch off `main`:
   ```bash
   git checkout -b feat/my-feature   # or fix/, docs/, refactor/, perf/, chore/, test/
   ```
3. Make your changes. Add tests. Make sure:
   - `npm test` passes
   - `npm run lint` is clean (0 errors — it's blocking in CI)
   - `npm run build` regenerates the README tool table if you touched any tool definition
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `refactor:` no behavior change
   - `test:` tests only
   - `perf:` performance
   - `chore:` maintenance

   Reference the related issue: `Closes #N` in the body, or in the PR description if you have multiple commits.
5. Push and open a PR. CI runs `build (22.x)`; that check must pass before merge.

## What we look for in review

- Correctness — does it do what the description says
- Tests — new code has tests; bug fixes have a regression test
- Tone — see [CLAUDE.md](CLAUDE.md#tone-and-style-guidelines) for the doc/comment tone; no marketing language, technical accuracy over everything
- No exaggeration in docs — if test coverage is 86%, the doc says 86%, not "comprehensive testing"
- Small, focused changes — one concern per PR makes review faster

## Discussions and questions

Open a [GitHub Discussion](https://github.com/williamzujkowski/live-coding-music-mcp/discussions) for use cases, design questions, or anything that isn't a bug or feature request.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
