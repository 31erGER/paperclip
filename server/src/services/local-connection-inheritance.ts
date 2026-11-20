import {
  agentHarnessType,
  aiRoutingModel,
  aiRuntimeConnectionBindingSchema,
  isAiRoutingCompatible,
  type AiProviderRouting,
  type AiRuntimeConnectionBinding,
} from "@paperclipai/shared";

/**
 * Hired agents inherit the hiring agent's local model connection
 * (fork 31erGER, local harness).
 *
 * Upstream lets a hired agent inherit only legacy credential references. A
 * hiring agent that uses a managed connection passes nothing on, so an agent
 * hired by another agent starts without any model and cannot run. That breaks
 * a company that grows itself on one local model server.
 *
 * This inherits the hiring agent's connection when, and only when, it is a
 * `local` connection (loopback LM Studio / llama.cpp endpoint): there is no
 * provider account or paid credential to pass on. Cloud and gateway
 * connections keep upstream behavior. A connection the hire request names
 * itself always wins.
 *
 * Pure decision logic: the caller supplies how to read the parent's routing
 * and applies the result through the normal hire validation, which checks the
 * binding and installs the connection for the new agent.
 */
type AgentShape = {
  adapterType: string | null | undefined;
  adapterConfig: Record<string, unknown> | null | undefined;
  runtimeConfig: unknown;
  defaultEnvironmentId?: string | null;
};

export interface LocalConnectionInheritance {
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  defaultEnvironmentId: string | null | undefined;
  binding: AiRuntimeConnectionBinding;
  /** The model the child will use, or null when none could be decided. */
  model: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function resolveLocalConnectionInheritance(input: {
  parent: AgentShape;
  child: AgentShape;
  /** Routing of the parent's connection, or undefined when it cannot be read. */
  readParentRouting: (binding: AiRuntimeConnectionBinding) => Promise<AiProviderRouting | undefined>;
}): Promise<LocalConnectionInheritance | null> {
  const childRuntime = record(input.child.runtimeConfig);
  // The hire request chose its own connection.
  if (childRuntime.aiConnection) return null;

  const parsed = aiRuntimeConnectionBindingSchema.safeParse(record(input.parent.runtimeConfig).aiConnection);
  if (!parsed.success) return null;
  const binding = parsed.data;
  // Pools and "use the responsible user's default" are not one fixed connection.
  if (binding.mode !== "delegated" && binding.mode !== "shared") return null;

  const routing = await input.readParentRouting(binding);
  if (!routing || routing.kind !== "local") return null;

  const childConfig = record(input.child.adapterConfig);
  const childHarness = agentHarnessType(input.child.adapterType ?? "", childConfig);
  if (!isAiRoutingCompatible(routing, childHarness)) return null;

  const parentConfig = record(input.parent.adapterConfig);
  const parentHarness = agentHarnessType(input.parent.adapterType ?? "", parentConfig);
  const requestedModel = nonEmptyString(childConfig.model);
  const parentModel = parentHarness === childHarness ? nonEmptyString(parentConfig.model) : null;
  const firstConnectionModel = nonEmptyString(routing.models[0]?.id);
  const chosen = requestedModel ?? parentModel ?? firstConnectionModel;
  // Pi and OpenCode address a routed model as "<provider>/<id>".
  const model = chosen ? aiRoutingModel(routing, childHarness, chosen) : null;

  return {
    adapterConfig: model ? { ...childConfig, model } : childConfig,
    runtimeConfig: { ...childRuntime, aiConnection: binding },
    defaultEnvironmentId: input.child.defaultEnvironmentId !== undefined
      ? input.child.defaultEnvironmentId
      : input.parent.defaultEnvironmentId ?? undefined,
    binding,
    model,
  };
}
