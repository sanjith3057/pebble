const { validateArgs } = require('../../tools/registry');
const { classifyRisk, requiresConfirmation } = require('./risk');
const { PATH_SCOPED } = require('../../security/permissions/permissions');
const { resolveSafePath } = require('../../security/sandbox/paths');

/**
 * The only path from an AI tool call to execution (System Design §16, §20, §27).
 *
 * Every call goes through, in order:
 *   lookup → argument validation → risk classification → permission (+ path scope)
 *   → confirmation if required → execution → audit
 *
 * Result statuses:
 *   executed  - the tool ran and returned a result
 *   rejected  - unknown tool or invalid arguments
 *   denied    - permission missing or path outside allowed folders
 *   cancelled - the user declined confirmation
 *   failed    - the tool threw an error
 */
class ToolGateway {
  /**
   * @param {object} deps
   * @param {import('../../tools/registry').ToolRegistry} deps.registry
   * @param {import('../../security/permissions/permissions').PermissionStore} deps.permissions
   * @param {(request: object) => Promise<boolean>} deps.confirm Shows the confirmation UI (§18).
   * @param {(event: object) => void} [deps.audit]
   */
  constructor({ registry, permissions, confirm, audit = () => {} }) {
    this.registry = registry;
    this.permissions = permissions;
    this.confirm = confirm;
    this.audit = audit;
  }

  async execute(toolCall) {
    const name = toolCall && toolCall.name;
    const finish = (outcome) => {
      // Log what happened, never the content the tool returned.
      const { result, ...logged } = outcome;
      this.audit({ type: 'ToolCall', tool: name, ...logged, at: new Date().toISOString() });
      return outcome;
    };

    const tool = typeof name === 'string' ? this.registry.get(name) : null;
    if (!tool) return finish({ status: 'rejected', reason: `Unknown tool: ${name}` });
    const { contract, run } = tool;

    const check = validateArgs(contract.input_schema, toolCall.args);
    if (!check.valid) return finish({ status: 'rejected', reason: check.errors.join('; ') });

    const risk = classifyRisk(contract, toolCall.args);
    const args = { ...toolCall.args };

    if (PATH_SCOPED.has(contract.permission)) {
      const safePath = this.resolveAllowedPath(contract.permission, args.path);
      if (!safePath) return finish({ status: 'denied', risk, reason: `${contract.permission} not granted for this path` });
      args.path = safePath;
    } else if (!this.permissions.has(contract.permission)) {
      return finish({ status: 'denied', risk, reason: `${contract.permission} not granted` });
    }

    if (requiresConfirmation(risk)) {
      let approved = false;
      try {
        approved = (await this.confirm({ tool: contract.name, description: contract.description, risk, args })) === true;
      } catch {
        approved = false;
      }
      if (!approved) return finish({ status: 'cancelled', risk });
    }

    try {
      const result = await run(args);
      return finish({ status: 'executed', risk, result });
    } catch (error) {
      return finish({ status: 'failed', risk, reason: error.message });
    }
  }

  resolveAllowedPath(permission, requested) {
    if (typeof requested !== 'string') return null;
    const grant = this.permissions.list().find((g) => g.permission === permission);
    if (!grant) return null;
    for (const root of grant.roots) {
      const safePath = resolveSafePath(root, requested);
      if (safePath && this.permissions.has(permission, { path: safePath })) return safePath;
    }
    return null;
  }
}

module.exports = { ToolGateway };
