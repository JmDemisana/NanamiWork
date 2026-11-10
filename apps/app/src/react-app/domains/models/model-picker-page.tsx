import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, Pencil, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

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
import type { ModelPickerModalProps } from "@/react-app/domains/session/modals/model-picker-modal";
import { LocalRouterSettingsPage } from "./nanami-local-router-settings";
import { useModelPickerPageHost } from "./model-picker-page-host";
import {
  buildLocalRouterAccounts,
  hasLocalRouterRouting,
  localRouterSummary,
  resolveLocalRouterChoice,
  useLocalRouterStore,
} from "./nanami-local-router";
import { isLocalRouterModel, LOCAL_ROUTER_MODEL, LOCAL_ROUTER_TITLE } from "@/app/lib/local-router-ref";

function RouterRow({
  onUse,
  onEdit,
  notice,
  needsRouting,
  selected,
}: {
  onUse: () => void;
  onEdit: () => void;
  notice: string | null;
  needsRouting: boolean;
  selected: boolean;
}) {
  return <div data-testid="nanami-local-router">
    <div className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
      <span className="size-4 shrink-0" aria-hidden="true" />
      <button type="button" onClick={onUse} disabled={needsRouting} title={needsRouting ? "Choose a routing strategy in settings first." : undefined} className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60">
        <span className="block truncate">{LOCAL_ROUTER_TITLE}</span>
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
      {selected ? <Check aria-label="Current model" className="size-4 shrink-0" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
    </div>
    {needsRouting || notice ? <p role="status" className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-500">{needsRouting ? "Choose a routing strategy in settings first." : notice}</p> : null}
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageHost = useModelPickerPageHost();
  const host = pageHost?.host;
  const setPageActive = pageHost?.setActive;
  const [routerSettingsOpen, setRouterSettingsOpen] = useState(false);
  const [routerNotice, setRouterNotice] = useState<string | null>(null);
  const routerMode = useLocalRouterStore((state) => state.mode);
  const routerStrategies = useLocalRouterStore((state) => state.strategies);
  const needsRouting = !hasLocalRouterRouting({ mode: routerMode, strategies: routerStrategies });
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
  // The router must offer the same selectable provider models as the picker,
  // not hidden raw provider aliases or synthetic tier variants.
  const routerOptions = options;
  const selected = options.find((option) => option.providerID === props.current.providerID && option.modelID === props.current.modelID && !option.disabled);
  const behaviorValue = props.currentBehaviorValue !== undefined ? props.currentBehaviorValue : selected?.behaviorValue ?? null;
  const autoVisible = retained?.reason !== "policy" && retained?.reason !== "disabled" && (options.some(isAutoModel) || isAutoModel(props.current));
  const antigravityAccounts = useAntigravityAccountsStore((state) => state.accounts);
  const thinkingTier = useAntigravityAccountsStore((state) => state.thinkingTier);
  const chatGptAccounts = useChatGptAccountsStore((state) => state.accounts);
  const copilotAccounts = useCopilotAccountsStore((state) => state.accounts);
  const routerAccounts = useMemo(() => buildLocalRouterAccounts({
    antigravity: antigravityAccounts,
    chatgpt: chatGptAccounts,
    copilot: copilotAccounts,
    options: routerOptions,
    thinkingTier,
    disabledProviders: props.disabledProviders,
    restrictToCloud,
  }), [antigravityAccounts, chatGptAccounts, copilotAccounts, routerOptions, thinkingTier, restrictToCloud, props.disabledProviders]);
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
      if (event.key !== "Escape" || choice.loginOpen) return;
      event.preventDefault();
      if (routerSettingsOpen) setRouterSettingsOpen(false);
      else props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose, choice.loginOpen, routerSettingsOpen]);

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

  const useRouter = () => {
    const state = useLocalRouterStore.getState();
    const next = resolveLocalRouterChoice(routerAccounts, state);
    if (!next) {
      if (!hasLocalRouterRouting(state)) {
        setRouterNotice("Choose a routing strategy in router settings first.");
        return;
      }
      const summary = localRouterSummary(routerAccounts, state);
      const available = localRouterSummary(routerAccounts.filter((account) => !account.unavailableReason), state);
      setRouterNotice(summary.modelCount === 0
        ? "No accounts or models are included. Open router settings to include some."
        : available.modelCount === 0
          ? "Included accounts are unavailable. Check provider policy, settings, or account verification."
        : "Every included account is out of quota right now. Wait for a reset or include another account.");
      return;
    }
    commit(LOCAL_ROUTER_MODEL, { variant: null });
  };

  if (!props.open || !host) return null;

  const close = () => props.onClose({ restorePromptFocus: true });

  return createPortal(
    <motion.div
      initial={{ opacity: 0, scale: 0.99, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.99, y: 6 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="flex h-full min-h-0 flex-col bg-dls-surface"
      data-testid="model-picker-page"
    >
      <AnimatePresence mode="wait">
        {routerSettingsOpen ? (
          <motion.div
            key="router-settings"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="flex h-full min-h-0 flex-col"
          >
            <LocalRouterSettingsPage accounts={routerAccounts} onBack={() => setRouterSettingsOpen(false)} />
          </motion.div>
        ) : (
          <motion.div
            key="model-picker-main"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="flex h-full min-h-0 flex-col"
          >
            <h1 className="sr-only">Models</h1>
            <header className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={close}>
                  <ChevronLeft className="size-4" />
                  <span>{props.disableWorkspaceDefault ? "Study" : "Chat"}</span>
                </Button>
              </div>
              <div className="relative flex min-w-0 w-full sm:w-80 md:w-96 items-center sm:ml-auto">
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
            </header>

            <div className="mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 flex-col">
              <ModelPickerPanel
                chrome="page"
                query={props.query}
                onQueryChange={props.setQuery}
                searchInputRef={searchInputRef}
                leading={!props.query.trim() || "nanamiwork local router route local models".includes(props.query.trim().toLowerCase())
                  ? <RouterRow onUse={useRouter} onEdit={() => setRouterSettingsOpen(true)} notice={routerNotice} needsRouting={needsRouting} selected={isLocalRouterModel(props.current)} /> : null}
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
                onSetWorkspaceDefault={props.disableWorkspaceDefault ? undefined : props.onSetWorkspaceDefault ?? setWorkspaceDefault}
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    host
  );
}
