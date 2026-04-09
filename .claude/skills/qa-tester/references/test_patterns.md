# Test Patterns for MiniCode

Concrete templates and examples for the qa-tester pipeline. Each pattern corresponds
to a step in `SKILL.md` and shows what "concrete output evidence" looks like in practice.

---

## Pattern 1: Type Check (gate)

**Command**:
```bash
npx tsc --noEmit
```

**Pass evidence**:
```
$ npx tsc --noEmit
$ echo $?
0
```
Report note: `exit=0, no output, tsc clean`

**Fail evidence**:
```
src/cli-commands.ts:142:5 - error TS2304: Cannot find name 'registerCommand'.
```
Report note: `TS2304 at src/cli-commands.ts:142:5`, category: **execute** (args/name typo)

---

## Pattern 2: Unit Test for a Pure Function

Target example: `src/tools/count-lines.ts`'s `run()` function.

Future structure (after unit infra exists):

```typescript
// tests/evals/unit/count-lines.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Hypothetical export — adjust based on real module shape
import { countLines } from '../../../src/tools/count-lines.js'

test('counts lines in a multi-line file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'count-lines-'))
  const file = join(dir, 'sample.txt')
  writeFileSync(file, 'a\nb\nc\n')

  const result = await countLines({ path: file })
  assert.match(result, /LINES: 3/)

  unlinkSync(file)
})

test('handles empty file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'count-lines-'))
  const file = join(dir, 'empty.txt')
  writeFileSync(file, '')

  const result = await countLines({ path: file })
  assert.match(result, /LINES: 0/)

  unlinkSync(file)
})

test('throws on missing file', async () => {
  await assert.rejects(() => countLines({ path: '/nonexistent/file.txt' }))
})
```

**Run**:
```bash
node --test tests/evals/unit/count-lines.test.ts
```

**Pass evidence** (actual output):
```
▶ counts lines in a multi-line file ... ok (2.1ms)
▶ handles empty file ... ok (1.3ms)
▶ throws on missing file ... ok (0.9ms)
✔ 3 passed, 0 failed
```

Report note: `3/3 passed, tests: counts-multiline, handles-empty, throws-on-missing`

---

## Pattern 3: Manual Smoke Checklist (CLI agent)

For a new slash command `/foo`:

```
⚠️ MANUAL SMOKE — please run:

1. In a fresh terminal:
   cd /Users/songlinxuan/Desktop/MiniCode
   npm run dev

2. Wait for the prompt, then type:
   > /foo

3. Verify:
   - The command is recognized (no "Unknown command" error)
   - The expected side effect occurs (describe it specifically)
   - Status line shows no error
   - The conversation history still scrolls normally after

4. Negative check:
   - Type: > /fooasdf
   - Should show "Unknown command" (not crash)

5. Type /exit to quit cleanly.

6. Report back: PASS / FAIL with specifics.
```

**Pass evidence format** (paste back from user):
```
Smoke: PASS
- /foo recognized
- Expected output "Hello from foo" appeared
- /fooasdf → "Unknown command: fooasdf"
- /exit → clean shutdown
```

---

## Pattern 4: Failure Categorization Examples

### understand
```
Symptom: Agent wrote an "add" function to src/utils.ts but user asked for "sum"
Evidence: "User prompt said '求和函数 sum', agent created 'add'"
Category: understand
Fix target: Clarify prompt parsing or add ask-user step for ambiguous terms
```

### plan
```
Symptom: Agent edited src/utils.ts directly instead of creating a new file as requested
Evidence: "User said '新建 src/math.ts', agent used edit_file on src/utils.ts"
Category: plan
Fix target: Improve tool selection — add hint in write_file description
```

### execute
```
Symptom: Agent called edit_file with wrong path case
Evidence: "path='src/Utils.ts' but actual file is 'src/utils.ts', ENOENT thrown"
Category: execute
Fix target: Add path normalization in edit_file or case-insensitive fallback
```

### evaluate
```
Symptom: Agent said "Done" but tsc --noEmit shows 3 errors in the new file
Evidence: "agent final: 'task complete'; tsc output: '3 errors in src/foo.ts'"
Category: evaluate
Fix target: Add post-write tsc check in agent-loop or system prompt
```

---

## Pattern 5: Report Skeleton (empty but valid)

Copy this when starting a new QA run:

```markdown
# QA Report — <YYYY-MM-DD-HHMM>

**Trigger**: <auto-coder handoff / manual>
**Scope**: <changed files from git diff --name-only>
**Model**: <if LLM test ran; else "n/a">

## Summary

| Status | Count |
|---|---|
| ✅ Pass | 0 |
| ❌ Fail | 0 |
| ⏭️ Skip | 0 |
| ⬜ Pending | 0 |
| **Total** | 0 |

## Test Results

### T1 — Type check
- Command: `npx tsc --noEmit`
- Status: ⬜ pending
- Evidence: (fill after running)

### T2 — Unit tests
- Command: (fill based on scope)
- Status: ⬜ pending
- Evidence: (fill after running)

### T3 — Task eval
- Status: ⏭️ skipped
- Reason: (e.g., "no tests/evals/ infra yet" or "no task covers changed path")

### T4 — Manual smoke
- Status: ⬜ waiting for user
- Checklist: (inline or reference external doc)

## Verdict

VERDICT: <PASS | FAIL | BLOCKED>
```

---

## Common Pitfalls (lessons from the original skill, adapted)

1. **Ran tsc once in a different session, assume it still passes** → NO. Re-run in the current session per Iron Rule 2. Stale output is speculation.

2. **"Well, the code reads the file so clearly it works"** → Banned. Reading code ≠ testing. Either run it or mark ⬜.

3. **"Similar feature already tested" → ❌ Cross-referencing** → Banned per Rule 3. Re-run independently.

4. **Markdown report that concludes PASS without concrete values** → Fails self-validation. Add the actual `exit=0` / `output contains X` / etc.

5. **Skipping the manual smoke because you're impatient** → Do NOT mark PASS. Mark ⬜ "waiting for smoke" and explicitly wait.

6. **Fixing a failing test yourself instead of reporting** → QA's job is to **report**, not **fix**. Record the failure category and hand back to auto-coder for a new round.

---

## Interaction with auto-coder (concrete handoff)

auto-coder's step 6 output should transition to qa-tester like this:

```
✅ <feature> — implementation complete

Files touched:
  - src/foo.ts
  - DEV_SPEC.md §4.X

Options:
  "qa test"   → run QA verification pyramid (recommended)
  "verified"  → skip QA, commit directly
  "fix: ..."  → apply further fixes before commit
```

If user picks `qa test`:
1. qa-tester reads git diff to get the scope
2. Runs the pipeline in SKILL.md
3. Writes report to `tests/evals/reports/qa-<timestamp>.md`
4. Prints verdict and waits
5. User reads report, decides verified / fix

qa-tester **never commits**. Only the human (or auto-coder on explicit user command) commits.
