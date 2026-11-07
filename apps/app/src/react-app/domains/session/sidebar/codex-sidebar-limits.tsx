/** @jsxImportSource react */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import {
  formatQuotaResetShort,
  useAntigravityAccountsStore,
} from "@/react-app/domains/models/antigravity-accounts-store";
import {
  useChatGptAccountsStore,
  type QuotaWindow,
} from "@/react-app/domains/models/chatgpt-accounts-store";
import { useWorkspace } from "@/react-app/shell/workspace-provider";

function RemainingQuotaBar({ label, window }: { label: string; window: QuotaWindow }) {
  const pct = Math.min(100, Math.max(0, Math.round(window.remainingPercent ?? 100 - window.usedPercent)));
  const resetShort = formatQuotaResetShort(window.resetTimeIso);
  const barColor =
    pct <= 0
      ? "bg-rose-500/70"
      : pct <= 20
        ? "bg-amber-500/80"
        : "bg-emerald-500/80";
  const textColor =
    pct <= 0
      ? "text-rose-400"
      : pct <= 20
        ? "text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className={`shrink-0 tabular-nums ${textColor}`}>
          {pct}%{resetShort ? ` · ${resetShort}` : ""}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-sidebar-border/60">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function CodexSidebarLimits() {
  const workspace = useWorkspace();
  const accounts = useChatGptAccountsStore((s) => s.accounts);
  const loading = useChatGptAccountsStore((s) => s.loading);
  const loadAccounts = useChatGptAccountsStore((s) => s.loadAccounts);
  const refreshQuotas = useChatGptAccountsStore((s) => s.refreshQuotas);
  const selectedModel = useAntigravityAccountsStore((s) => s.selectedModel);

  React.useEffect(() => {
    void loadAccounts(workspace.client);
  }, [loadAccounts, workspace.client]);

  if (accounts.length === 0) {
    return null;
  }

  // Only show limits if the active model is a ChatGPT / OpenAI model (providerID === "openai")
  const isCodexModel = selectedModel?.providerID === "openai";
  if (!isCodexModel) {
    return null;
  }

  const activeAccount = accounts.find((a) => a.isActive) ?? accounts[0];
  const displayedAccounts = activeAccount ? [activeAccount] : accounts;
  const anyQuotaLoading = loading || displayedAccounts.some((a) => a.quotaLoading);

  return (
    <div
      data-testid="sidebar-codex-limits"
      className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/70">
          Account Limits
        </span>
        <button
          type="button"
          onClick={() => {
            void refreshQuotas(activeAccount?.email);
          }}
          title="Refresh account limits"
          aria-label="Refresh account limits"
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <RefreshCw className={`size-3 ${anyQuotaLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        {displayedAccounts.map((acc) => {
          const primaryLabel =
            acc.planType === "free" ? "Monthly Limit" : "5-Hour Limit";
          const secondaryLabel = "Weekly Limit";

          return (
            <div
              key={acc.email}
              className={`rounded-lg border px-2 py-1.5 transition-colors ${
                acc.isActive
                  ? "border-sidebar-border bg-sidebar-accent/40 cursor-default select-none"
                  : "border-sidebar-border/50 bg-transparent cursor-default select-none"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-default select-none"
                  title={`${acc.email} (ChatGPT)`}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      acc.isActive ? "bg-emerald-400" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="truncate text-[11px] font-medium text-sidebar-foreground">
                    {acc.email}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    (ChatGPT)
                  </span>
                </div>
              </div>

              {acc.primaryWindow || acc.secondaryWindow ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  {acc.primaryWindow ? (
                    <RemainingQuotaBar label={primaryLabel} window={acc.primaryWindow} />
                  ) : null}
                  {acc.secondaryWindow ? (
                    <RemainingQuotaBar label={secondaryLabel} window={acc.secondaryWindow} />
                  ) : null}
                </div>
              ) : acc.quotaLoading ? (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  <RefreshCw className="size-2.5 animate-spin" />
                  <span>Loading limits for {acc.email}...</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
