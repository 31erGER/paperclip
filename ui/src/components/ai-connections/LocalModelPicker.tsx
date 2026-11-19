import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { aiConnectionsApi } from "@/api/ai-connections";
import { describeError } from "@/api/errors";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";

/** Comma-separated model IDs, as the connection form stores them. */
function parseIds(value: string): string[] {
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

/** Wait until typing pauses before asking the server again. */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * Fork 31erGER: pick model IDs from a local model server (LM Studio,
 * llama.cpp) instead of typing them. The Paperclip server asks the model
 * server, because "localhost" means the host where agents run, not the
 * browser's machine.
 */
export function LocalModelPicker({
  companyId,
  baseUrl,
  apiKey,
  value,
  onChange,
  disabled,
}: {
  companyId: string;
  baseUrl: string;
  apiKey?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const settledUrl = useSettled(baseUrl.trim(), 500);
  const settledKey = useSettled(apiKey?.trim() ?? "", 500);
  const discovery = useQuery({
    queryKey: ["local-model-discovery", companyId, settledUrl, settledKey],
    queryFn: () => aiConnectionsApi.discoverLocalModels(companyId, {
      baseUrl: settledUrl,
      ...(settledKey ? { apiKey: settledKey } : {}),
    }),
    enabled: Boolean(settledUrl) && !disabled,
    retry: false,
    staleTime: 0,
  });
  const selected = parseIds(value);
  const models = discovery.data?.models ?? [];

  // Preselect once per server: the loaded models, or the only model there is.
  const preselectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!discovery.data || preselectedFor.current === discovery.data.baseUrl) return;
    preselectedFor.current = discovery.data.baseUrl;
    if (parseIds(value).length > 0) return;
    const loaded = discovery.data.models.filter((model) => model.loaded).map((model) => model.id);
    const initial = loaded.length > 0 ? loaded : discovery.data.models.length === 1 ? [discovery.data.models[0]!.id] : [];
    if (initial.length > 0) onChange(initial.join(", "));
  }, [discovery.data, value, onChange]);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selected.filter((entry) => entry !== id), id] : selected.filter((entry) => entry !== id);
    onChange(next.join(", "));
  };

  return (
    <div className="space-y-2" data-testid="local-model-picker">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Models on the server</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !settledUrl || discovery.isFetching}
          onClick={() => void discovery.refetch()}
        >
          {discovery.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Reload models
        </Button>
      </div>
      {discovery.isFetching && !discovery.data ? (
        <p role="status" className="text-sm text-muted-foreground">Loading models from {settledUrl}…</p>
      ) : discovery.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(discovery.error).body}</p>
      ) : discovery.data && models.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          The server lists no models. Download or load a model in LM Studio (or start llama-server with -m), then reload.
        </p>
      ) : models.length > 0 ? (
        <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2" aria-label="Available models">
          {models.map((model) => {
            const checked = selected.includes(model.id);
            const inputId = `local-model-${model.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
            return (
              <li key={model.id} className="flex items-center gap-2">
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(state) => toggle(model.id, state === true)}
                  aria-label={model.id}
                />
                <label htmlFor={inputId} className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                  {model.id}
                </label>
                {model.loaded ? <Badge variant="secondary">loaded</Badge> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
