/** @jsxImportSource react */
import * as React from "react";
import { Bot, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { useCopilotAccountsStore } from "@/react-app/domains/models/copilot-accounts-store";
import { useAntigravityAccountsStore } from "@/react-app/domains/models/antigravity-accounts-store";

export function CopilotSidebarLimits() {
  const account = useCopilotAccountsStore((s) => s.account);
  const loading = useCopilotAccountsStore((s) => s.loading);
  const loadAccount = useCopilotAccountsStore((s) => s.loadAccount);
  const refreshCopilotToken = useCopilotAccountsStore((s) => s.refreshCopilotToken);
  const disconnect = useCopilotAccountsStore((s) => s.disconnect);
  const selectedModel = useAntigravityAccountsStore((s) => s.selectedModel);

  React.useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  if (!account) {
    return null;
  }

  // Only show limits if the active model belongs to GitHub Copilot
  const isCopilotModel = selectedModel?.providerID === "github-copilot";
  if (!isCopilotModel) {
    return null;
  }

  const skuLabel = account.planSku
    ? account.planSku.charAt(0).toUpperCase() + account.planSku.slice(1)
    : "Active";

  return (
    <div
      data-testid="sidebar-copilot-limits"
      className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden"
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/70">
          Copilot Account
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              void refreshCopilotToken();
            }}
            title="Refresh Copilot session token"
            aria-label="Refresh Copilot session token"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Disconnect GitHub Copilot account @${account.username}?`)) {
                void disconnect();
              }
            }}
            title="Disconnect Copilot account"
            aria-label="Disconnect Copilot account"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      <div className="rounded-md border border-sidebar-border/50 bg-sidebar-accent/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt={account.username}
                className="size-4 rounded-full"
              />
            ) : (
              <Bot className="size-4 text-emerald-500 shrink-0" />
            )}
            <span className="truncate font-medium text-sidebar-foreground">
              @{account.username}
            </span>
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            {skuLabel}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
          <span className="truncate">Copilot Fusion Active (VS Code Bridge)</span>
        </div>
      </div>
    </div>
  );
}
