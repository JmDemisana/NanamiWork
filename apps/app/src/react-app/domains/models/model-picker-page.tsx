import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Pencil, Search, Sparkles, X } from "lucide-react";

import type { ModelOption, ModelRef } from "@/app/types";
import { markFeatureUsed } from "@/app/lib/den";
import { Button } from "@/components/ui/button";
import { ModelPickerPanel } from "@/react-app/domains/models/model-picker-panel";
import { ModelProviderLoginBar } from "@/react-app/domains/models/model-picker-list";
import { buildModelCatalog, resolveRetainedSelection, withoutBlockedSelection } from "@/react-app/domains/models/catalog";
import { useModelChoice } from "@/react-app/domains/models/use-model-catalog";
import { managesOwnBehavior, isAutoModel, type ModelPickerCatalogState } from "@/react-app/domains/models/model-catalog";
import { useSetWorkspaceDefaultModel } from "@/react-app/kernel/use-workspace-model-default";
import { useCheckDesktopRestriction } from "../cloud/desktop-config-provider";
import { useDenAuth } from "../cloud/den-auth-provider";
import { openAutoProviderSettings } from "../cloud/auto-access-ui";
import { openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
import { useAntigravityAccountsStore } from "@/react-app/domains/models/antigravity-accounts-store";
import { useChatGptAccountsStore } from "@/react-app/domains/models/chatgpt-accounts-store";
import { useCopilotAccountsStore } from "@/react-app/domains/models/copilot-accounts-store";
import { useModelCollectionsStore } from "@/react-app/domains/session/models/model-collections-store";
import type { ModelPickerModalProps } from "@/react-app/domains/session/modals/model-picker-modal";
import { LocalRouterSettingsDialog } from "./nanami-local-router-settings";
import {
  LOCAL_ROUTER_STRATEGIES,
  buildLocalRouterAccounts,
  localRouterSummary,
  recordLocalRouterUse,
  resolveLocalRouterChoice,
  useLocalRouterStore,
  type LocalRouterAccount,
} from "./nanami-local-router";

function RouterCard({
  accounts,
  onUse,
  onEdit,
  notice,
}: {
  accounts: readonly LocalRouterAccount[];
  onUse: () => void;
  onEdit: () => void;
  notice: string | null;
}) {
  const mode = useLocalRouterStore((state) => state.mode);
  const strategies = useLocalRouterStore((state) => state.strategies);
  const modelOrder = useLocalRouterStore((state) => state.modelOrder);
  const accountOrder = useLocalRouterStore((state) => state.accountOrder);
  const excludedAccounts = useLocalRouterStore((state) => state.excludedAccounts);
  const excludedModels = useLocalRouterStore((state) => state.excludedModels);
  const usage = useLocalRouterStore((state) => state.usage);
  const summary = localRouterSummary(accounts, { excludedAccounts, excludedModels });
  const strategyLabel = mode === "model" ? "Model order" : mode === "account" ? "Account order" : strategies
    .map((value) => LOCAL_ROUTER_STRATEGIES.find((entry) => entry.value === value)?.label)
    .filter(Boolean)
    .join(" → ") || "Round robin";
  const next = useMemo(
    () => resolveLocalRouterChoice(accounts, { mode, strategies, modelOrder, accountOrder, excludedAccounts, excludedModels, usage }),
    [accounts, mode, strategies, modelOrder, accountOrder, excludedAccounts, excludedModels, usage],
  );

  return <div className="rounded-xl border border-border bg-gradient-to-r from-muted/45 via-background to-background p-3" data-testid="nanami-local-router">
    <div className="flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dls-accent/30 bg-dls-accent/10 text-dls-accent">
        <Sparkles className="size-4" strokeWidth={1.5} />
      </div>
      <button type="button" onClick={onUse} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block truncate text-sm font-semibold">NanamiWorks Local Router</span>
        <span className="block truncate text-xs text-muted-foreground">
          Route Local Models · {strategyLabel} · {summary.accountCount} account{summary.accountCount === 1 ? "" : "s"} · {summary.modelCount} model{summary.modelCount === 1 ? "" : "s"}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
          {next ? mode === "priority" && strategies.includes("random") ? "A model will be picked when you route." : `Next: ${next.model.label} · ${next.account.label}` : summary.modelCount === 0 ? "No accounts or models are included yet." : "Every included model is out of quota right now."}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onEdit}
        aria-label="Edit local router settings"
        title="Edit local router settings"
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button type="button" size="sm" className="hidden shrink-0 sm:inline-flex" disabled={!next} onClick={onUse}>
        Route
      </Button>
    </div>
    {notice ? <p role="status" className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-500">{notice}</p> : null}
  </div>;
}

/**
 * The full-page model picker. The composer opens it instead of a popover: every
 * provider and model gets the whole window, search and "back to chat" sit in the
 * top bar, and account logins stay in the bottom bar.
 */
export function ModelPickerPage(props: ModelPickerModalProps) {
  const setWorkspaceDefault = useSetWorkspaceDefaultModel();
  const checkRestriction = useCheckDesktopRestriction();
  const auth = useDenAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [routerSettingsOpen, setRouterSettingsOpen] = useState(false);
  const [routerNotice, setRouterNotice] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const choice = useModelChoice(JSON.stringify([props.open, props.current, props.currentBehaviorValue]));
  const restrictToCloud = props.restrictToCloud || checkRestriction({ restriction: "allowCustomProviders" });
  const catalogState = props.catalogState ?? { state: "ready", onRetry: props.onRefreshOrganizationModels } satisfies ModelPickerCatalogState;
  const catalog = buildModelCatalog({
    runtime: [...(props.knownOptions ?? props.options)],
    signedIn: auth.isSignedIn,
    restrictToCloud,
    checkRestriction,
    disabledProviders: props.disabledProviders,
    gatewayProviderIds: props.gatewayProviderIds,
  });
  const retained = resolveRetainedSelection({
    current: props.current,
    catalog,
    saved: props.retainedSelection,
    signedIn: auth.isSignedIn,
    restrictToCloud,
    checkRestriction,
    catalogState: catalogState.state,
    sessionScoped: props.target === "session",
  });
  const options = withoutBlockedSelection(catalog.options, retained);
  const selected = options.find((option) => option.providerID === props.current.providerID && option.modelID === props.current.modelID && !option.disabled);
  const behaviorValue = props.currentBehaviorValue !== undefined ? props.currentBehaviorValue : selected?.behaviorValue ?? null;
  const autoVisible = retained?.reason !== "policy" && retained?.reason !== "disabled" && (options.some(isAutoModel) || isAutoModel(props.current));
  const antigravityAccounts = useAntigravityAccountsStore((state) => state.accounts);
  const chatGptAccounts = useChatGptAccountsStore((state) => state.accounts);
  const copilotAccounts = useCopilotAccountsStore((state) => state.accounts);
  const routerAccounts = useMemo(() => buildLocalRouterAccounts({
    antigravity: !restrictToCloud && !props.disabledProviders?.includes("google") ? antigravityAccounts : [],
    chatgpt: !restrictToCloud && !props.disabledProviders?.includes("openai") ? chatGptAccounts : [],
    copilot: !restrictToCloud && !props.disabledProviders?.includes("github-copilot") ? copilotAccounts : [],
    options,
  }), [antigravityAccounts, chatGptAccounts, copilotAccounts, options, restrictToCloud, props.disabledProviders]);
  const pendingProviders = props.gatewayConnectProviders?.filter((provider) => !provider.models?.length) ?? [];

  useEffect(() => {
    if (!props.open) return;
    props.setQuery("");
    setRouterNotice(null);
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || choice.loginOpen || routerSettingsOpen) return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose, choice.loginOpen, routerSettingsOpen]);

  const commit = (option: { providerID: string; modelID: string }, behavior?: { variant: string | null }) => {
    if (auth.isSignedIn) markFeatureUsed("localModelPicker");
    props.onSelect({ providerID: option.providerID, modelID: option.modelID });
    if (behavior) props.onBehaviorChange({ providerID: option.providerID, modelID: option.modelID }, behavior.variant);
    props.onClose();
  };

  const handleSelect = (option: ModelOption, behavior?: { variant: string | null }) => {
    if (option.providerID === "google" || option.providerID === "openai" || option.providerID === "github-copilot") {
      commit(option, behavior);
      return;
    }
    choice.choose(option, () => {
      if (auth.isSignedIn) markFeatureUsed("localModelPicker");
      props.onSelect({ providerID: option.providerID, modelID: option.modelID });
      if (behavior && !managesOwnBehavior(option)) props.onBehaviorChange({ providerID: option.providerID, modelID: option.modelID }, behavior.variant);
      props.onClose();
    });
  };

  const useRouter = async () => {
    if (routing) return;
    const state = useLocalRouterStore.getState();
    const next = resolveLocalRouterChoice(routerAccounts, state);
    if (!next) {
      const summary = localRouterSummary(routerAccounts, state);
      setRouterNotice(summary.modelCount === 0
        ? "No accounts or models are included. Open router settings to include some."
        : "Every included account is out of quota right now. Wait for a reset or include another account.");
      return;
    }
    setRouting(true);
    try {
      if (next.account.kind === "antigravity") {
        await useAntigravityAccountsStore.getState().selectAccount(next.account.accountID);
        useAntigravityAccountsStore.getState().setSelectedModel(next.ref);
      } else if (next.account.kind === "chatgpt") await useChatGptAccountsStore.getState().selectAccount(next.account.accountID);
      else if (next.account.kind === "copilot") await useCopilotAccountsStore.getState().selectAccount(next.account.accountID);
      recordLocalRouterUse(next.key);
      if (auth.isSignedIn) markFeatureUsed("localModelPicker");
      useModelCollectionsStore.getState().recordRecent(next.ref);
      props.onSelect(next.ref);
      props.onClose();
    } catch {
      setRouterNotice("Could not switch accounts. Try again or select a model directly.");
    } finally {
      setRouting(false);
    }
  };

  if (!props.open) return null;

  const close = () => props.onClose({ restorePromptFocus: true });

  return <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="model-picker-page">
    <header className="flex flex-col gap-2 border-b border-border bg-background/95 px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={close}>
          <ChevronLeft className="size-4" />
          <span>Chat</span>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Models</h1>
          <p className="truncate text-xs text-muted-foreground">{props.subtitle ?? "Choose a model for this conversation"}</p>
        </div>
      </div>
      <div className="relative flex min-w-0 flex-1 items-center sm:mx-2 sm:max-w-2xl">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          ref={searchInputRef}
          type="text"
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="Search models, providers, accounts..."
          aria-label="Search all models"
          className="h-9 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        {props.query ? (
          <button
            type="button"
            onClick={() => { props.setQuery(""); searchInputRef.current?.focus({ preventScroll: true }); }}
            className="absolute right-2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
            title="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <p className="hidden shrink-0 text-xs text-muted-foreground md:block">
        {options.filter((option) => !option.disabled).length} available
      </p>
    </header>

    <div className="mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col">
      <ModelPickerPanel
        chrome="page"
        query={props.query}
        onQueryChange={props.setQuery}
        searchInputRef={searchInputRef}
        leading={<RouterCard accounts={routerAccounts} onUse={useRouter} onEdit={() => setRouterSettingsOpen(true)} notice={routerNotice} />}
        options={options}
        current={props.current}
        behaviorValue={behaviorValue}
        onSelect={handleSelect}
        onBehaviorChange={(value) => props.onBehaviorChange(props.current, value)}
        catalogState={catalogState}
        retainedSelection={retained}
        onConnectProvider={!restrictToCloud ? () => { window.dispatchEvent(new Event(openWorkbenchInstancesEvent)); } : undefined}
        onConnectCodex={undefined}
        onOpenProviderSettings={!checkRestriction({ restriction: "allowControlSettings" }) ? () => { props.onClose({ restorePromptFocus: false }); (props.onOpenProviderSettings ?? openAutoProviderSettings)(); } : undefined}
        onSetWorkspaceDefault={props.onSetWorkspaceDefault ?? setWorkspaceDefault}
        openWorkModelsSyncing={props.openWorkModelsSyncing}
        autoVisible={autoVisible}
        onReloadWorkspace={props.onReloadWorkspace}
        onClose={close}
        footerExtra={pendingProviders.length ? <div className="border-t border-border p-1.5">{pendingProviders.map((provider) => <div key={`${provider.providerId}:${provider.name}`} className="flex h-9 items-center gap-2.5 px-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{provider.name}</span>
          <Button size="sm" variant="ghost" disabled={!props.onConnectGatewayProvider || props.disabledProviders?.includes(provider.providerId)} onClick={() => void props.onConnectGatewayProvider?.(provider)}>Login</Button>
        </div>)}</div> : null}
      />
    </div>

    <footer className="border-t border-border bg-background px-3 py-2 sm:px-4">
      <div className="mx-auto w-full max-w-[110rem]">
        <ModelProviderLoginBar
          onConnectProvider={!restrictToCloud ? () => { window.dispatchEvent(new Event(openWorkbenchInstancesEvent)); } : undefined}
          onClose={close}
          className="flex flex-col gap-2"
        />
      </div>
    </footer>

    <LocalRouterSettingsDialog open={routerSettingsOpen} onOpenChange={setRouterSettingsOpen} accounts={routerAccounts} />
  </div>;
}
