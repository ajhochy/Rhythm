import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alignGatewayRedactions,
  parityValue,
} from '../msp-006-live-parity.test.mjs';

test('issue-1277-c2: MCP parity compares the live engine status projection', () => {
  const engineStatus = {
    rhythm: {
      status: 'connected',
    },
  };
  const desktopEnriched = [
    {
      name: 'rhythm',
      status: 'connected',
      requiredEnv: ['RHYTHM_API_KEY'],
      needsCredentials: false,
      source: 'managed',
      tools: ['rhythm_tasks_list'],
    },
  ];

  assert.deepEqual(
    parityValue(engineStatus, '/opencode/mcp'),
    parityValue(desktopEnriched, '/opencode/mcp'),
  );
});

test('issue-1277-c3: provider auth prompts align by non-secret identity', () => {
  const mobile = {
    github: [
      {
        label: 'GitHub',
        prompts: [
          {
            key: '[redacted]',
            message: 'Enter your GitHub Enterprise URL or domain',
            placeholder: 'company.ghe.com or https://company.ghe.com',
            type: 'text',
            when: {
              key: '[redacted]',
              op: 'eq',
              value: 'enterprise',
            },
          },
          {
            key: '[redacted]',
            message: 'Select GitHub deployment type',
            options: [
              {
                hint: 'Data residency or self-hosted',
                label: 'GitHub Enterprise',
                value: 'enterprise',
              },
              {
                label: 'GitHub.com',
                value: 'cloud',
              },
            ],
            type: 'select',
          },
        ],
        type: 'oauth',
      },
    ],
  };
  const desktop = {
    github: [
      {
        label: 'GitHub',
        prompts: [
          {
            key: 'deploymentType',
            message: 'Select GitHub deployment type',
            options: [
              {
                hint: 'Data residency or self-hosted',
                label: 'GitHub Enterprise',
                value: 'enterprise',
              },
              {
                label: 'GitHub.com',
                value: 'cloud',
              },
            ],
            type: 'select',
          },
          {
            key: 'enterpriseUrl',
            message: 'Enter your GitHub Enterprise URL or domain',
            placeholder: 'company.ghe.com or https://company.ghe.com',
            type: 'text',
            when: {
              key: 'deploymentType',
              op: 'eq',
              value: 'enterprise',
            },
          },
        ],
        type: 'oauth',
      },
    ],
  };

  const mobileNorm = parityValue(mobile, '/provider/auth');
  const desktopNorm = alignGatewayRedactions(
    mobileNorm,
    parityValue(desktop, '/provider/auth'),
  );

  assert.deepEqual(mobileNorm, desktopNorm);
});
