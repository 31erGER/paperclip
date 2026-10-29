// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AiProviderSetup } from "./AiProviderSetup";
import { aiConnectionsApi } from "@/api/ai-connections";
import { TooltipProvider } from "@/components/ui/tooltip";
import { aiProviderSetupPreset } from "@paperclipai/shared";
import type { AiConnectionCredentialStep } from "./AiConnectionCredentialStep";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

let credentialProps: ComponentProps<typeof AiConnectionCredentialStep> | undefined;
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { discoverModels: vi.fn(), create: vi.fn(async () => ({ connectionId: "connection", grantId: "grant" })), list: vi.fn(async () => ({ currentUserId: "owner", connections: [], canManageConnections: true })) } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn(async () => []) } }));
vi.mock("./AiConnectionCredentialStep", () => ({ AiConnectionCredentialStep: (props: ComponentProps<typeof AiConnectionCredentialStep>) => { credentialProps = props; return <div>Existing credential flow</div>; } }));

it("reconnects an older OpenRouter account without adding routing metadata", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const onComplete = vi.fn();
  const account = { id: "connection", grantId: "grant", companyId: "company", provider: "openrouter", method: "api_key", name: "Existing OpenRouter", ownership: "personal", ownerUserId: "owner", isDefault: true, status: "needs_attention" } as const;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AiProviderSetup companyId="company" reconnect={account} onCancel={() => {}} onComplete={onComplete} /></QueryClientProvider>));
    expect(container.textContent).toContain("Existing credential flow");
    expect(credentialProps).toMatchObject({ connectionId: account.id, provider: "openrouter", initialMethod: "api_key", fixedMethod: true });
    credentialProps!.onComplete({ connectionId: account.id, grantId: account.grantId, method: "api_key" });
    expect(onComplete).toHaveBeenCalledWith({ provider: "openrouter", method: "api_key", mode: "delegated", connectionId: account.id, grantId: account.grantId });
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

const providerSources = ["openrouter", "bedrock", "responses-api", "messages-api", "chat-completions-api", "local"];

async function localDiscoveryForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: true, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><AiProviderSetup companyId="company" initialProvider="local" initialProtocol="chat" providerLabel="LM Studio" onCancel={() => {}} onComplete={() => {}} /></TooltipProvider></QueryClientProvider>));
  return { container, async close() { await act(async () => root.unmount()); container.remove(); client.clear(); } };
}
function discoverButton(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find(button => button.textContent === "Test connection and load models");
}

it("fetches local models only on request and saves checked opaque IDs", async () => {
  vi.mocked(aiConnectionsApi.discoverModels).mockReset().mockResolvedValue({ models: [{ id: "model-a" }, { id: "model-b,opaque", label: "Model B" }] });
  vi.mocked(aiConnectionsApi.create).mockClear();
  const form = await localDiscoveryForm();
  try {
    expect(aiConnectionsApi.discoverModels).not.toHaveBeenCalled();
    expect(discoverButton(form.container)).toBeTruthy();
    await act(async () => discoverButton(form.container)!.click());
    await vi.waitFor(() => expect(form.container.querySelector('[role="checkbox"][aria-label="model-b,opaque"]')).not.toBeNull());
    expect(aiConnectionsApi.discoverModels).toHaveBeenCalledWith("company", expect.objectContaining({ routing: expect.objectContaining({ kind: "local", baseUrl: "http://localhost:1234/v1", auth: "none" }) }), expect.any(AbortSignal));
    await act(async () => (form.container.querySelector('[role="checkbox"][aria-label="model-b,opaque"]') as HTMLButtonElement).click());
    await act(async () => form.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(aiConnectionsApi.create).toHaveBeenCalledWith("company", expect.objectContaining({ routing: expect.objectContaining({ models: [{ id: "model-b,opaque" }] }) }));
  } finally { await form.close(); }
});

it("ignores and cancels a model list when the provider URL changes", async () => {
  let finish!: (value: { models: Array<{ id: string }> }) => void;
  vi.mocked(aiConnectionsApi.discoverModels).mockReset().mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const form = await localDiscoveryForm();
  try {
    expect(discoverButton(form.container)).toBeTruthy();
    await act(async () => discoverButton(form.container)!.click());
    const signal = vi.mocked(aiConnectionsApi.discoverModels).mock.calls[0][2]!;
    const url = form.container.querySelector('[aria-label="Provider URL"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(url, "http://localhost:4321/v1");
      url.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ models: [{ id: "stale-model" }] }));
    expect(form.container.textContent).not.toContain("stale-model");
    expect(form.container.querySelector('[role="checkbox"]')).toBeNull();
  } finally { await form.close(); }
});

it("preserves unfinished separators while typing manual model IDs", async () => {
  const form = await localDiscoveryForm();
  try {
    const models = form.container.querySelector('[aria-label="Model IDs"]') as HTMLInputElement;
    for (const raw of ["first-model", "first-model,", "first-model, s", "first-model, second-model"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(models, raw);
        models.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(models.value).toBe(raw);
    }
  } finally { await form.close(); }
});

it("shows discovery errors, retries empty lists, and retains manual model entry", async () => {
  vi.mocked(aiConnectionsApi.discoverModels).mockReset().mockRejectedValueOnce(new Error("Local endpoint unavailable")).mockResolvedValue({ models: [] });
  vi.mocked(aiConnectionsApi.create).mockClear();
  const form = await localDiscoveryForm();
  try {
    expect(discoverButton(form.container)).toBeTruthy();
    await act(async () => discoverButton(form.container)!.click());
    await vi.waitFor(() => expect(form.container.querySelector('[role="alert"]')?.textContent).toContain("Local endpoint unavailable"));
    expect(aiConnectionsApi.create).not.toHaveBeenCalled();
    await act(async () => discoverButton(form.container)!.click());
    await vi.waitFor(() => expect(form.container.textContent).toContain("No models were returned"));
    const models = form.container.querySelector('[aria-label="Model IDs"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(models, "manual-one, manual-two");
      models.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => form.container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(aiConnectionsApi.create).toHaveBeenCalledWith("company", expect.objectContaining({ routing: expect.objectContaining({ models: [{ id: "manual-one" }, { id: "manual-two" }] }) }));
  } finally { await form.close(); }
});
it("saves LM Studio with a loopback endpoint and no API key", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: true, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><AiProviderSetup companyId="company" initialProvider="local" initialProtocol="chat" providerLabel="LM Studio" onCancel={() => {}} onComplete={() => {}} /></TooltipProvider></QueryClientProvider>));
    expect((container.querySelector('[aria-label="Provider URL"]') as HTMLInputElement).value).toBe("http://localhost:1234/v1");
    expect(container.querySelector('input[aria-label="API key"]')).toBeNull();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(aiConnectionsApi.create).toHaveBeenCalledWith("company", expect.objectContaining({
      provider: "openai", method: "api_key", routing: expect.objectContaining({ kind: "local", protocol: "chat", auth: "none", baseUrl: "http://localhost:1234/v1" }),
    }));
    expect(vi.mocked(aiConnectionsApi.create).mock.lastCall?.[1]).not.toHaveProperty("apiKey");
  } finally { await act(async () => root.unmount()); client.clear(); }
});
it("shows advanced providers directly when entered from advanced connection mode", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: true, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AiProviderSetup companyId="company" advancedOnly onCancel={() => {}} onComplete={() => {}} /></QueryClientProvider>));
    const choices = Array.from(container.querySelectorAll("button[aria-label]")).map(button => button.getAttribute("aria-label"));
    expect(choices).toEqual(["OpenRouter", "Amazon Bedrock", "Custom gateway", "Local endpoint"]);
    expect(container.querySelector("details")).toBeNull();
  } finally {
    await act(async () => root.unmount()); client.clear();
  }
});

it.each(providerSources)("opens %s directly with shared access folded under Advanced", async source => {
  const preset = aiProviderSetupPreset(source)!;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: true, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], [{ id: "agent", name: "Nova" }]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onCancel = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><AiProviderSetup companyId="company" initialProvider={preset.provider} initialProtocol={preset.protocol} providerLabel={preset.label} onCancel={onCancel} onComplete={() => {}} /></TooltipProvider></QueryClientProvider>));
    expect(container.textContent).not.toContain("Connect a model provider");
    expect(container.textContent).toContain(source === "local" ? "No sign-in needed, available to all agents." : "Connects for everyone in your organization, available to all agents.");
    expect(container.querySelector('[role="radio"]')).toBeNull();
    const change = Array.from(container.querySelectorAll('button')).find(b => b.textContent === "Change")!;
    expect(change.getAttribute("aria-expanded")).toBe("false");
    await act(async () => change.click());
    const radio = (text: string) => Array.from(container.querySelectorAll('[role="radio"]')).find(b => b.textContent?.includes(text)) as HTMLButtonElement;
    if (source !== "local") expect(radio("Any human in the organization").getAttribute("aria-checked")).toBe("true");
    expect(radio("Any agent").getAttribute("aria-checked")).toBe("true");
    if (source !== "local") await act(async () => radio("Just me").click());
    expect(container.textContent).toContain(source === "local" ? "No sign-in needed, available to all agents." : "Connects as you, available to all agents.");
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === "Back")!.click());
    expect(onCancel).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); container.remove(); client.clear();
  }
});

it("saves the default organization grant and all-agent installation from the direct connect screen", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: true, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AiProviderSetup companyId="company" initialProvider="openrouter" onCancel={() => {}} onComplete={() => {}} /></QueryClientProvider>));
    const input = container.querySelector('input[aria-label="API key"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "fixture-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(aiConnectionsApi.create).toHaveBeenCalledWith("company", expect.objectContaining({ ownership: "shared", allAgents: true, agentIds: [], apiKey: "fixture-key", routing: expect.objectContaining({ kind: "openrouter" }) }));
  } finally {
    await act(async () => root.unmount()); client.clear();
  }
});


it("allows an ordinary member to save a personal gateway before the agent exists", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: false, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onComplete = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AiProviderSetup companyId="company" initialProvider="openrouter" onCancel={() => {}} onComplete={onComplete} /></QueryClientProvider>));
    const input = container.querySelector('input[aria-label="API key"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "member-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const connect = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(connect.disabled).toBe(false);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(aiConnectionsApi.create).toHaveBeenCalledWith("company", expect.objectContaining({ ownership: "personal", allAgents: false, agentIds: [], apiKey: "member-key" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ mode: "delegated", connectionId: "connection", grantId: "grant" }));
  } finally {
    await act(async () => root.unmount()); client.clear();
  }
});


it.each(["google", "openai", "anthropic", "xai"] as const)("allows an ordinary member to connect a personal %s account before an agent exists", async provider => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company", undefined], { canManageConnections: false, connections: [] });
  client.setQueryData(["agents", "company", "provider-access"], []);
  const container = document.createElement("div");
  const root = createRoot(container);
  credentialProps = undefined;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AiProviderSetup companyId="company" initialProvider={provider} onCancel={() => {}} onComplete={() => {}} /></QueryClientProvider>));
    expect(credentialProps).toMatchObject({ provider, ownership: "personal", allAgents: false, agentIds: [], disabled: false });
  } finally {
    await act(async () => root.unmount()); client.clear();
  }
});
