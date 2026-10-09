/**
 * Execute a plan produced by the planner, one step at a time (System Design §17).
 * Planning and execution are separate: every step still goes through the Tool
 * Gateway, so policy can stop any step. The run stops at the first step that
 * is not executed (denied, cancelled, rejected or failed).
 *
 * @param {Array<{ name: string, args: object }>} steps
 * @param {import('../policy/tool-gateway').ToolGateway} gateway
 */
async function runPlan(steps, gateway) {
  const results = [];
  for (const step of steps) {
    const outcome = await gateway.execute(step);
    results.push({ step: step.name, ...outcome });
    if (outcome.status !== 'executed') {
      return { completed: false, stoppedAt: results.length - 1, results };
    }
  }
  return { completed: true, stoppedAt: null, results };
}

module.exports = { runPlan };
