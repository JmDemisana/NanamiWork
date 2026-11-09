"use client";

import * as React from "react";
import { ChevronDown, Lock, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ModelOption, ModelRef } from "@/app/types";
import { getModelBehaviorControls, getModelBehaviorSelection } from "@/app/lib/model-behavior";
import { FAST_DEFAULT_VARIANT } from "@openwork/types/cloud-model-fast";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ModelPickerPanel } from "@/react-app/domains/models/model-picker-panel";
import { useModelCatalog, useModelChoice } from "@/react-app/domains/models/use-model-catalog";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { useSetWorkspaceDefaultModel } from "@/react-app/kernel/use-workspace-model-default";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { openAutoProviderSettings } from "@/react-app/domains/cloud/auto-access-ui";
import { confirmAntigravityAuthEvent, confirmCodexAuthEvent, openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
import { newProvidersEvent } from "@/app/lib/provider-events";
import { openComposerModelPickerEvent } from "@/app/lib/inference-access";
import { fixedModelTitle, managesOwnBehavior, modelTitle, nonDefaultModelSummary, type RetainedModelSelection } from "@/react-app/domains/models/model-catalog";
import { DEFAULT_ANTIGRAVITY_IDE_MODELS, findAntigravityModelItem, resolveAntigravityModelForTier, useAntigravityAccountsStore, type ThinkingTier } from "@/react-app/domains/models/antigravity-accounts-store";
import { useChatGptAccountsStore } from "@/react-app/domains/models/chatgpt-accounts-store";
import { useCopilotAccountsStore } from "@/react-app/domains/models/copilot-accounts-store";
import { useModelPickerCatalogStore } from "@/react-app/domains/session/models/model-collections-store";
import { useDesktopFeature } from "@/react-app/domains/session/status/use-desktop-feature";
import { ModelPickerPage } from "@/react-app/domains/models/model-picker-page";
import { useLocalModelPickerEnabled } from "@/react-app/domains/models/use-local-model-picker";

export { ModelPickerFooter } from "@/react-app/domains/models/model-picker-panel";

interface ModelSelectProps {
  open: boolean;
  value: ModelRef;
  hideValue?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef, variant?: string | null) => void;
  disabled?: boolean;
  sessionId?: string;
  openWorkModelsEntitled?: boolean;
  openWorkModelsSyncing?: boolean;
  fallbackOptions?: readonly ModelOption[];
  behaviorValue?: string | null;
  behaviorLabel?: string;
  behaviorOptions?: { value: string | null; label: string }[];
  onBehaviorChange?: (value: string | null) => void;
  onSetWorkspaceDefault?: (model: ModelRef, variant?: string | null) => void | boolean | Promise<void | boolean>;
  onReloadWorkspace?: () => void | Promise<unknown>;
  retainedSelection?: RetainedModelSelection;
}

export function ModelSelect({ open, value, hideValue = false, onOpenChange, onChange, disabled = false, sessionId,
  openWorkModelsSyncing = false, fallbackOptions = [], behaviorValue = null, behaviorOptions = [], onBehaviorChange, onSetWorkspaceDefault, onReloadWorkspace, retainedSelection: savedSelection }: ModelSelectProps) {
  const [focusAlternative, setFocusAlternative] = React.useState(false);
  const [pageQuery, setPageQuery] = React.useState("");
  const isMobile = useIsMobile();
  const popupRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const workspace = useWorkspace();
  const setWorkspaceDefault = useSetWorkspaceDefaultModel();
  const checkRestriction = useCheckDesktopRestriction();
  const plainFreeModel = useDesktopFeature("plainFreeModel");
  const localModelPickerEnabled = useLocalModelPickerEnabled();
  const choice = useModelChoice(JSON.stringify([sessionId, value, behaviorValue, disabled]));
  const catalog = useModelCatalog({ client: workspace.client, baseUrl: workspace.opencodeBaseUrl, directory: workspace.selectedWorkspaceRoot,
    enabled: true, refreshWhen: open, fallbackOptions, pendingOptions: choice.pendingOptions, disabledProviders: choice.disabledProviders,
    current: value, savedSelection, sessionScoped: Boolean(sessionId), openWorkModelsSyncing });
  const { options, catalogState, retainedSelection, restrictToCloud, autoVisible } = catalog;
  const antigravityAccounts = useAntigravityAccountsStore((s) => s.accounts);
  const thinkingTier = useAntigravityAccountsStore((s) => s.thinkingTier);
  const activeAntigravityAccount = antigravityAccounts.find((a) => a.isActive) ?? antigravityAccounts[0];
  const chatGptAccounts = useChatGptAccountsStore((s) => s.accounts);
  const activeChatGptAccount = chatGptAccounts.find((a) => a.isActive) ?? chatGptAccounts[0];
  const copilotAccounts = useCopilotAccountsStore((s) => s.accounts);
  const activeCopilotAccount = copilotAccounts.find((a) => a.isActive) ?? copilotAccounts[0];

  React.useEffect(() => {
    useAntigravityAccountsStore.getState().setSelectedModel(value);
  }, [value]);

  React.useEffect(() => {
    if (open && workspace.client) {
      void useAntigravityAccountsStore.getState().loadAccounts(workspace.client);
      void useChatGptAccountsStore.getState().loadAccounts(workspace.client);
      void useCopilotAccountsStore.getState().loadAccounts(workspace.client);
    }
  }, [workspace.client, open]);

  React.useEffect(() => {
    const reload = () => {
      if (workspace.client) {
        void useAntigravityAccountsStore.getState().loadAccounts(workspace.client);
        void useChatGptAccountsStore.getState().loadAccounts(workspace.client);
        void useCopilotAccountsStore.getState().loadAccounts(workspace.client);
      }
    };
    window.addEventListener(newProvidersEvent, reload);
    window.addEventListener(confirmAntigravityAuthEvent, reload);
    window.addEventListener(confirmCodexAuthEvent, reload);
    return () => {
      window.removeEventListener(newProvidersEvent, reload);
      window.removeEventListener(confirmAntigravityAuthEvent, reload);
      window.removeEventListener(confirmCodexAuthEvent, reload);
    };
  }, [workspace.client]);

  React.useEffect(() => {
    const recover = (event: Event) => {
      // The New Task composer has no session; its requests carry none either.
      if (!(event instanceof CustomEvent) || (event.detail?.sessionId || undefined) !== (sessionId || undefined)) return;
      setFocusAlternative(event.detail?.focusAlternative !== false); onOpenChange(true);
    };
    window.addEventListener(openComposerModelPickerEvent, recover);
    return () => window.removeEventListener(openComposerModelPickerEvent, recover);
  }, [sessionId, onOpenChange]);
  // The palette and shortcuts for this conversation switch among exactly these models.
  const catalogOwner = React.useRef(Symbol());
  React.useLayoutEffect(() => {
    if (sessionId) useModelPickerCatalogStore.getState().publish(sessionId, catalogOwner.current, catalog.actionOptions);
  }, [sessionId, catalog.actionOptions]);
  React.useEffect(() => {
    const owner = catalogOwner.current;
    return () => { if (sessionId) useModelPickerCatalogStore.getState().release(sessionId, owner); };
  }, [sessionId]);
  const selected = options.find((option) => option.providerID === value.providerID && option.modelID === value.modelID);
  const selectedBehavior = getModelBehaviorSelection(selected?.behaviorOptions ?? behaviorOptions, behaviorValue);
  const controls = getModelBehaviorControls(selectedBehavior.options, selectedBehavior.value);
  // Fast shows on its own as a quiet "· Fast" after the model name; the effort beside it is the base level ("High", not "High + Fast").
  const fastOn = controls.fast && !managesOwnBehavior(value);
  const summary = fastOn
    ? (behaviorValue === FAST_DEFAULT_VARIANT ? null : controls.options.find((option) => option.value === behaviorValue)?.label ?? null)
    : nonDefaultModelSummary(value, behaviorValue, selectedBehavior.label);
  const select = (option: ModelOption, behavior?: { variant: string | null }) => {
    const nextVariant = behavior?.variant;
    const sameModel = option.providerID === value.providerID && option.modelID === value.modelID;

    const commit = () => {
      onChange({ providerID: option.providerID, modelID: option.modelID }, nextVariant);
      if (sameModel && behavior && !managesOwnBehavior(option)) {
        onBehaviorChange?.(behavior.variant);
      }
      onOpenChange(false);
    };

    if (
      option.providerID === "google" ||
      (option.providerID === "openai" && chatGptAccounts.length > 0) ||
      (option.providerID === "github-copilot" && copilotAccounts.length > 0)
    ) {
      commit();
      return;
    }

    choice.choose(option, commit);
  };
  const openProvider = () => { onOpenChange(false); window.dispatchEvent(new Event(openWorkbenchInstancesEvent)); };
  const openSettings = () => { onOpenChange(false); openAutoProviderSettings(); };

  const activeAntigravityItem = value.providerID === "google"
    ? findAntigravityModelItem(activeAntigravityAccount?.models ?? DEFAULT_ANTIGRAVITY_IDE_MODELS, value.modelID)
    : undefined;
  const supportsThinking = Boolean(
    activeAntigravityItem?.supportsThinkingTier || (value.providerID === "openai" && activeChatGptAccount),
  );

  const cycleThinkingTier = () => {
    const nextTier: ThinkingTier =
      thinkingTier === "low" ? "medium" : thinkingTier === "medium" ? "high" : "low";
    void useAntigravityAccountsStore.getState().setThinkingTier(nextTier);
    if (activeAntigravityItem) {
      const nextModelId = resolveAntigravityModelForTier(activeAntigravityItem, nextTier);
      onChange({ providerID: "google", modelID: nextModelId }, nextTier);
      onBehaviorChange?.(nextTier);
    } else if (value.providerID === "openai") {
      onChange(value, nextTier);
      onBehaviorChange?.(nextTier);
    }
  };

  const antigravityModelLabel = value.providerID === "google"
    ? (activeAntigravityItem?.displayName
      ?? (value.modelID === "antigravity-gemini-4-argon" ? "Gemini 4 Argon" : value.modelID === "antigravity-gemini-4-argon-high" ? "Gemini 4 Argon (High)" : undefined))
    : undefined;
  const activeChatGptItem = value.providerID === "openai"
    ? activeChatGptAccount?.models.find((m) => m.modelID === value.modelID)
    : undefined;
  const chatGptModelLabel = value.providerID === "openai" && activeChatGptAccount
    ? (activeChatGptItem?.displayName ?? value.modelID)
    : undefined;
  const activeCopilotItem = value.providerID === "github-copilot"
    ? activeCopilotAccount?.models.find((m) => m.modelID === value.modelID)
    : undefined;
  const copilotModelLabel = value.providerID === "github-copilot" && activeCopilotAccount
    ? (activeCopilotItem?.displayName ?? "Auto (Copilot)")
    : undefined;
  const isAntigravity = value?.providerID === "google";
  const hasValidAccountModel = Boolean(
    value?.providerID &&
    value?.modelID &&
    value.providerID !== "" &&
    value.modelID !== "" &&
    (value.providerID === "nanami" ||
      (isAntigravity ? Boolean(activeAntigravityItem) : true))
  );

  const triggerLabel = !hasValidAccountModel || hideValue
    ? "Pick a model"
    : antigravityModelLabel
      ? (activeAntigravityAccount ? `${antigravityModelLabel} · ${activeAntigravityAccount.email}` : antigravityModelLabel)
      : chatGptModelLabel
        ? `${chatGptModelLabel} · ${activeChatGptAccount!.email}`
        : copilotModelLabel
          ? `${copilotModelLabel} · @${activeCopilotAccount!.username}`
          : fixedModelTitle(value, { plainFreeModel }) ?? (catalog.currentOption ? modelTitle(catalog.currentOption, { plainFreeModel }) : "Pick a model");

  return (
    <>
      <div className="inline-flex min-w-0 max-w-full items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          aria-label="Change model"
          onClick={() => onOpenChange(!open)}
          className={`inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 text-sm transition-colors focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
            !hasValidAccountModel
              ? "rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 px-2.5 text-amber-300 hover:border-amber-400 hover:bg-amber-500/20"
              : "px-2 text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="min-w-0 max-w-[140px] sm:max-w-[200px] md:max-w-72 truncate inline-flex items-center gap-1.5">
            {!hasValidAccountModel ? <Sparkles className="size-3.5 shrink-0 text-amber-400 inline" /> : null}
            {value.providerID === "nanami" ? <Lock className="size-3 shrink-0 text-amber-400 inline" /> : null}
            <span className={`truncate ${!hasValidAccountModel ? "font-medium" : ""}`}>{triggerLabel}</span>
            {!hideValue && hasValidAccountModel && !antigravityModelLabel && !chatGptModelLabel && !copilotModelLabel && !supportsThinking && summary ? ` · ${summary}` : ""}
            {!hideValue && hasValidAccountModel && fastOn ? <span data-testid="model-fast-indicator" className="text-xs font-medium"> · Fast</span> : null}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
        {supportsThinking && hasValidAccountModel ? (
          <button
            type="button"
            disabled={disabled}
            onClick={cycleThinkingTier}
            title={`Thinking Capacity: ${thinkingTier.charAt(0).toUpperCase() + thinkingTier.slice(1)} (Click to switch)`}
            aria-label={`Thinking Capacity: ${thinkingTier}`}
            className="shrink-0 inline-flex h-7 items-center rounded-md border border-border/70 bg-muted/30 px-2 text-xs font-medium text-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>Thinking: {thinkingTier.charAt(0).toUpperCase() + thinkingTier.slice(1)}</span>
          </button>
        ) : null}
      </div>
      {localModelPickerEnabled ? <ModelPickerPage
        open={open}
        options={options}
        knownOptions={catalog.knownOptions}
        disabledProviders={[...choice.disabledProviders]}
        query={pageQuery}
        setQuery={setPageQuery}
        target={sessionId ? "session" : "default"}
        current={value}
        currentBehaviorValue={behaviorValue}
        fallbackBehaviorOptions={behaviorOptions}
        onSelect={(model) => onChange(model)}
        onSelectWithBehavior={(model, behavior) => {
          const sameModel = model.providerID === value.providerID && model.modelID === value.modelID;
          onChange(model, behavior?.variant);
          if (sameModel && behavior && !managesOwnBehavior(model)) onBehaviorChange?.(behavior.variant);
        }}
        onBehaviorChange={(_model, variant) => onBehaviorChange?.(variant)}
        onOpenSettings={openSettings}
        onClose={() => { setFocusAlternative(false); onOpenChange(false); }}
        restrictToCloud={restrictToCloud}
        catalogState={catalogState}
        retainedSelection={retainedSelection}
        onSetWorkspaceDefault={onSetWorkspaceDefault ?? setWorkspaceDefault}
        openWorkModelsSyncing={openWorkModelsSyncing}
        onReloadWorkspace={onReloadWorkspace}
      /> : <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && choice.loginOpen) return;
          setFocusAlternative(false);
          onOpenChange(next);
        }}
      >
        <DialogContent
          ref={popupRef}
          showCloseButton={false}
          initialFocus={() => (isMobile || focusAlternative ? popupRef.current : searchInputRef.current)}
          aria-describedby={undefined}
          data-testid="composer-model-picker"
          className="flex max-h-[min(calc(100dvh-2.5rem),40rem)] min-h-0 w-[33rem] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[33rem]"
        >
          <DialogTitle className="sr-only">Select Model</DialogTitle>
          <ModelPickerPanel
            searchInputRef={searchInputRef}
            options={options}
            current={value}
            behaviorValue={behaviorValue}
            fallbackBehaviorOptions={behaviorOptions}
            onSelect={select}
            onBehaviorChange={onBehaviorChange}
            focusAlternative={focusAlternative}
            catalogState={catalogState}
            retainedSelection={retainedSelection}
            onConnectProvider={!restrictToCloud ? openProvider : undefined}
            onOpenProviderSettings={!checkRestriction({ restriction: "allowControlSettings" }) ? openSettings : undefined}
            onSetWorkspaceDefault={onSetWorkspaceDefault ?? setWorkspaceDefault}
            openWorkModelsSyncing={openWorkModelsSyncing}
            autoVisible={autoVisible}
            onReloadWorkspace={onReloadWorkspace}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>}
    </>
  );
}
