---
id: codex-provider
type: module-design
status: draft
title: Codex CLI evaluation adapter
---

## Responsibility

The Codex adapter makes a locally authenticated Codex CLI available to promptfoo for both response generation and rubric grading, without changing the repository's Devin baseline. It accepts promptfoo exec arguments (prompt, options, optional context); context is unused. Nonempty JSON chat arrays with a role on the first message select grader mode. Grader messages require string roles and contents and are combined in order with role labels, not API-level role separation. Other inputs remain literal provider prompts.

## Boundary

Model selection belongs to Codex's local configuration unless `config.model` supplies a nonempty string override. The same rule applies to both modes so evaluation and grading do not silently select different hard-coded models.

Evaluated prompts run in a read-only sandbox, without approval bypass, because this adapter evaluates responses rather than workspace mutations. Local CLI configuration, tools, and repository instructions still apply; the adapter is not an isolated model API. Each call starts a new invocation, not a resumed session.

Prompts travel to Codex through stdin so prompt content cannot become command flags or shell syntax. On Windows, native executables or standard npm installation entry points are launched without a command shell; nonstandard shims are not supported. The outer promptfoo exec argument-size limit remains outside this boundary.

Only the final assistant response is returned, preserving its contents. Progress and tool output must not contaminate evaluated text or grader JSON. Unique temporary response files isolate concurrent calls and are removed on normal completion and handled failures. Invalid input, launch errors, nonzero exits, signals, and absent or empty final responses fail rather than becoming successful model output.

## Verification

Offline tests mock the CLI boundary and cover output isolation, message order, model selection, failure cleanup, and Windows npm resolution. They do not establish authenticated service behavior or native Windows compatibility. No additional runtime dependencies are needed.
