import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseCiQualityFailed } from '../../../src/cli-checks.js';
import { handleCiQuality } from '../../../src/handlers/diagnose-ci.js';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import { textResult, toolJson } from '../../../src/handlers/shared.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

function payload(outcome = 'passed', tests = 1) {
  return textResult(
    toolJson({
      outcome,
      summary: { tests, failures: 0, errors: 0, skipped: 0 },
      sourceSelectionEvidence: { status: 'verified', omittedTestClasses: [] },
      junit: '<testsuites/>',
    }),
  );
}
function mockPackageReads() {
  mockFetch.mockImplementation(async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/packages/'))
      return mockResponse(200, `<package name="${decodeURIComponent(path.split('/').at(-1)!)}"/>`);
    return mockResponse(200, '<run/>');
  });
}

describe('CI action inputs and adapters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPackageReads();
  });
  it.each(['atc_ci', 'unittest_ci'])('accepts bounded package input for %s', (action) => {
    expect(
      getToolSchema('SAPDiagnose', false)!.safeParse({ action, packages: ['$TMP', '/NS/P'], timeoutSeconds: 1 })
        .success,
    ).toBe(true);
  });
  it.each([
    { action: 'atc_ci' },
    { action: 'atc_ci', packages: Array(51).fill('Z') },
    { action: 'atc_ci', packages: ['x'.repeat(41)] },
    { action: 'atc_ci', packages: ['Z"'] },
    { action: 'atc_ci', packages: ['Z'], timeoutSeconds: 3601 },
    { action: 'unittest_ci', packages: ['Z'], dangerous: true },
    { action: 'unittest_ci', packages: ['Z'], critical: false },
    { action: 'unittest_ci', packages: ['Z'], evaluateResults: false },
    { action: 'unittest_ci', softwareComponents: ['Z'] },
    { action: 'atc_ci', packages: ['Z'], name: 'Z' },
    { action: 'atc_ci', packages: ['Z'], type: 'DEVC' },
    { action: 'unittest_ci', packages: ['Z'], resultFormat: 'junit' },
    { action: 'unittest_ci', packages: ['Z'], coverage: true },
    { action: 'unittest_ci', packages: ['Z'], includeSubpackages: true },
    { action: 'unittest_ci', packages: ['Z'], variant: 'X' },
    { action: 'atc', packages: ['Z'] },
    { action: 'syntax', includeReportXml: true },
    { action: 'atc_ci', packages: Array(30).fill('Z'), packageTrees: Array(30).fill('Y') },
  ])('rejects unsupported or contradictory input %#', async (args) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', args);
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('uses the existing JUnit/reconciliation handler with one deadline for package and tree selections', async () => {
    const client = createClient();
    const diagnose = vi.fn().mockResolvedValue(payload());
    const result = await handleCiQuality(
      client,
      { action: 'unittest_ci', packages: ['ZA'], packageTrees: ['ZB'], timeoutSeconds: 3 },
      diagnose,
    );
    expect(diagnose).toHaveBeenCalledTimes(2);
    expect(diagnose.mock.calls[0]?.[1]).toEqual({
      action: 'unittest',
      type: 'DEVC',
      name: 'ZA',
      includeSubpackages: false,
      resultFormat: 'junit',
      timeoutSeconds: 3,
    });
    expect(diagnose.mock.calls[1]?.[1]).toMatchObject({ name: 'ZB', includeSubpackages: true });
    expect(diagnose.mock.calls[0]?.[2]).toEqual(diagnose.mock.calls[1]?.[2]);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: 'completed',
      fail: false,
      summary: { tests: 2 },
      selectedPackages: 2,
      processedPackages: 2,
    });
    expect(result.content[0].text).not.toContain('reportXml');
  });
  it.each([
    ['no_tests', 0],
    ['incomplete', 0],
    ['failed', 1],
  ])('never makes %s green', async (outcome, tests) => {
    const result = await handleCiQuality(
      createClient(),
      { action: 'unittest_ci', packages: ['Z'] },
      vi.fn().mockResolvedValue(payload(String(outcome), Number(tests))),
    );
    expect(JSON.parse(result.content[0].text).fail).toBe(true);
    expect(diagnoseCiQualityFailed({ action: 'unittest_ci' }, result)).toBe(true);
  });
  it('refuses an unverified apparent pass', async () => {
    const diagnose = vi
      .fn()
      .mockResolvedValue(
        textResult(toolJson({ outcome: 'passed', summary: { tests: 1, failures: 0, errors: 0, skipped: 0 } })),
      );
    const result = await handleCiQuality(createClient(), { action: 'unittest_ci', packages: ['Z'] }, diagnose);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'incomplete', fail: true });
  });
  it('preflights every package before executing any test', async () => {
    mockFetch.mockImplementation(async (url: unknown) =>
      String(url).includes('/packages/ZMISSING')
        ? mockResponse(404, '<error/>')
        : String(url).includes('/packages/')
          ? mockResponse(200, '<package name="ZA"/>')
          : mockResponse(200, '<run/>'),
    );
    const diagnose = vi.fn();
    await expect(
      handleCiQuality(createClient(), { action: 'unittest_ci', packages: ['ZA', 'ZMISSING'] }, diagnose),
    ).rejects.toThrow('ZMISSING');
    expect(diagnose).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  });
  it('maps an unavailable unit API without the empty-object hint', async () => {
    mockFetch.mockResolvedValue(mockResponse(404, '<error/>'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'unittest_ci',
      packages: ['Z'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('API is not available');
    expect(result.content[0].text).not.toContain('Object ""');
  });
  it('includes only explicitly requested bounded XML', async () => {
    const result = await handleCiQuality(
      createClient(),
      { action: 'unittest_ci', packages: ['Z'], includeReportXml: true },
      vi.fn().mockResolvedValue(payload()),
    );
    expect(JSON.parse(result.content[0].text).results[0].reportXml).toBe('<testsuites/>');
  });

  it('passes the caller signal to the existing reconciliation handler', async () => {
    const signal = new AbortController().signal;
    const diagnose = vi.fn().mockResolvedValue(payload());
    await requestContext.run({ requestId: 'ci-signal', signal }, () =>
      handleCiQuality(createClient(), { action: 'unittest_ci', packages: ['Z'] }, diagnose),
    );
    expect(diagnose.mock.calls[0]?.[2]).toMatchObject({ signal, deadline: expect.any(Number) });
  });
});

describe('CI CLI exit gate', () => {
  it.each([{ fail: true, status: 'completed' }, { fail: false, status: 'incomplete' }, { fail: false }, {}])(
    'fails closed for %j',
    (value) => {
      expect(diagnoseCiQualityFailed({ action: 'unittest_ci' }, textResult(toolJson(value)))).toBe(true);
    },
  );
  it('only accepts explicit completion and pass', () => {
    expect(
      diagnoseCiQualityFailed({ action: 'atc_ci' }, textResult(toolJson({ status: 'completed', fail: false }))),
    ).toBe(false);
    expect(diagnoseCiQualityFailed({ action: 'atc' }, textResult('{}'))).toBe(false);
  });
});
