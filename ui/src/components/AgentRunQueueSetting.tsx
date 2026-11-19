import { effectiveMaxConcurrentAgentRuns, type DeploymentProfile } from "@paperclipai/shared";
import { cn } from "../lib/utils";

/** Preset limits offered in the UI; `null` = unlimited. */
const RUN_LIMIT_PRESETS: ReadonlyArray<number | null> = [1, 2, 4, 8, null];

const PROFILE_LABELS: Record<DeploymentProfile, string> = {
  standard: "Standard",
  local: "Local (host processes only)",
  local_only: "Local only (local models, no price metrics)",
};

/**
 * Instance-wide agent run queue (fork 31erGER). Lets the operator cap how
 * many agent runs execute at once so a single local model server is not
 * flooded with parallel requests. Extra runs wait in the queue.
 */
export function AgentRunQueueSetting({
  configured,
  profile,
  disabled,
  onChange,
}: {
  configured: number | null | undefined;
  profile: DeploymentProfile;
  disabled: boolean;
  onChange: (next: number | null) => void;
}) {
  const effective = effectiveMaxConcurrentAgentRuns(configured, profile);
  const usesProfileDefault = (configured ?? null) === null && effective !== null;

  return (
    <section>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">Agent run queue</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Limit how many agent runs execute at the same time across all companies. Further runs wait
            in the queue and start in arrival order when a slot is free. Use 1 when all agents share one
            local model server (llama.cpp, LM Studio).
          </p>
          <p className="text-xs text-muted-foreground">
            Deployment profile: {PROFILE_LABELS[profile]}
            {usesProfileDefault ? ` · profile default: ${effective} at a time` : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Maximum parallel agent runs">
          {RUN_LIMIT_PRESETS.map((preset) => {
            const active = (configured ?? null) === preset;
            return (
              <button
                key={preset ?? "unlimited"}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-foreground bg-accent text-foreground"
                    : "border-border bg-background hover:bg-accent/50",
                )}
                onClick={() => onChange(preset)}
              >
                <div className="text-sm font-medium">
                  {preset === null ? (profile === "local_only" ? "Profile default" : "Unlimited") : `${preset} at a time`}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
