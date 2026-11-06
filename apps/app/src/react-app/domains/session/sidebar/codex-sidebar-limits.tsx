/** @jsxImportSource react */
import * as React from "react";
import { Bot, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { useChatGptAccountsStore, type QuotaWindow } from "@/react-app/domains/models/chatgpt-accounts-store";
import { useAntigravityAccountsStore } from "@/react-app/domains/models/antigravity-accounts-store";

function formatSecondsRemaining(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function QuotaBar({ label, window }: { label: string; window: QuotaWindow }) {
  const percent = Math.min(100, Math.max(0, window.usedPercent));
  const remainingSecs = Math.max(0, window.resetAfterSeconds);
  const resetLabel = formatSecondsRemaining(remainingSecs);

  // Color code: green < 70%, amber 70-89%, red >= 90%
  const barColor =
    percent >= 90
      ? "bg-rose-500"
      : percent >= 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="font-medium text-sidebar-foreground/80">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {percent}% • {resetLabel}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border/40">
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function CodexSidebarLimits() {
  const account = useChatGptAccountsStore((s) => s.account);
  const loading = useChatGptAccountsStore((s) => s.loading);
  const loadAccount = useChatGptAccountsStore((s) => s.loadAccount);
  const refreshQuotas = useChatGptAccountsStore((s) => s.refreshQuotas);
  const disconnect = useChatGptAccountsStore((s) => s.disconnect);
  const selectedModel = useAntigravityAccountsStore((s) => s.selectedModel);

  React.useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  if (!account) {
    return null;
  }

  // Only show limits if the active model belongs to OpenAI / ChatGPT / Codex
  const isCodexModel = selectedModel?.providerID === "openai";
  if (!isCodexModel) {
    return null;
  }

  const planType = account.planType || "free";
  const planLabel =
    planType === "plus"
      ? "Plus"
      : planType === "pro"
        ? "Pro"
        : planType === "api"
          ? "API Key"
          : "Free Tier";

  const badgeColor =
    planType === "plus"
      ? "bg-amber-500/10 text-amber-500 dark:text-amber-400"
      : planType === "pro"
        ? "bg-purple-500/10 text-purple-500 dark:text-purple-400"
        : planType === "api"
          ? "bg-sky-500/10 text-sky-500 dark:text-sky-400"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

  return (
    <div
      data-testid="sidebar-codex-limits"
      className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/70">
          ChatGPT / Codex
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void refreshQuotas();
            }}
            title="Refresh Codex quotas"
            aria-label="Refresh Codex quotas"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Disconnect ChatGPT / Codex account?")) {
                void disconnect();
              }
            }}
            title="Disconnect account"
            aria-label="Disconnect account"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      <div className="rounded-md border border-sidebar-border/50 bg-sidebar-accent/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Bot className="size-4 text-sky-500 shrink-0" />
            <span className="truncate font-medium text-sidebar-foreground">
              {account.email || "ChatGPT User"}
            </span>
          </div>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeColor}`}>
            {planLabel}
          </span>
        </div>

        {/* Paid Quota Windows: 5-Hour + Weekly Limit */}
        {(account.primaryWindow || account.secondaryWindow) && (
          <div className="mt-2.5 flex flex-col gap-2 pt-1 border-t border-sidebar-border/30">
            {account.primaryWindow && (
              <QuotaBar label="5-Hour Limit" window={account.primaryWindow} />
            )}
            {account.secondaryWindow && (
              <QuotaBar label="Weekly Limit" window={account.secondaryWindow} />
            )}
          </div>
        )}

        {/* Free Tier Monthly/Daily Allowance */}
        {planType === "free" && !account.primaryWindow && !account.secondaryWindow && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
            <span className="truncate">Free Local Message Allowance Active</span>
          </div>
        )}

        {/* API Key Mode */}
        {planType === "api" && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3 text-sky-500 shrink-0" />
            <span className="truncate">Direct API Key Active</span>
          </div>
        )}
      </div>
    </div>
  );
}
