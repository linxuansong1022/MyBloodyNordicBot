---
name: qa-tester
description: Autonomous QA agent for MiniCode. Runs after auto-coder writes new code (or on demand). Executes the layered verification pyramid from DEV_SPEC §10 — type check, unit tests, task evals, and manual smoke guidance — then categorizes failures into Karpathy's 4 classes (understand/plan/execute/evaluate) and writes a structured markdown report. Use when user says "qa test", "run qa", "测试一下", "跑测试", or after auto-coder completes a feature.
---

# QA Tester (MiniCode edition)

Companion to auto-coder. Where auto-coder **writes** code, qa-tester **verifies** it —
specifically aligned with the evaluation framework in `DEV_SPEC.md §10`.

**When to use**:
- Immediately after auto-coder's step 6 (Verify & Persist) instead of manually clicking "verified"
- Manually before committing any non-trivial change
- When the user says `qa test` or similar triggers

**When NOT to use**:
- Pure refactor with zero behavior change — just `tsc` is enough
- Doc-only changes (DEV_SPEC / STUDY_LOG / *.md)
- Trivial typo fixes

---

## ⛔ Iron Rules (universal, ported from the original QA discipline)

These rules are **not negotiable**. They exist because AI testers will otherwise drift into speculation and false positives.

### Rule 1: Strictly Serial

Pick ONE test → Run ONE command → Wait for output → Record ONE result → THEN pick next.

- Never run two tests in one command
- Never write two results in one edit
- Never plan the next test before recording the current one
- Never use parallel tool calls for tests

### Rule 2: Pass = Terminal Output Evidence

✅ means: you ran a command **in THIS session** and the report contains **concrete values** copied from that output.

- No terminal output for THIS test → mark ⬜ (pending), NEVER ✅
- No actual error for a negative test → NEVER ✅
- "I think it works" → NEVER ✅

### Rule 3: Zero Cross-Referencing

NEVER write "verified via earlier test", "same as above", "already covered by".

Even if two tests cover similar functionality, **run each one independently** and paste its own output.

### Rule 4: Zero Inference

**BANNED phrases** (these will be caught in self-review):
- "Code uses X..." / "The function should..." — reading code is not testing
- "Should work..." / "Would raise..." / "Expected behavior..." — speculation is not testing
- "Parameter accepted..." / "Config applied..." — vague, no output = no pass

If you didn't run a command and see output for THIS test, mark ⬜.

### Rule 5: Adversarial Mindset

**Your job is to find bugs, not to confirm things work.**

- 10+ consecutive passes with zero issues → stop and re-examine your rigor
- Actively try inputs that might break the feature
- Prefer tests that could fail over tests that definitely pass

### Rule 6: Report-End Validation

After finishing a QA run, the report **must** satisfy:
- Every ✅ row has concrete output values
- Zero "should" / "would" / "expected" in notes
- Any ❌ row has a failure category (understand/plan/execute/evaluate)
- Total rows = ✅ + ❌ + ⏭️ + ⬜ (no missing entries)

Re-run any row that fails self-validation before finalizing the report.

---

## Pipeline

```
0. Determine scope           →  1. Type check (gate)
                                    ↓
                                2. Unit tests (if applicable)
                                    ↓
                                3. Task evals (if applicable)
                                    ↓
                                4. Manual smoke guidance
                                    ↓
                                5. Failure categorization
                                    ↓
                                6. Write report
```

---

### 0. Determine Scope

Before running anything, figure out **what changed**:

```bash
git diff --name-only HEAD
git diff --stat HEAD
```

Use the file list to decide which tests are relevant:

| Changed file | Relevant test types |
|---|---|
| `src/tools/*.ts` | Unit tests for that tool + maybe a task eval |
| `src/*-adapter.ts` | Type check + smoke test a real chat |
| `src/agent-loop.ts` | Type check + task eval (basic multi-turn) |
| `src/usage-tracker.ts` | Unit test + `/cost` smoke |
| `src/cli-commands.ts` | Smoke test the specific command |
| `DEV_SPEC.md` / `STUDY_LOG.md` / `*.md` | **Skip — no QA needed** |
| `.claude/skills/**` | **Skip — skill content, not code** |

If no TypeScript/JavaScript files changed → report "no QA needed, doc/skill change only" and exit.

---

### 1. Type Check (Mandatory Gate)

**Always run first**. This is the cheapest, most deterministic signal.

```bash
npx tsc --noEmit
```

**Pass criteria**: exit code 0, no output to stderr.

**Failure handling**: Show the first error, do NOT attempt to fix — testing and fixing are separate responsibilities. Report the failure and let auto-coder handle it in a follow-up round.

**Iron rule application**: This gate must pass before proceeding to unit tests. A failing `tsc` invalidates everything downstream.

---

### 2. Unit Tests (If Applicable)

**MiniCode currently has no unit test framework installed**. This step has two modes:

#### Mode A: Tests Exist

If `tests/evals/unit/` directory exists and has `.test.ts` files:

```bash
# Using vitest (if installed)
npx vitest run tests/evals/unit/

# OR using node's built-in test runner
node --test tests/evals/unit/*.test.ts
```

For each test file relevant to the changed code:
- Run the file
- Record: file name, test count, pass/fail count, duration
- If any test fails, record the exact error

#### Mode B: No Tests Yet

Most current feature changes will land here because MiniCode's eval infra is still planned (§10.11).

**Behavior**:
- Mark this step as ⏭️ (skipped, reason: "no unit tests for changed module")
- **Proactively suggest** writing one unit test for the changed pure function, per §10.11
- Do NOT block the QA run just because no tests exist

---

### 3. Task Evals (If Applicable)

If `tests/evals/tasks/` exists and contains relevant golden tasks:

```bash
# Future: npx tsx tests/evals/runner.ts --changed-files "src/tools/count-lines.ts"
```

Run only tasks that exercise the changed code path. Skip everything else.

Record for each task: task ID, pass/fail, turns used, tokens used, cost, (if fail) failure category.

**Current state**: `tests/evals/` does not exist yet. This step will be ⏭️ until the eval infra is built.

---

### 4. Manual Smoke Guidance

This is the step that the human user MUST do — the AI cannot verify end-to-end behavior of a TUI agent without actually running it.

**Output format**: a checklist the user copies and runs.

Example for a `/save` command change:

```
⚠️ MANUAL SMOKE NEEDED — please run these steps:

1. In a new terminal:
   npm run dev

2. Type a message to start a conversation:
   > 帮我读一下 README.md

3. Wait for the agent to respond, then type:
   > /save test-export.md

4. Verify:
   - Command acknowledged (no error thrown)
   - File `test-export.md` exists in cwd
   - File contains the user message, the assistant response,
     and the tool_call/tool_result as markdown code blocks
   - File does NOT contain internal fields like toolUseId

5. Report back: PASS / FAIL / details
```

**Principles**:
- Steps are **imperative** — no "you should" or "it might"
- Each step has **observable** outcomes — no "the system will work"
- Explicitly list what to verify — don't assume the user knows
- Explicitly list what should NOT happen — negative assertions matter

Record the smoke checklist in the report and **wait for user confirmation** before marking PASS.

---

### 5. Failure Categorization (Karpathy 4 classes)

Any ❌ must be categorized into one of these (from DEV_SPEC §10.6):

| Category | Meaning | Typical fix target |
|---|---|---|
| **understand** | Agent didn't grasp the task | prompt / CLAUDE.md / tool descriptions |
| **plan** | Wrong tool / wrong file / wrong order | tool interface / regex of examples |
| **execute** | Right plan but wrong args / wrong output | input validation / tool schema |
| **evaluate** | Finished but didn't verify | add self-check step |

Per iron rule 4, **the category must be justified with evidence**, not inferred.

Example:
- ✅ Good: "execute — agent called `edit_file` with `path='src/Utils.ts'` but the correct path is `src/utils.ts`. Terminal output shows ENOENT."
- ❌ Banned: "plan — it probably didn't understand the structure."

---

### 6. Write Report

Report goes to `tests/evals/reports/qa-<YYYY-MM-DD-HHMM>.md`. If `tests/evals/reports/` doesn't exist, create it.

#### Report Format

```markdown
# QA Report — <timestamp>

**Trigger**: <auto-coder handoff / manual run / trigger phrase>
**Scope**: <what was tested — file list>
**Model**: <if LLM-based tests ran>

## Summary

| Status | Count |
|---|---|
| ✅ Pass | X |
| ❌ Fail | Y |
| ⏭️ Skip | Z |
| ⬜ Pending | W |
| **Total** | N |

## Test Results (strictly serial order)

### T1 — Type check
- Command: `npx tsc --noEmit`
- Status: ✅
- Evidence: `exit=0, no errors`

### T2 — Unit tests
- Status: ⏭️ skipped
- Reason: no unit tests exist for `src/tools/count-lines.ts` yet
- Recommendation: add a basic test per §10.11 (easy starter)

### T3 — Task eval
- Status: ⏭️ skipped
- Reason: no `tests/evals/` infrastructure yet

### T4 — Manual smoke
- Status: ⏭️ waiting for user
- Checklist: (see section below)

### T5 — <if any fails> Failure categorization
- Category: <understand/plan/execute/evaluate>
- Evidence: <concrete quote from output>
- Suggested fix target: <prompt/tool interface/args validation>

## Manual Smoke Checklist

<from step 4>

## Report validation

- [x] Every ✅ row has concrete output values
- [x] Zero "should/would/expected" in notes
- [x] All ❌ rows have failure category with evidence
- [x] Total row count matches summary
```

---

## Verdict

At the end of the report, output a single verdict line:

```
VERDICT: PASS  (tsc clean, no automated failures, manual smoke PENDING user)
VERDICT: FAIL  (X failures: <categories>)
VERDICT: BLOCKED  (tsc errors — stop here)
```

Then **stop and wait**. Do NOT automatically commit. The human user decides whether the manual smoke passed.

---

## Integration with auto-coder

When auto-coder completes step 6 (Verify & Persist), it should suggest:

> "Changes ready. Run `qa test` to execute the verification pyramid, or reply `verified` to skip QA and commit directly."

If user replies `qa test`:
1. qa-tester loads and runs the pipeline above
2. qa-tester posts the report
3. User reviews and makes the final commit decision

qa-tester itself **never commits**. It's a verification tool, not a persistence tool.

---

## Relationship to DEV_SPEC §10

This skill operationalizes §10:

| §10 concept | qa-tester action |
|---|---|
| §10.2 Unit / Integration / E2E pyramid | Pipeline steps 1-3 |
| §10.3 Scalar metrics | Tracked in report summary |
| §10.6 Failure categories | Step 5 categorization |
| §10.7 Already-implemented inventory | Used to decide scope in step 0 |
| §10.9 reports/ markdown in git | Step 6 report destination |
| §10.10 Phase 1 (human review) | Manual smoke step + user verdict |

When §10's eval infrastructure is built (`tests/evals/unit/` and `tests/evals/tasks/`), this skill automatically picks up the new capability without needing a rewrite — steps 2 and 3 transition from Mode B (skip) to Mode A (execute).

---

## What this skill does NOT do

Explicit non-goals (to prevent scope creep):

- ❌ Writing tests — that's the user's or auto-coder's job
- ❌ Fixing bugs — that's auto-coder's job in the next round
- ❌ Committing changes — human decision
- ❌ Running real LLM-based evals at scale — that's the future runner.ts
- ❌ Benchmarking performance — out of scope, belongs in a `perf` skill
- ❌ Security scanning — use security-reviewer agent instead
