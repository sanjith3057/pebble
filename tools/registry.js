const { PERMISSIONS } = require('../security/permissions/permissions');
const { RISK_LEVELS } = require('../core/policy/risk');

const ARG_TYPES = ['string', 'number', 'boolean'];
const MAX_STRING_ARG = 10000;

/**
 * Check a tool contract (System Design §16) before it can be registered.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateToolContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: ['contract must be an object'] };
  }
  if (typeof contract.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(contract.name)) {
    errors.push('name must be snake_case');
  }
  if (typeof contract.description !== 'string' || contract.description.trim() === '') {
    errors.push('description is required');
  }
  if (!RISK_LEVELS.includes(contract.risk)) {
    errors.push(`risk must be one of ${RISK_LEVELS.join(', ')}`);
  }
  if (!PERMISSIONS.includes(contract.permission)) {
    errors.push(`unknown permission: ${contract.permission}`);
  }
  const schema = contract.input_schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push('input_schema must be an object');
  } else {
    for (const [key, type] of Object.entries(schema)) {
      if (!ARG_TYPES.includes(type)) errors.push(`input_schema.${key} has unsupported type: ${type}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Check arguments the AI sent against a tool's input_schema. Every field is
 * required, types must match exactly, and unknown fields are rejected.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, errors: ['arguments must be an object'] };
  }
  const errors = [];
  for (const [key, type] of Object.entries(schema)) {
    if (!(key in args)) errors.push(`missing argument: ${key}`);
    else if (typeof args[key] !== type) errors.push(`${key} must be a ${type}`);
    else if (type === 'string' && args[key].length > MAX_STRING_ARG) errors.push(`${key} is too long`);
  }
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) errors.push(`unexpected argument: ${key}`);
  }
  return { valid: errors.length === 0, errors };
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(contract, run) {
    const { valid, errors } = validateToolContract(contract);
    if (!valid) throw new Error(`Invalid tool contract: ${errors.join('; ')}`);
    if (typeof run !== 'function') throw new Error(`Tool ${contract.name} needs a run function`);
    if (this.tools.has(contract.name)) throw new Error(`Tool already registered: ${contract.name}`);
    this.tools.set(contract.name, { contract: Object.freeze({ ...contract }), run });
  }

  get(name) {
    return this.tools.get(name) || null;
  }
}

module.exports = { validateToolContract, validateArgs, ToolRegistry };
