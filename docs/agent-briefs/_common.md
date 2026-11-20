# Common instructions for every build agent

Read these three files first, in order: `docs/BUILD-CONTRACT.md`,
`docs/ARCHITECTURE.md`, then your own brief `docs/agent-briefs/<your-id>.md`.

Then obey these rules verbatim (they come from the orchestration prompt):

1. Do not deviate from the frozen types in `src/contracts/`. If a contract is
   wrong or insufficient, **stop and request a change** in your report — do not
   invent a parallel type.
2. Write only inside your owned paths (see BUILD-CONTRACT §1). Never touch
   another agent's files, `package.json`, or `README.md`.
3. Your module must be complete and runnable in isolation, with a `README.md`
   in your directory: what it does, how to run it alone, what it outputs, its
   inputs.
4. Offline/mock mode must always work. Live mode is behind an explicit flag.
5. No `TODO`, no `FIXME`, no stubs, no commented-out code, no placeholder text,
   no fake data that isn't clearly labelled as fixture data.
6. Before reporting, run your module's own smoke command and paste the real
   output (trimmed).
7. Report back in exactly this format:

```
STATUS: done | blocked
FILES: <paths created/modified>
RUN: <exact command you ran> → <real output, trimmed>
DEPENDENCIES NEEDED: <npm packages or package.json scripts the orchestrator must add>
CONTRACT CHANGES REQUESTED: <any, with justification — do not self-apply>
KNOWN LIMITS: <honest list>
```

8. British-or-American spelling: this repo uses **British spelling** in prose
   (behaviour, normalise, licence) but keeps standard API/technical terms as
   they are (normalizer names may stay if they mirror a library API). Code
   identifiers are American-spelled camelCase (`normalizeCandidate`).
9. Everything must pass `npx tsc --noEmit` and `npx eslint . --max-warnings 0`
   from the repo root, and `npx prettier --check` on your files. Run them before
   reporting. The repo is ESM (`"type": "module"`), TypeScript strict.
10. Determinism: nothing you generate may embed wall-clock time.
