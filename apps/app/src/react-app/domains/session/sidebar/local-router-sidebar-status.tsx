/** @jsxImportSource react */
import * as React from "react";
import type { ModelOption } from "@/app/types";
import { hasLocalRouterRouting, useLocalRouterStore } from "@/react-app/domains/models/nanami-local-router";
import { useAntigravityAccountsStore } from "@/react-app/domains/models/antigravity-accounts-store";
import { useChatGptAccountsStore } from "@/react-app/domains/models/chatgpt-accounts-store";
import { useCopilotAccountsStore } from "@/react-app/domains/models/copilot-accounts-store";
import { useModelPickerCatalogStore } from "@/react-app/domains/session/models/model-collections-store";

const EMPTY_OPTIONS: readonly ModelOption[] = [];

export function LocalRouterSidebarStatus({ sessionId }: { sessionId: string | null }) {
  const mode = useLocalRouterStore((state) => state.mode);
  const strategies = useLocalRouterStore((state) => state.strategies);
  const usage = useLocalRouterStore((state) => state.usage);
  const antigravityAccounts = useAntigravityAccountsStore((state) => state.accounts);
  const chatgptAccounts = useChatGptAccountsStore((state) => state.accounts);
  const copilotAccounts = useCopilotAccountsStore((state) => state.accounts);
  const options = useModelPickerCatalogStore((state) => sessionId ? state.bySession[sessionId]?.options : undefined) ?? EMPTY_OPTIONS;

  if (!hasLocalRouterRouting({ mode, strategies })) return null;

  const latest = Object.entries(usage).reduce<[string, number] | null>((current, [key, value]) =>
    !current || value.lastUsedAt > current[1] ? [key, value.lastUsedAt] : current, null);
  let accountLabel = "Not used yet";
  let modelLabel = "Not used yet";
  if (latest) {
    const separator = latest[0].lastIndexOf("|");
    if (separator >= 0) {
      const accountKey = latest[0].slice(0, separator);
      const modelKey = latest[0].slice(separator + 1);
      const accountSeparator = accountKey.indexOf(":");
      const providerID = accountSeparator >= 0 ? accountKey.slice(0, accountSeparator) : accountKey;
      const accountID = accountSeparator >= 0 ? accountKey.slice(accountSeparator + 1) : accountKey;
      const modelID = modelKey.startsWith(`${providerID}:`) ? modelKey.slice(providerID.length + 1) : modelKey;

      if (providerID === "google") {
        const account = antigravityAccounts.find((entry) => entry.email === accountID);
        accountLabel = account?.email ?? accountID;
        modelLabel = account?.models.find((model) => model.modelID === modelID)?.displayName ?? modelID;
      } else if (providerID === "openai") {
        const account = chatgptAccounts.find((entry) => entry.email === accountID);
        accountLabel = account?.email ?? accountID;
        modelLabel = account?.models.find((model) => model.modelID === modelID)?.displayName ?? modelID;
      } else if (providerID === "github-copilot") {
        const account = copilotAccounts.find((entry) => entry.username === accountID);
        accountLabel = account ? `@${account.username}` : `@${accountID}`;
        modelLabel = account?.models.find((model) => model.modelID === modelID)?.displayName ?? modelID;
      } else {
        const option = options.find((entry) => entry.providerID === providerID && entry.modelID === modelID);
        accountLabel = option?.description?.trim() || providerID;
        modelLabel = option?.title || modelID;
      }
    }
  }

  return (
    <div data-testid="sidebar-local-router-status" className="border-t border-sidebar-border/60 px-2.5 py-2 text-xs group-data-[collapsible=icon]:hidden">
      <div className="mb-1.5 text-[11px] font-medium tracking-tight text-sidebar-foreground/70">Local Router</div>
      <div className="flex flex-col gap-1 text-[10px] leading-tight">
        <div className="flex min-w-0 gap-1.5">
          <span className="shrink-0 text-muted-foreground">Account:</span>
          <span className="truncate text-sidebar-foreground" title={accountLabel}>{accountLabel}</span>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <span className="shrink-0 text-muted-foreground">Model:</span>
          <span className="truncate text-sidebar-foreground" title={modelLabel}>{modelLabel}</span>
        </div>
      </div>
    </div>
  );
}
