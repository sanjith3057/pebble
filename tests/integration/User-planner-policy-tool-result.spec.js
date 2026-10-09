/**
 * Integration Tests - User → Planner → Policy → Tool → Result (System Design §17, §27)
 */
const { runPlan } = require('../../core/planner/run-plan');
const { makeGateway, makeWorkspace } = require('../helpers');

describe('Plan execution through the policy layer', () => {
  let ws;
  beforeEach(() => (ws = makeWorkspace()));
  afterEach(() => ws.cleanup());

  // "Fix the failing tests": read → modify → run tests
  const fixTestsPlan = [
    { name: 'read_file', args: { path: 'src/index.js' } },
    { name: 'write_file', args: { path: 'src/index.js', content: 'fixed' } },
    { name: 'run_command', args: { command: 'npm test' } },
  ];

  function grantAll(permissions) {
    permissions.grant('filesystem.read', { roots: [ws.root] });
    permissions.grant('filesystem.write', { roots: [ws.root] });
    permissions.grant('terminal.execute');
  }

  test('runs every step when permitted and approved', async () => {
    const { gateway, permissions, executed, confirmations } = makeGateway({ confirmAnswer: true });
    grantAll(permissions);
    const run = await runPlan(fixTestsPlan, gateway);
    expect(run.completed).toBe(true);
    expect(run.results.map((r) => r.status)).toEqual(['executed', 'executed', 'executed']);
    expect(executed.map((e) => e.tool)).toEqual(['read_file', 'write_file', 'run_command']);
    // Reading is low risk; writing and running commands needed approval.
    expect(confirmations.map((c) => c.tool)).toEqual(['write_file', 'run_command']);
  });

  test('stops when the user cancels and skips the remaining steps', async () => {
    const { gateway, permissions, executed } = makeGateway({ confirmAnswer: (req) => req.tool !== 'write_file' });
    grantAll(permissions);
    const run = await runPlan(fixTestsPlan, gateway);
    expect(run).toMatchObject({ completed: false, stoppedAt: 1 });
    expect(run.results[1].status).toBe('cancelled');
    expect(executed.map((e) => e.tool)).toEqual(['read_file']);
  });

  test('stops when a step lacks permission', async () => {
    const { gateway, permissions, executed } = makeGateway();
    permissions.grant('filesystem.read', { roots: [ws.root] });
    const run = await runPlan(fixTestsPlan, gateway);
    expect(run).toMatchObject({ completed: false, stoppedAt: 1 });
    expect(run.results[1].status).toBe('denied');
    expect(executed).toHaveLength(1);
  });

  test('stops on a tool failure and reports it honestly', async () => {
    const { gateway, permissions } = makeGateway();
    permissions.grant('context.ide');
    const run = await runPlan([{ name: 'explode', args: {} }, { name: 'explode', args: {} }], gateway);
    expect(run).toMatchObject({ completed: false, stoppedAt: 0 });
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ status: 'failed', reason: 'boom' });
  });

  test('confirmation shows the user what will happen', async () => {
    const { gateway, permissions, confirmations } = makeGateway();
    grantAll(permissions);
    await runPlan([fixTestsPlan[1]], gateway);
    expect(confirmations[0]).toMatchObject({
      tool: 'write_file',
      description: 'Write a file',
      risk: 'medium',
      args: { path: expect.stringContaining('index.js'), content: 'fixed' },
    });
  });
});
