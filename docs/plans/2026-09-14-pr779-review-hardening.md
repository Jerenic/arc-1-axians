# PR #779 review corrections

## Findings and scope

Independently inspected the supplied review against head 4f55cbbe. The duplicate
AUnit parser accepts missing reports, trusts contradictory counters, and defaults
to dangerous/critical tests; the existing unittest flow already reconciles native
JUnit, legacy alerts and active source. The new client also lacks request deadlines,
mislabels local timeouts as HTTP 504, and widens the normative multi-target allowlist.

Keep atc_ci and unittest_ci as single-target, read-scoped, package-based CI actions.
Preserve the CLI nonzero exit route and new-commit review history. Do not require
another approval: the user explicitly asked to apply applicable review fixes.

## Plan

1. Reproduce parser failures locally. Make unittest_ci a thin package/tree adapter
   over the existing unittest JUnit handler, sharing an overall deadline and signal.
   Preflight all package names before any run POST; retain source reconciliation.
   Remove the duplicate AUnit client/builders/parsers and risky execution knobs.
2. Support explicit packages/packageTrees only. Defer softwareComponents: its OSL
   intersection semantics and complete source-selection proof are not established.
   Bound input lists (50 each, total 50), names (40), timeout (1..3600), and reject
   unrelated action inputs in Zod. Unknown/risky parameters must never be ignored.
3. ATC: probe availability, verify each selected package and nonempty repository
   selection, start once, validate host-relative run/result links with the shared
   path guard, pass one deadline/signal throughout, report incomplete timeouts with
   last status/progress/run path. Empty Checkstyle may pass only after selection
   verification. Validate report roots and nodes; never mistake HTML for a pass.
4. Reuse and strengthen parseNativeJunitSummary for nested cases and contradictory
   counters. Do not add a second JUnit summary parser. Bound returned findings and
   optional report XML; the default MCP result must not duplicate large raw reports.
5. Remove CI actions from multi-target allowlists and docs. Restore prior budget
   ceilings where the reduced schema fits. Move CLI exit interpretation to cli-checks.
   Correct unsubstantiated BTP/CSRF claims; normal configured identity is used.
6. Add regression matrices for invalid reports, counters, empty/all-skipped runs,
   nonexistent/late invalid packages before POST, harmless request XML, deadline and
   cancellation, unsafe links, timeout diagnostics, input rules and CLI exits.
   Run focused tests, full gates, live on-prem failure/incomplete acceptance, inspect
   final diff and repeat fixes/tests for findings before pushing a new maintainer commit.

## Plan review

A wrapper over runPublicAunit alone is insufficient: omitted harmless source classes
are detected by the existing *handler's reconciliation*, so reuse that complete flow.
No default dangerous tests, broader SAP identity, automatic re-run after timeout,
or expansion of multi-target scope. A missing BTP communication arrangement is an
explicit live-validation limit, not evidence that an on-prem not-started run works.
SAP documents the risk-level consequences; Piper documents the external API, but
neither proves this ARC-1 integration completed on a configured BTP target.

Sources: [SAP test attributes](https://help.sap.com/saphelp_em92/helpdata/en/49/25667929ac16b7e10000000a42189d/content.htm),
[Piper ATC step](https://www.project-piper.io/steps/abapEnvironmentRunATCCheck/).

## Review results

Completed the planned corrections. Local probes first reproduced green HTML,
empty JUnit and contradictory failure counters. The replacement tests reject those
reports, reconcile nested cases, and preserve real positive native/JUnit behavior.
Live acceptance and the explicit BTP validation limit are in the revised API dossier.

Plan adjustment: kept bounded package/tree adapters instead of exposing a general
OSL software-component set; the AUnit adapter reuses the complete existing handler
because the public client alone does not detect omitted source-declared tests.
All action mutation/scope gates remain unchanged; multi-target access narrows.
No HTTP-status-shaped errors are used for local validation, cancellation or timeouts.

## Review round 2 (2026-09-15)

Reproduced the reported integration failure by locally combining the five original
reviewed heads: tools.ts 1,796/1,795 lines; standard description tokens 8,803/8,800;
BTP schema tokens 17,646/17,600; BTP description tokens 12,257/12,200;
full wire size 73,963/74,000 bytes. No GitHub PR was merged or rebased.

Plan and review decisions:
- Exclude DEVC and DEVC/* rows as evidence of a checkable object, including tree
  selections. A real descendant can establish nonemptiness for packageTrees, while
  exact packages still require an object directly in that package. This remains
  conservative when quick search cannot prove a nonempty selection.
- Preserve earlier package results after a later tool error, exception, invalid
  response or cancellation. Record failed/unattempted targets, stop further runs,
  return incomplete/fail true and retain exit 1. Do not copy raw nested errors into
  JSON and bypass minimal-error redaction.
- Rename the shared definition module to diagnose-fields.ts to reflect ownership
  of variant/timeout as well as CI fields. Trim repeated SAPDiagnose guidance and
  retain required inputs, defaults, risk restrictions, and exact quickfix values.
  Restore the pre-CI schema token ratchets (12,000 read and 17,350 BTP); retain the
  original wire ceilings and lower the tools.ts line budget to 1,782, including
  #786's extra line.

Verification: build, typecheck, lint, policy, file/schema budgets and all **6,678
unit tests in 215 files** passed. Seven regenerated snapshots were structurally
compared with the prior head: changes are descriptions only, with no new/removed
fields, enums, types or constraints. Live passing/failing AUnit evidence from the
external review remains applicable to the unchanged reconciled execution path;
this round exercises the new fault handling and empty-selection gates with controlled
responses. ATC completion on the affected system and BTP remain unverified.
