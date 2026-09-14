/** Package-based ATC CI client. AUnit CI reuses the existing reconciled handler. */
import { setTimeout as sleep } from 'node:timers/promises';
import {
  type AtcCiSeverity,
  atcFindingsFail,
  buildAtcCiRunParametersXml,
  type CiObjectSet,
  type CiRunStatusDocument,
  normalizeCiObjectSet,
  parseAtcCheckstyle,
  parseAtcCiRunStatus,
} from './ci-quality-xml.js';
import { AdtApiError, AdtNetworkError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions, AdtResponse } from './http.js';
import { assertCanonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { findDeepNodes, parseSearchResults, parseXml } from './xml-parser.js';

export const ATC_CI_RUNS_PATH = '/sap/bc/adt/api/atc/runs';
export const ATC_CI_ACCEPT_RUN = 'application/vnd.sap.atc.run.v1+xml';
export const ATC_CI_CONTENT_TYPE_RUN = 'application/vnd.sap.atc.run.parameters.v1+xml; charset=utf-8';
export const ATC_CI_ACCEPT_CHECKSTYLE = 'application/vnd.sap.atc.checkstyle.v1+xml';
export const CI_REPORT_XML_LIMIT = 256 * 1024;
export const CI_REPORT_PARSE_LIMIT = 2 * 1024 * 1024;
export const CI_FINDINGS_LIMIT = 200;
export const CI_POLL_TIMEOUT_DEFAULT_SECONDS = 600;

export interface CiQualityClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export interface RunAtcCiOptions {
  objectSet: CiObjectSet;
  variant?: string;
  configuration?: string;
  failOnSeverity?: AtcCiSeverity;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  clock?: CiQualityClock;
  includeReportXml?: boolean;
}

/** Verify all named packages before starting any run; ATC additionally needs a nonempty selection. */
export async function verifyCiPackages(
  http: AdtHttpClient,
  safety: SafetyConfig,
  input: CiObjectSet,
  requestOptions: AdtRequestOptions,
  requireObjects = false,
): Promise<ReturnType<typeof normalizeCiObjectSet>> {
  checkOperation(safety, OperationType.Read, 'VerifyCiPackages');
  const objectSet = normalizeCiObjectSet(input);
  for (const name of [...objectSet.packages, ...objectSet.packageTrees]) {
    let response: AdtResponse;
    try {
      response = await http.get(`/sap/bc/adt/packages/${encodeURIComponent(name)}`, undefined, requestOptions);
    } catch (error) {
      if (error instanceof AdtApiError && error.statusCode === 404)
        throw new Error(`CI package ${name} does not exist or is not accessible. No run was started.`);
      throw error;
    }
    const packages = findDeepNodes(parseXml(response.body), 'package');
    if (!packages.some((pkg) => String(pkg['@_name'] ?? '').toUpperCase() === name))
      throw new Error(`CI package ${name} could not be verified. No run was started.`);
    if (requireObjects) {
      const result = await http.get(
        `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=${encodeURIComponent(name)}&maxResults=1000`,
        undefined,
        requestOptions,
      );
      const objects = parseSearchResults(result.body).filter(
        (object) => objectSet.packageTrees.includes(name) || object.packageName.toUpperCase() === name,
      );
      if (!objects.length)
        throw new Error(`CI package selection ${name} is empty or could not be verified. No run was started.`);
    }
  }
  return objectSet;
}

export async function probeAtcCi(
  http: AdtHttpClient,
  safety: SafetyConfig,
  requestOptions: AdtRequestOptions,
): Promise<boolean> {
  checkOperation(safety, OperationType.Read, 'ProbeAtcCi');
  try {
    await http.get(
      `${ATC_CI_RUNS_PATH}/00000000000000000000000000000000`,
      { Accept: ATC_CI_ACCEPT_RUN },
      { ...requestOptions, probe: true },
    );
    return true;
  } catch (error) {
    if (error instanceof AdtApiError && [404, 405, 406, 415].includes(error.statusCode)) return false;
    throw error;
  }
}

export async function runAtcCiCheck(http: AdtHttpClient, safety: SafetyConfig, options: RunAtcCiOptions) {
  checkOperation(safety, OperationType.Read, 'RunAtcCiCheck');
  const timeout = options.timeoutSeconds ?? CI_POLL_TIMEOUT_DEFAULT_SECONDS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600)
    throw new Error('CI timeoutSeconds must be an integer from 1 to 3600.');
  const clock = options.clock ?? {
    now: Date.now,
    sleep: (ms: number, signal?: AbortSignal) => sleep(ms, undefined, { signal }),
  };
  const started = clock.now();
  const deadline = started + timeout * 1000;
  const requestOptions = { deadline, signal: options.signal };
  let runPath: string | undefined;
  let state: CiRunStatusDocument = { status: 'not started' };
  const incomplete = (reason: string) => ({
    status: 'incomplete' as const,
    fail: true,
    durationMs: clock.now() - started,
    incompleteReason: reason,
    runPath,
    lastStatus: state.status,
    progress: state.progress,
  });
  try {
    options.signal?.throwIfAborted();
    if (!(await probeAtcCi(http, safety, requestOptions)))
      throw new Error('ATC CI API is not available on this system. Use SAPDiagnose action="atc" if supported.');
    const objectSet = await verifyCiPackages(http, safety, options.objectSet, requestOptions, true);
    const created = await http.post(
      `${ATC_CI_RUNS_PATH}?clientWait=false`,
      buildAtcCiRunParametersXml(objectSet, options),
      ATC_CI_CONTENT_TYPE_RUN,
      { Accept: ATC_CI_ACCEPT_RUN },
      requestOptions,
    );
    runPath = assertCanonicalHostRelativeAdtPath(
      created.headers.location ?? created.headers.Location ?? '',
      `${ATC_CI_RUNS_PATH}/`,
    );
    while (clock.now() < deadline) {
      options.signal?.throwIfAborted();
      const response = await http.get(runPath, { Accept: ATC_CI_ACCEPT_RUN }, requestOptions);
      state = parseAtcCiRunStatus(response.body);
      if (/^completed$/i.test(state.status)) {
        if (!state.resultHref) return incomplete('Completed run has no unambiguous Checkstyle result link.');
        const resultPath = assertCanonicalHostRelativeAdtPath(state.resultHref, '/sap/bc/adt/api/atc/results/');
        const result = await http.get(resultPath, { Accept: ATC_CI_ACCEPT_CHECKSTYLE }, requestOptions);
        if (Buffer.byteLength(result.body) > CI_REPORT_PARSE_LIMIT)
          return incomplete('Checkstyle report exceeded the 2 MiB parsing limit.');
        const parsed = parseAtcCheckstyle(result.body);
        const reportTooLarge = Buffer.byteLength(result.body) > CI_REPORT_XML_LIMIT;
        return {
          status: 'completed' as const,
          fail: atcFindingsFail(parsed.findings, options.failOnSeverity ?? 'error'),
          durationMs: clock.now() - started,
          runPath,
          resultPath,
          summary: parsed.summary,
          findings: parsed.findings.slice(0, CI_FINDINGS_LIMIT),
          truncated: parsed.findings.length > CI_FINDINGS_LIMIT,
          ...(options.includeReportXml
            ? reportTooLarge
              ? { reportXmlOmitted: 'Report exceeds 256 KiB.' }
              : { reportXml: result.body }
            : {}),
        };
      }
      if (!state.status || /^(not created|failed|error|aborted|cancelled|canceled)$/i.test(state.status))
        return incomplete('SAP did not complete the ATC CI run.');
      const remaining = deadline - clock.now();
      if (remaining <= 0) break;
      await clock.sleep(Math.min(5000, remaining), options.signal);
    }
    return incomplete('ATC CI deadline expired. Inspect the existing SAP run before starting another.');
  } catch (error) {
    if (options.signal?.aborted) return incomplete('ATC CI call cancelled; the SAP run may still exist.');
    const cause = error instanceof AdtNetworkError ? error.cause : error;
    if (cause instanceof Error && cause.name === 'TimeoutError')
      return incomplete('ATC CI deadline expired. Inspect the existing SAP run before starting another.');
    throw error;
  }
}
