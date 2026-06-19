# CLAUDE.md

## Development Principles
- Inspect the existing codebase before making changes.
- Follow the current project structure and conventions.
- Make the smallest safe change that solves the task.
- Do not rewrite unrelated code without instruction.
- Prefer readable, maintainable code over clever shortcuts.
- For large or multi-file changes, explain the plan before editing.
- If requirements are ambiguous, choose the safest MVP-friendly approach.

## Code Quality
- Use explicit types where the project language supports them.
- Keep functions small and focused on one responsibility.
- Avoid duplicating logic; extract reusable utilities when appropriate.
- Remove unused imports, dead code, and temporary debug logs.
- Do not add comments that only repeat what the code says.
- Add comments only for non-obvious decisions, edge cases, or constraints.
- Keep naming clear and intention-revealing.

## Architecture
- Respect existing boundaries between UI, business logic, API, and data layers.
- Keep UI components focused on rendering and user interaction.
- Move complex logic into services, hooks, utilities, or domain modules.
- Keep API/request/response contracts clear and consistent.
- Avoid tight coupling between unrelated modules.
- Do not introduce global state unless necessary.
- Prefer simple architecture until complexity is justified.

## Configuration
- Use environment variables for secrets and environment-specific values.
- Never commit `.env`, credentials, tokens, private keys, or local config.
- Document required configuration in `.env.example` or README.
- Do not hard-code URLs, secrets, ports, or deployment-specific values unless already established.

## Data Handling
- Validate external input at system boundaries.
- Handle missing, duplicated, malformed, or unexpected data safely.
- Avoid storing unnecessary sensitive data.
- Keep data models, API schemas, and UI types aligned.
- Use migrations or documented schema changes when persistence changes.

## Error Handling
- Handle loading, empty, error, and success states.
- Return or display clear error messages without leaking internal details.
- Do not hide failures silently.
- Add fallback behavior for unreliable external services.
- Log useful debugging information without exposing secrets.

## AI / External Service Rules
- Treat external API and AI model outputs as untrusted.
- Validate structured outputs before using or saving them.
- Add fallback behavior for empty, malformed, or low-quality responses.
- Do not allow AI output to trigger destructive actions without confirmation.
- Keep prompts, schemas, and parsing logic centralized when practical.

## Testing
- Add or update tests for critical business logic.
- Test edge cases, not only the happy path.
- Mock external APIs, browser APIs, databases, and AI calls where appropriate.
- Do not write brittle tests that depend on internal implementation details.
- If tests cannot be added, explain the reason and provide manual verification steps.

## Commands
- Before running commands, inspect available scripts in README, package files, Makefile, or project config.
- After changes, run the most relevant lint, typecheck, test, or build command.
- Do not install new dependencies unless necessary.
- If adding a dependency, explain why existing tools are insufficient.
- Keep dependency changes minimal.

## Git
- Keep changes focused and easy to review.
- Use conventional commit style when suggesting commit messages.
- Recommended types: feat, fix, refactor, docs, test, chore, style.
- Do not include generated files, build outputs, local database files, or secrets.
- Do not modify lockfiles unless dependency changes require it.

## Response Format
- Summarize what changed.
- List files modified.
- Mention commands run and results.
- State assumptions, risks, and remaining TODOs honestly.