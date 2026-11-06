/** @jsxImportSource react */
import * as React from "react";
import { RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { openDesktopUrl } from "@/app/lib/desktop";
import {
  formatQuotaResetShort,
  useAntigravityAccountsStore,
} from "@/react-app/domains/models/antigravity-accounts-store";
import { useWorkspace } from "@/react-app/shell/workspace-provider";

export function AntigravitySidebarLimits() {
  const workspace = useWorkspace();
  const accounts = useAntigravityAccountsStore((s) => s.accounts);
  const loading = useAntigravityAccountsStore((s) => s.loading);
  const selectedModel = useAntigravityAccountsStore((s) => s.selectedModel);

  React.useEffect(() => {
    void useAntigravityAccountsStore.getState().loadAccounts(workspace.client);
  }, [workspace.client]);

  if (accounts.length === 0) {
    return null;
  }

  // Only show limits if the active model is an Antigravity model (providerID === "google"),
  // and adapt to only show the account currently in use (or active account).
  const isAntigravityModel = selectedModel?.providerID === "google";
  if (!isAntigravityModel) {
    return null;
  }

  const activeAccount = accounts.find((a) => a.isActive) ?? accounts[0];
  const displayedAccounts = activeAccount ? [activeAccount] : accounts;

  const anyQuotaLoading = loading || displayedAccounts.some((a) => a.quotaLoading);

  return (
    <div
      data-testid="sidebar-antigravity-limits"
      className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/70">
          Account Limits
        </span>
        <button
          type="button"
          onClick={() => {
            void useAntigravityAccountsStore.getState().refreshQuotas();
          }}
          title="Refresh account limits"
          aria-label="Refresh account limits"
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <RefreshCw className={`size-3 ${anyQuotaLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        {displayedAccounts.map((acc) => (
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
                title={`${acc.email} (Antigravity)`}
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
                  (Antigravity)
                </span>
                {acc.verificationRequired ? (
                  <span className="shrink-0 rounded bg-rose-500/15 px-1 py-px text-[9px] font-semibold text-rose-400">
                    Verify
                  </span>
                ) : acc.isPlus ? (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase text-amber-400">
                    Plus
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  void useAntigravityAccountsStore
                    .getState()
                    .deleteAccount(acc.email, workspace.client)
                }
                title={`Remove ${acc.email}`}
                aria-label={`Remove ${acc.email}`}
                className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive cursor-pointer"
              >
                <Trash2 className="size-3" />
              </button>
            </div>

            {acc.verificationRequired ? (
              <div className="mt-1.5 flex flex-col gap-1 rounded bg-rose-500/10 p-2 border border-rose-500/30">
                <span className="text-[10px] text-rose-300 font-medium leading-tight">
                  Google requires account verification before this account can be used.
                </span>
                {acc.verificationUrl ? (
                  <button
                    type="button"
                    onClick={() => void openDesktopUrl(acc.verificationUrl!)}
                    className="flex items-center gap-1 text-[10px] text-primary underline text-left hover:text-primary/80 cursor-pointer font-medium mt-0.5"
                  >
                    <span>Open verification in browser</span>
                    <ExternalLink className="size-2.5" />
                  </button>
                ) : null}
              </div>
            ) : acc.quotas.length > 0 ? (
              <div className="mt-1.5 flex flex-col gap-1">
                {acc.quotas.map((q) => {
                  const pct = q.remainingFraction < 0.01 ? 0 : Math.round(q.remainingFraction * 100);
                  const resetShort = formatQuotaResetShort(q.resetTime);
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
                    <div key={q.family} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-1 text-[10px] leading-none">
                        <span className="truncate text-muted-foreground">{q.label}</span>
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
                })}
              </div>
            ) : (acc.quotaLoading || acc.quotas.length === 0) ? (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <RefreshCw className="size-2.5 animate-spin" />
                <span>Loading limits for {acc.email}...</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
