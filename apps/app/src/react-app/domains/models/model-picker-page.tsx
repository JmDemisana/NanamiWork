import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Pencil, Search, Sparkles, X } from "lucide-react";

import type { ModelOption, ModelRef } from "@/app/types";
import { markFeatureUsed } from "@/app/lib/den";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ModelPickerPanel } from "@/react-app/domains/models/model-picker-panel";
import { ModelProviderLoginBar } from "@/react-app/domains/models/model-picker-list";
import { buildModelCatalog, resolveRetainedSelection, runtimeModelOptions, withoutBlockedSelection } from "@/react-app/domains/models/catalog";
import { useProviderListQuery, getConnectedProviderItems } from "@/react-app/infra/provider-list-query";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
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
import { LocalRouterSettingsPage } from "./nanami-local-router-settings";
import { useModelPickerPageHost } from "./model-picker-page-host";
import {
  buildLocalRouterAccounts,
  localRouterSummary,
  recordLocalRouterUse,
  resolveLocalRouterChoice,
  useLocalRouterStore,
  type LocalRouterCandidate,
} from "./nanami-local-router";

function RouterRow({
  onUse,
  onEdit,
  notice,
}: {
  onUse: () => void;
  onEdit: () => void;
  notice: string | null;
}) {
  return <div data-testid="nanami-local-router">
    <div className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
      <div className="flex size-4 shrink-0 items-center justify-center text-dls-accent">
        <Sparkles className="size-4" strokeWidth={1.5} />
      </div>
      <button type="button" onClick={onUse} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block truncate">NanamiWorks Local Router</span>
        <span className="block truncate text-xs text-muted-foreground">Route Local Models</span>
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
    </div>
    {notice ? <p role="status" className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-500">{notice}</p> : null}
  </div>;
}

/**
 * The full-page model picker. The composer opens it instead of a popover: every
 * provider and model gets the whole window, search and "back to chat" sit in the
 * top bar, and account logins stay in the bottom bar.
 */
export function ModelPickerPage(props: ModelPickerModalProps & {
  onSelectWithBehavior?: (model: ModelRef, behavior?: { variant: string | null }) => void;
  fallbackBehaviorOptions?: readonly { value: string | null; label: string }[];
}) {
  const setWorkspaceDefault = useSetWorkspaceDefaultModel();
  const checkRestriction = useCheckDesktopRestriction();
  const auth = useDenAuth();
  const workspace = useWorkspace();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageHost = useModelPickerPageHost();
  const host = pageHost?.host;
  const setPageActive = pageHost?.setActive;
  const [routerSettingsOpen, setRouterSettingsOpen] = useState(false);
  const [routerNotice, setRouterNotice] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const [pinTarget, setPinTarget] = useState<LocalRouterCandidate | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinChecking, setPinChecking] = useState(false);
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
  const providerList = useProviderListQuery({
    client: workspace.client,
    baseUrl: workspace.opencodeBaseUrl,
    directory: workspace.selectedWorkspaceRoot || undefined,
    enabled: props.open && Boolean(workspace.client),
    showSavedWhileLoading: true,
  });
  const routerRuntime = useMemo(() => {
    if (!providerList.data?.all) return null;
    const connected = new Set(getConnectedProviderItems(providerList.data).map((provider) => provider.id));
    return runtimeModelOptions(providerList.data, undefined, true).filter((option) => connected.has(option.providerID));
  }, [providerList.data]);
  const routerCatalog = buildModelCatalog({
    runtime: routerRuntime,
    fallback: [...(props.knownOptions ?? props.options)],
    signedIn: auth.isSignedIn,
    restrictToCloud,
    checkRestriction,
    disabledProviders: props.disabledProviders,
    gatewayProviderIds: props.gatewayProviderIds,
  });
  const routerOptions = withoutBlockedSelection(routerCatalog.options, retained);
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
    options: routerOptions,
  }), [antigravityAccounts, chatGptAccounts, copilotAccounts, routerOptions, restrictToCloud, props.disabledProviders]);
  const pendingProviders = props.gatewayConnectProviders?.filter((provider) => !provider.models?.length) ?? [];

  useLayoutEffect(() => {
    if (!props.open || !host || !setPageActive) return;
    setPageActive(true);
    return () => setPageActive(false);
  }, [props.open, host, setPageActive]);

  useEffect(() => {
    if (!props.open || !host) return;
    props.setQuery("");
    setRouterNotice(null);
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [props.open, host]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || choice.loginOpen || pinTarget) return;
      event.preventDefault();
      if (routerSettingsOpen) setRouterSettingsOpen(false);
      else props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose, choice.loginOpen, routerSettingsOpen, pinTarget]);

  const commit = (option: { providerID: string; modelID: string }, behavior?: { variant: string | null }) => {
    if (auth.isSignedIn) markFeatureUsed("localModelPicker");
    const model = { providerID: option.providerID, modelID: option.modelID };
    if (props.onSelectWithBehavior) props.onSelectWithBehavior(model, behavior);
    else {
      props.onSelect(model);
      if (behavior) props.onBehaviorChange(model, behavior.variant);
    }
    props.onClose();
  };

  const handleSelect = (option: ModelOption, behavior?: { variant: string | null }) => {
    if (option.providerID === "google" || option.providerID === "openai" || option.providerID === "github-copilot") {
      commit(option, behavior);
      return;
    }
    choice.choose(option, () => {
      commit(option, managesOwnBehavior(option) ? undefined : behavior);
    });
  };

  const commitRouted = (next: LocalRouterCandidate) => {
    recordLocalRouterUse(next.key);
    useModelCollectionsStore.getState().recordRecent(next.ref);
    commit(next.ref);
  };

  const useRouter = async () => {
    if (routing) return;
    const state = useLocalRouterStore.getState();
    const next = resolveLocalRouterChoice(routerAccounts, state);
    if (!next) {
      if (state.mode === "priority" && state.strategies.length === 0) {
        setRouterNotice("Choose a routing priority in router settings first.");
        return;
      }
      const summary = localRouterSummary(routerAccounts, state);
      setRouterNotice(summary.modelCount === 0
        ? "No accounts or models are included. Open router settings to include some."
        : "Every included account is out of quota right now. Wait for a reset or include another account.");
      return;
    }
    if (next.ref.providerID === "nanami") {
      setPin("");
      setPinError(null);
      setPinTarget(next);
      return;
    }
    if (next.account.kind === "local") {
      const option = routerOptions.find((item) => item.providerID === next.ref.providerID && item.modelID === next.ref.modelID && !item.disabled);
      if (!option) {
        setRouterNotice("That model is no longer available. Refresh the model list and try again.");
        return;
      }
      choice.choose(option, () => commitRouted(next));
      return;
    }
    setRouting(true);
    try {
      if (next.account.kind === "antigravity") {
        await useAntigravityAccountsStore.getState().selectAccount(next.account.accountID);
        useAntigravityAccountsStore.getState().setSelectedModel(next.ref);
      } else if (next.account.kind === "chatgpt") await useChatGptAccountsStore.getState().selectAccount(next.account.accountID);
      else if (next.account.kind === "copilot") await useCopilotAccountsStore.getState().selectAccount(next.account.accountID);
      commitRouted(next);
    } catch {
      setRouterNotice("Could not switch accounts. Try again or select a model directly.");
    } finally {
      setRouting(false);
    }
  };

  const confirmRouterPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pinTarget || pinChecking) return;
    if (!pin.trim()) {
      setPinError("Enter the Gate PIN.");
      return;
    }
    setPinChecking(true);
    setPinError(null);
    try {
      const response = await fetch("https://nanami-ai.pages.dev/api/shared-chats", {
        method: "GET",
        headers: { "x-nanami-gate-pin": pin.trim() },
      });
      if (!response.ok) {
        setPinError("Incorrect Gate PIN. Try again.");
        return;
      }
      const next = pinTarget;
      setPinTarget(null);
      setPin("");
      commitRouted(next);
    } catch {
      setPinError("Could not reach Nanami gate server. Check your connection.");
    } finally {
      setPinChecking(false);
    }
  };

  if (!props.open || !host) return null;

  const close = () => props.onClose({ restorePromptFocus: true });

  return createPortal(<div className="flex h-full min-h-0 flex-col bg-dls-surface" data-testid="model-picker-page">
    {routerSettingsOpen ? <LocalRouterSettingsPage accounts={routerAccounts} onBack={() => setRouterSettingsOpen(false)} /> : <>
    <header className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={close}>
          <ChevronLeft className="size-4" />
          <span>Chat</span>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Models</h1>
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
        leading={!props.query.trim() || "nanamiworks local router route local models".includes(props.query.trim().toLowerCase())
          ? <RouterRow onUse={useRouter} onEdit={() => setRouterSettingsOpen(true)} notice={routerNotice} /> : null}
        options={options}
        current={props.current}
        behaviorValue={behaviorValue}
        fallbackBehaviorOptions={props.fallbackBehaviorOptions}
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

    <footer className="shrink-0 border-t border-border px-4 py-2 sm:px-5">
      <div className="mx-auto w-full max-w-[110rem]">
        <ModelProviderLoginBar
          onConnectProvider={!restrictToCloud ? () => { window.dispatchEvent(new Event(openWorkbenchInstancesEvent)); } : undefined}
          onClose={close}
          className="flex flex-col gap-2"
        />
      </div>
    </footer>
    </>}
    <Dialog open={Boolean(pinTarget)} onOpenChange={(open) => { if (!open && !pinChecking) { setPinTarget(null); setPin(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Nanami Gate PIN required</DialogTitle>
        <DialogDescription>Enter the PIN to route to {pinTarget?.model.label}.</DialogDescription>
        <form onSubmit={confirmRouterPin} className="flex flex-col gap-3">
          <input autoFocus type="password" value={pin} onChange={(event) => { setPin(event.target.value); setPinError(null); }}
            disabled={pinChecking} aria-label="Gate PIN" className="h-10 rounded-md border border-border bg-background px-3 text-sm" />
          {pinError ? <p role="alert" className="text-xs text-destructive">{pinError}</p> : null}
          <Button type="submit" disabled={pinChecking}>{pinChecking ? "Verifying…" : "Unlock and route"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>, host);
}
