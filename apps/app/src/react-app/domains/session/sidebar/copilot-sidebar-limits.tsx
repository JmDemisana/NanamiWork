/** @jsxImportSource react */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useCopilotAccountsStore } from "@/react-app/domains/models/copilot-accounts-store";
import {
  formatQuotaResetShort,
  useAntigravityAccountsStore,
} from "@/react-app/domains/models/antigravity-accounts-store";
import { useWorkspace } from "@/react-app/shell/workspace-provider";

function CopilotMonthlyQuotaBar({
  pct,
  resetTimeIso,
}: {
  pct: number;
  resetTimeIso: string | null | undefined;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const resetShort = formatQuotaResetShort(resetTimeIso ?? null);
  const barColor =
    clamped <= 0
      ? "bg-rose-500/70"
      : clamped <= 20
        ? "bg-amber-500/80"
        : "bg-emerald-500/80";
  const textColor =
    clamped <= 0
      ? "text-rose-400"
      : clamped <= 20
        ? "text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
        <span className="truncate text-muted-foreground">Monthly Limit</span>
        <span className={`shrink-0 tabular-nums ${textColor}`}>
          {clamped}%{resetShort ? ` · ${resetShort}` : ""}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-sidebar-border/60">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(clamped, clamped > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function CopilotSidebarLimits() {
  const workspace = useWorkspace();
  const accounts = useCopilotAccountsStore((s) => s.accounts);
  const loading = useCopilotAccountsStore((s) => s.loading);
  const loadAccounts = useCopilotAccountsStore((s) => s.loadAccounts);
  const refreshCopilotToken = useCopilotAccountsStore((s) => s.refreshCopilotToken);
  const selectedModel = useAntigravityAccountsStore((s) => s.selectedModel);

  React.useEffect(() => {
    void loadAccounts(workspace.client);
  }, [loadAccounts, workspace.client]);

  if (accounts.length === 0) {
    return null;
  }

  // Only show limits if the active model belongs to GitHub Copilot
  const isCopilotModel = selectedModel?.providerID === "github-copilot";
  if (!isCopilotModel) {
    return null;
  }

  const activeAccount = accounts.find((a) => a.isActive) ?? accounts[0];
  const displayedAccounts = activeAccount ? [activeAccount] : accounts;
  const anyQuotaLoading = loading || displayedAccounts.some((a) => a.loading);

  return (
    <div
      data-testid="sidebar-copilot-limits"
      className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/70">
          Account Limits
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void refreshCopilotToken(activeAccount?.username);
            }}
            title="Refresh account limits"
            aria-label="Refresh account limits"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer"
          >
            <RefreshCw className={`size-3 ${anyQuotaLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        {displayedAccounts.map((acc) => {
          return (
            <div
              key={acc.username}
              className={`rounded-lg border px-2 py-1.5 transition-colors ${
                acc.isActive
                  ? "border-sidebar-border bg-sidebar-accent/40 cursor-default select-none"
                  : "border-sidebar-border/50 bg-transparent cursor-default select-none"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-default select-none"
                  title={`@${acc.username} (Copilot)`}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      acc.isActive ? "bg-emerald-400" : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="truncate text-[11px] font-medium text-sidebar-foreground">
                    @{acc.username}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    (Copilot)
                  </span>
                </div>
              </div>

              {typeof acc.quotaRemainingPct === "number" ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  <CopilotMonthlyQuotaBar
                    pct={acc.quotaRemainingPct}
                    resetTimeIso={acc.quotaResetTimeIso}
                  />
                </div>
              ) : acc.loading ? (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                  <RefreshCw className="size-2.5 animate-spin" />
                  <span>Loading limits for @{acc.username}...</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
