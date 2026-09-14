/** Compact shared CI property definitions; kept outside the tool registry's size ceiling. */
import { z } from 'zod';
export const CI_PACKAGES_SCHEMA = z
  .array(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_/$]+$/),
  )
  .max(50);
export const CI_QUALITY_INPUTS = {
  variant: {
    type: 'string',
    description: 'atc/atc_ci: check variant; atc_variants: name filter (*=all)',
  },

  timeoutSeconds: {
    type: 'number',
    description: 'unittest/atc timeout: 1-3600s; default 300. CI overall timeout: 1-3600s, default 600.',
  },

  packages: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_/$]+$' },
    description: 'CI package names; 1-50 entries total with packageTrees.',
  },
  packageTrees: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_/$]+$' },
    description: 'CI packages including subpackages.',
  },
  configuration: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    description: 'atc_ci: optional configuration.',
  },
  failOnSeverity: {
    type: 'string',
    enum: ['error', 'warning', 'info'],
    description: 'atc_ci: fail at this severity or worse (default error).',
  },
  includeReportXml: {
    type: 'boolean',
    description: 'CI: include XML reports, capped at 256 KiB total (default false).',
  },
};
