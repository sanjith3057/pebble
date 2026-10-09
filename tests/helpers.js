const fs = require('fs');
const os = require('os');
const path = require('path');
const { ToolRegistry } = require('../tools/registry');
const { PermissionStore } = require('../security/permissions/permissions');
const { ToolGateway } = require('../core/policy/tool-gateway');

/** A temporary project folder with a couple of files, deleted by cleanup(). */
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pebble-test-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'console.log("hi");');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/**
 * Real gateway wired to fake tools that record what they were asked to do.
 * `confirmAnswer` is what the (simulated) user clicks in the confirmation dialog.
 */
function makeGateway({ confirmAnswer = true } = {}) {
  const registry = new ToolRegistry();
  const permissions = new PermissionStore();
  const executed = [];
  const audit = [];
  const confirmations = [];

  registry.register(
    { name: 'read_file', description: 'Read a permitted text file', risk: 'low', permission: 'filesystem.read', input_schema: { path: 'string' } },
    async ({ path: p }) => {
      executed.push({ tool: 'read_file', path: p });
      return fs.readFileSync(p, 'utf8');
    },
  );
  registry.register(
    { name: 'write_file', description: 'Write a file', risk: 'medium', permission: 'filesystem.write', input_schema: { path: 'string', content: 'string' } },
    async ({ path: p }) => {
      executed.push({ tool: 'write_file', path: p });
      return 'ok';
    },
  );
  registry.register(
    { name: 'delete_file', description: 'Delete a file', risk: 'low', permission: 'filesystem.delete', input_schema: { path: 'string' } },
    async ({ path: p }) => {
      executed.push({ tool: 'delete_file', path: p });
      return 'deleted';
    },
  );
  registry.register(
    { name: 'run_command', description: 'Run a terminal command', risk: 'medium', permission: 'terminal.execute', input_schema: { command: 'string' } },
    async ({ command }) => {
      executed.push({ tool: 'run_command', command });
      return 'done';
    },
  );
  registry.register(
    { name: 'explode', description: 'Always throws', risk: 'low', permission: 'context.ide', input_schema: {} },
    async () => {
      throw new Error('boom');
    },
  );

  const gateway = new ToolGateway({
    registry,
    permissions,
    confirm: async (request) => {
      confirmations.push(request);
      return typeof confirmAnswer === 'function' ? confirmAnswer(request) : confirmAnswer;
    },
    audit: (event) => audit.push(event),
  });

  return { gateway, registry, permissions, executed, audit, confirmations };
}

module.exports = { makeWorkspace, makeGateway };
