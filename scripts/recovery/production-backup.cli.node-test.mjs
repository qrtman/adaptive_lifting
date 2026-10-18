import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGitHubDefaultBranchGate } from './production-backup.mjs';

test('scheduled run accepts a safe default-branch ref with the documented empty payload', () => {
  assert.deepEqual(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/production-bootstrap' },
    eventPayload: {},
  }), {
    allowed: true,
    event: 'schedule',
    ref: 'refs/heads/production-bootstrap',
  });
});

test('scheduled run rejects tags and unsafe refs', () => {
  for (const ref of ['refs/tags/v1.0.0', 'refs/heads/../private', 'refs/heads/branch name']) {
    assert.equal(deriveGitHubDefaultBranchGate({
      env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: ref },
      eventPayload: {},
    }), null);
  }
});

test('workflow dispatch accepts only the payload repository default branch', () => {
  assert.deepEqual(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/production-bootstrap' },
    eventPayload: { repository: { default_branch: 'production-bootstrap' } },
  }), {
    allowed: true,
    event: 'workflow_dispatch',
    ref: 'refs/heads/production-bootstrap',
  });
  assert.equal(deriveGitHubDefaultBranchGate({
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature/backup' },
    eventPayload: { repository: { default_branch: 'production-bootstrap' } },
  }), null);
});

test('workflow dispatch rejects missing or malformed default branch data', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' };
  for (const eventPayload of [{}, { repository: {} }, { repository: { default_branch: '../main' } }, null]) {
    assert.equal(deriveGitHubDefaultBranchGate({ env, eventPayload }), null);
  }
});
