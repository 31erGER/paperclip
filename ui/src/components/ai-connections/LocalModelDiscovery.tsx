import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { discoverLocalAiModelsSchema, type AiProviderRouting, type LocalAiModelDiscovery } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function LocalModelDiscovery({ companyId, baseUrl, protocol, auth, apiKey, selected, onChange, manual }: {
  companyId: string; baseUrl: string; protocol: AiProviderRouting["protocol"]; auth: AiProviderRouting["auth"];
  apiKey: string; selected: string[]; onChange: (ids: string[]) => void; manual: ReactNode;
}) {
  const id = useId();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [catalog, setCatalog] = useState<LocalAiModelDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    request.current?.abort();
    setCatalog(null); setError(null); setPending(false); setExpanded(false);
    onChange([]);
    return () => request.current?.abort();
  }, [companyId, baseUrl, protocol, auth, apiKey, onChange]);

  async function discover() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError(null);
    try {
      const input = discoverLocalAiModelsSchema.parse({ routing: { kind: "local", baseUrl, protocol, auth, models: [] }, ...(auth === "bearer" ? { apiKey } : {}) });
      const result = await aiConnectionsApi.discoverModels(companyId, input, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      setCatalog(result); setExpanded(true);
    } catch (cause) {
      if (request.current !== controller || controller.signal.aborted) return;
      setCatalog(null);
      setError(cause instanceof Error && cause.name !== "ZodError" ? cause.message : "Check the local provider URL and authentication fields.");
    } finally {
      if (request.current === controller && !controller.signal.aborted) setPending(false);
    }
  }

  return <div className="space-y-3">
    <Button type="button" variant="outline" disabled={pending || !baseUrl.trim() || (auth === "bearer" && !apiKey.trim())} onClick={() => void discover()}>
      {pending ? "Loading models…" : "Test connection and load models"}
    </Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {catalog && <>
      <p role="status" className="text-sm text-muted-foreground">
        {catalog.models.length ? `Connection successful. ${catalog.models.length} models available.` : "Connection successful. No models were returned. Load a model in your server or enter its ID manually."}
      </p>
      {catalog.models.length > 0 && <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">Choose models ({selected.length} selected)</summary>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
          {catalog.models.map((model, index) => <label key={model.id} htmlFor={`${id}-${index}`} className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox id={`${id}-${index}`} aria-label={model.id} checked={selected.includes(model.id)} onCheckedChange={checked => onChange(checked === true ? [...new Set([...selected, model.id])] : selected.filter(value => value !== model.id))} />
            <span className="min-w-0 break-all">{model.label ?? model.id}{model.label && model.label !== model.id && <span className="block text-xs text-muted-foreground">{model.id}</span>}</span>
          </label>)}
        </div>
        <p className="text-xs text-muted-foreground">Choose a chat model with tool support. Listing a model does not test its inference capabilities.</p>
      </details>}
    </>}
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm text-muted-foreground">Enter model IDs manually</summary>
      {manual}
    </details>
  </div>;
}
