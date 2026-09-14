# ATC and ABAP Unit CI API integration

Revised 14 September 2026 following review of PR #779. This document describes the
current implementation. The original dossier claimed BTP live completion without
recording a release, timings, or scrubbed wire evidence; that claim is withdrawn.
The earlier duplicate AUnit client and dangerous-by-default options are removed.

## Sources and evidence limits

- [Piper ATC step](https://www.project-piper.io/steps/abapEnvironmentRunATCCheck/)
  documents SAP's CI ATC integration and severity threshold.
- [Piper ABAP test stage](https://www.project-piper.io/pipelines/abapEnvironment/stages/test/)
  documents ATC/AUnit pipeline usage. Its software-component options do not establish
  complete package/source reconciliation inside ARC-1.
- [SAP test attributes](https://help.sap.com/saphelp_em92/helpdata/en/49/25667929ac16b7e10000000a42189d/content.htm)
  distinguishes harmless tests from tests that may affect persistent data or system
  settings. ARC-1's read-scoped execution is always harmless-only.
- Local protocol evidence and the existing `src/adt/aunit.ts` implementation are
  authoritative for ARC-1 behavior. A separate BTP communication-arrangement smoke
  with release, timings and redacted reports is still required before claiming
  SAP_COM_0901/0735 end-to-end compatibility for this integration.

## Current contract

`SAPDiagnose atc_ci` and `unittest_ci` accept `packages` and `packageTrees`: at most
50 entries total, 1..40 characters each (letters, digits, underscore, slash, `$`).
Case is normalized and duplicates removed; a tree subsumes the same explicit
package. Other action inputs are rejected. Software-component selection is deferred
because the prior multiPropertySet intersection behavior and complete source
selection were not established. `timeoutSeconds` is one overall 1..3600-second
budget, default 600; requests and waits retain cancellation.

Both actions use the configured SAP identity and ordinary startup discovery/CSRF.
A dummy run GET is an *availability probe*, not a special CSRF bypass. An unavailable
API (404/405/406/415 probe) produces a contextual error. Authentication/authorization
failures propagate. CI actions are excluded from the normative multi-target allowlist.

All package names are verified by ADT package metadata before any run starts. ATC
also requires a nonempty repository selection for every requested package/tree.
This prevents an empty Checkstyle report for a typo from passing. It is evidence
that a selection exists, not a claim that ADT search is a complete TADIR inventory.

### ATC

1. GET `/sap/bc/adt/api/atc/runs/00000000000000000000000000000000` with
   `Accept: application/vnd.sap.atc.run.v1+xml` to probe availability.
2. Verify all selections; POST `/sap/bc/adt/api/atc/runs?clientWait=false` with
   `application/vnd.sap.atc.run.parameters.v1+xml; charset=utf-8` and a package OSL
   object set. Default variant is `ABAP_CLOUD_DEVELOPMENT_DEFAULT`; `variant` and
   optional `configuration` must refer to target-supported settings.
3. Poll the returned canonical host-relative `/sap/bc/adt/api/atc/runs/…` path.
   Completed status must include an unambiguous Checkstyle link selected by rel/type.
   Fetch only a canonical `/sap/bc/adt/api/atc/results/…` path.
4. Validate XML, expected Checkstyle root and finding fields. Empty valid Checkstyle
   can pass after selection verification. Unexpected/malformed reports never pass.
   Evaluate every finding at `failOnSeverity` (`error`, `warning`, `info`).

A local timeout returns `status:"incomplete", fail:true`, run path and last SAP
status/progress. It is never an HTTP 504 with a generic server retry hint. A reachable
endpoint can leave a job in `Not Yet Started`; inspect the existing run before
starting another. ARC-1 neither restarts nor cancels SAP jobs automatically.

### AUnit

`unittest_ci` calls the existing `unittest type=DEVC resultFormat=junit` flow for
each explicit package/tree under the shared deadline. That flow uses native public
AUnit plus legacy harmless results and a stable active-source selection audit.
This is necessary: a native run can omit source-declared harmless classes while
reporting zero failures. Reusing only the public run client would lose this check.

All test durations are included; own tests only, dangerous/critical disabled.
There is no evaluateResults bypass. Zero tests, all skipped, source-selection gaps,
native/legacy contradictions and incomplete evidence never make the CI gate green.
JUnit parsing requires the correct root, numeric nonnegative root counters, nested
case reconciliation, and consistent supplied suite counters. HTML, malformed XML,
missing testcases and contradictory counters are rejected.

### Output and CLI

The default response contains summary and run/result paths. ATC returns at most 200
findings with `truncated` while evaluating all findings. `includeReportXml:true`
opts into up to 256 KiB of XML total: ATC `reportXml`, or AUnit per-package
`results[].reportXml`. Oversize XML is explicitly omitted. Native XML parsing is
capped at 2 MiB; exceeding it is not a quality pass.

`arc1-cli call SAPDiagnose …` exits 0 only for explicit `status:"completed"` and
`fail:false`; failure, incomplete, malformed results and tool errors exit nonzero.
MCP callers must inspect the domain outcome, not only the absence of `isError`.

## Review implementation and verification

See [the reviewed correction plan](../plans/2026-09-14-pr779-review-hardening.md).
The regression matrix covers invalid report roots, nested/missing/contradictory
JUnit counts, zero/all-skipped results, every package preflight before POST,
harmless XML, unsafe run/result links, shared deadlines and cancellation,
terminal states, missing API guidance, bounded reports, action input rules and CLI exits.
Live results and final gate counts are recorded below after verification.

### Live acceptance, 14 September 2026

Read-scoped calls under the configured developer identity; no repository objects
were changed. Requests used the normal ADT client and MCP dispatcher.

| System | Case | Observed result |
|---|---|---|
| SAP_BASIS 758 SP02 / 816 SP01 | nonexistent package, both CI actions | contextual error, **zero run POSTs** on each call |
| 758 SP02 | SABP_UNIT_AUTHORITY_DEMO | incomplete, fail:true, six omitted harmless classes, 4.916 s |
| 758 SP02 / 816 SP01 | ATC CI, SABP_UNIT_DOUBLE_FTG, variant DEFAULT, 5 s budget | one POST each; incomplete at 5.003 / 5.004 s, preserving Not Yet Started and Job not yet started |
| 758 SP02 | existing ZCL_ABAPGIT_HASH, normal public/JUnit unittest | four tests passed; source selection verified |
| 758 SP02 | real compiled CLI, unittest_ci on omitted-harmless package | exit **1**, status incomplete, fail:true |
| SAP_BASIS 750 | both CI API probes | clear API-not-available errors, no empty-object hint |

The timeout evidence establishes bounded, truthful failure behavior; it does not
establish successful ATC background execution. No BTP communication arrangement
was available for this verification. Package/tree CI scope is retained; whole
software-component selection and special communication-user bootstrap are deferred.

### Final review

Restored the 74,000-byte full wire ceiling and 1,795-line tools.ts budget.
The reduced new surface measures 48,524 read-only / 73,651 full wire bytes, with
12,131 / 18,413 estimated tokens. Only the smaller token/count ratchets needed for
five bounded controls remain above main; the prior 17-property expansion is gone.
Multi-target removes the CI actions and their exclusive inputs.

Full tests, typecheck, build, lint, action-policy and size/schema gates were run.
The strict JUnit change exposed three old synthetic fixtures claiming nonzero tests
without any testcase elements; those fixtures now contain matching cases. No test
was disabled. The seven changed tool snapshots were regenerated and reviewed for
the intended action/input and guidance changes.

Final count: **6,668 tests in 215 files passed** after `npm ci` using this fork's
lockfile, with `npm test -- --maxWorkers=4`; all other repository gates passed.
The default parallel run twice hit an unrelated HTTP metadata test (HTTP parse /
timeout); that file passed in isolation, and the complete four-worker run passed.
No production HTTP code or test timeout was changed to conceal that instability.
