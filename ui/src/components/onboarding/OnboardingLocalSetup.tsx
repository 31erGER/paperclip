import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AiConnectionBinding } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { AiProviderSetup } from "../ai-connections/AiProviderSetup";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

/** Local inference reuses the same company-scoped connection setup as Apps. */
export function OnboardingLocalSetup({ companyId, agentId, environmentId, value, onChange }: {
  companyId: string;
  agentId?: string;
  environmentId?: string;
  value?: AiConnectionBinding;
  onChange: (binding: AiConnectionBinding) => void;
}) {
  const [open, setOpen] = useState(false);
  const accounts = useQuery({
    queryKey: ["ai-connections", companyId],
    queryFn: () => aiConnectionsApi.list(companyId),
  });
  const local = accounts.data?.connections.filter(account => account.companyId === companyId
    && account.routing?.kind === "local" && account.routing.protocol === "chat" && account.status === "connected") ?? [];
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">
      Run LM Studio on the Paperclip host, load a model that supports tool use, and start its local server.
      Install the selected agent CLI on the same host. No cloud account is required.
    </p>
    {accounts.isError && <p role="alert" className="text-sm text-destructive">
      Could not load local connections. <Button type="button" variant="ghost" onClick={() => void accounts.refetch()}>Retry</Button>
    </p>}
    {local.length > 0 && <label className="block space-y-2 text-sm">
      Local model connection
      <select aria-label="Local model connection" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value && value.mode !== "responsible_user" ? value.connectionId : ""}
        onChange={event => {
          const account = local.find(entry => entry.id === event.target.value);
          if (account) onChange({ provider: account.provider, method: account.method,
            mode: account.ownership === "shared" ? "shared" : "delegated", connectionId: account.id, grantId: account.grantId });
        }}>
        <option value="" disabled>Select a local connection</option>
        {local.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
    </label>}
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Connect LM Studio</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl" onKeyDown={event => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Local inference with LM Studio</DialogTitle>
          <DialogDescription>Save your local endpoint and model IDs, then test the connection with your agent.</DialogDescription>
        </DialogHeader>
        <AiProviderSetup companyId={companyId} agentId={agentId} environmentId={environmentId}
          initialProvider="local" initialProtocol="chat" providerLabel="LM Studio" submitLabel="Save connection"
          onCancel={() => setOpen(false)} onComplete={binding => { setOpen(false); onChange(binding); }} />
      </DialogContent>
    </Dialog>
  </div>;
}
