import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Building, Check, Cloud, Laptop, Loader2, Lock, Pin, PinOff, Plus, RefreshCw, Sparkles, Trash2, X, Bot } from "lucide-react";
import { confirmAntigravityAuthEvent, openCodexAuthEvent, openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
import type { ModelOption, ModelRef } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionContextMenu } from "@/components/ui/action-context-menu";
import { OpenWorkMark, ProviderIcon } from "@/react-app/design-system/provider-icon";
import { AutoPickerRecovery, useObservedAutoAccessSnapshot } from "@/react-app/domains/cloud/auto-access-ui";
import { autoNotOffered, autoPickerCopy, autoQuietlyUnavailable, freeAutoSwitchedOff, type AutoPickerState } from "@/app/lib/inference-access";
import type { MenuAction } from "@/components/ui/action-menu-model";
import { Command, CommandCollection, CommandGroup, CommandGroupLabel, CommandItem, CommandList, CommandPanel } from "@/components/ui/command";
import { AUTO_ROUTER_GROUP, fixedModelTitle, immutableModelPin, isAutoModel, isAutoRouterModel, isPinModelShortcut, markExplicitModelChoice, modelGroups, modelMakerId, modelSource, modelStateLabel, modelSubtitle, modelTitle, orderedModelPins, retainedModelCopy, withAutoDefaultPin, MODEL_SOURCE_LABELS, type ModelGroup, type ModelPickerCatalogState, type RetainedModelSelection } from "./model-catalog";
import { findAntigravityModelItem, formatQuotaResetShort, resolveAntigravityModelForTier, useAntigravityAccountsStore, type AntigravityAccountInfo, type AntigravityModelItem } from "./antigravity-accounts-store";
import { useCopilotAccountsStore } from "./copilot-accounts-store";
import { useChatGptAccountsStore } from "./chatgpt-accounts-store";
import { modelRefKey, useModelCollectionsStore } from "@/react-app/domains/session/models/model-collections-store";
import { PickerNotice } from "./picker-notice";
import { resolveSearchIntent, searchIntentSummary, searchIntentTag, searchModels } from "./model-search";
import { useModelShortcutsStore } from "@/react-app/domains/shortcuts/model-shortcuts-store";
import { useDesktopFeature } from "@/react-app/domains/session/status/use-desktop-feature";
import { formatChord, resolveShortcutOs } from "@/react-app/domains/shortcuts/shortcut-keys";
import { openDesktopUrl } from "@/app/lib/desktop";

export function ModelSourceIcon({ model }: { model: ModelRef & { source?: ModelOption["source"] } }) {
  const source = modelSource(model);
  const Icon = source === "gateway" ? Cloud : source === "organization" ? Building : Laptop;
  return <Icon role="img" aria-label={MODEL_SOURCE_LABELS[source]} className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />;
}

function ProviderMark({ model, description, retained = false, plainFreeModel = false }: { model: ModelRef & { title?: string }; description?: string; retained?: boolean; plainFreeModel?: boolean }) {
  const maker = retained ? null : modelMakerId(model);
  return <div data-slot="model-provider-mark" className="flex size-4 shrink-0 items-center justify-center">
    {isAutoModel(model) && !plainFreeModel ? <OpenWorkMark className="size-4 text-dls-accent dark:text-foreground" />
      : isAutoRouterModel(model) ? <Sparkles aria-hidden="true" strokeWidth={1.5} className="size-4 text-dls-accent dark:text-foreground" />
      : <ProviderIcon providerId={maker ?? (retained ? undefined : model.providerID)} providerName={maker ? undefined : description} size={16} />}
  </div>;
}

const SEARCH_GROUP = "Search results";
const UNLABELED_GROUPS = new Set([SEARCH_GROUP, AUTO_ROUTER_GROUP]);
const MIXED_GROUPS = new Set(["Pinned", "Recent", "OpenWork Models", SEARCH_GROUP]);

function ModelLoadingRows({ rows = 3, label = "Loading models", still = false }: { rows?: number; label?: string; still?: boolean }) {
  return <div role="status" aria-label={label} data-testid={still ? "model-catalog-unloaded" : "model-catalog-loading"} className={still ? "px-2 pb-2 [&_[data-slot=skeleton]]:animate-none [&_[data-slot=skeleton]]:bg-gray-4" : "px-2 pb-2"}>
    {Array.from({ length: rows }, (_, index) => index).map((index) => <div key={index} className="flex h-9 items-center gap-2.5 px-2"><Skeleton className="size-4 rounded" /><Skeleton className={`h-2.5 rounded ${index % 2 ? "w-28" : "w-36"}`} /></div>)}
  </div>;
}

export type ModelPickerListProps = {
  options: readonly ModelOption[];
  current: ModelRef;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (option: ModelOption, behavior?: { variant: string | null }) => void;
  focusAlternative?: boolean;
  footer?: ReactNode;
  leading?: ReactNode;
  searchInputRef?: Ref<HTMLInputElement>;
  autoFocusSearch?: boolean;
  catalogState?: ModelPickerCatalogState;
  retainedSelection?: RetainedModelSelection;
  onConnectProvider?: () => void;
  onConnectCodex?: () => void;
  onOpenProviderSettings?: () => void;
  onSetWorkspaceDefault?: (model: ModelRef, variant?: string | null) => void | boolean | Promise<void | boolean>;
  currentBehaviorValue?: string | null;
  openWorkModelsSyncing?: boolean;
  onReloadWorkspace?: () => void | Promise<unknown>;
  onRetryAuto?: () => void | Promise<unknown>;
  onClose?: () => void;
};

type AutoRowState = { model: ModelRef; state: AutoPickerState; code?: string | null; resetsAt?: string | null };
export function ModelPickerList(props: ModelPickerListProps) {
  return isAutoModel(props.current) || props.options.some(isAutoModel) || props.openWorkModelsSyncing
    ? <AutoStatusModelPickerList {...props} /> : <ModelPickerRows {...props} />;
}

function AutoStatusModelPickerList(props: ModelPickerListProps) {
  const snapshot = useObservedAutoAccessSnapshot();
  const status = snapshot?.data;
  const availableAuto = props.options.find(isAutoModel);
  const auto = isAutoModel(props.current) ? props.current : availableAuto;
  const matches = auto && status && modelRefKey(auto) === modelRefKey(status);
  const state: AutoPickerState = props.openWorkModelsSyncing ? "sync" : snapshot?.status === "error" ? "unavailable" : matches ? (autoQuietlyUnavailable(status) ? "ready" : autoNotOffered(status) ? "not_offered" : status.state) : "ready";
  const switchedOff = freeAutoSwitchedOff(status);
  const blockedByPolicy = props.retainedSelection !== undefined && props.retainedSelection.reason !== "unavailable" && isAutoModel(props.current);
  const plainFreeModel = useDesktopFeature("plainFreeModel");
  return <ModelPickerRows {...props} plainFreeModel={plainFreeModel} retainedSelection={switchedOff && isAutoModel(props.current) ? undefined : props.retainedSelection} options={withAutoDefaultPin(switchedOff ? props.options.filter((option) => !isAutoModel(option)) : props.options, status)} openWorkModelsSyncing={!switchedOff && !blockedByPolicy && props.openWorkModelsSyncing} autoRow={!plainFreeModel && !switchedOff && !blockedByPolicy && auto ? { model: auto, state, code: status?.code, resetsAt: status?.allowance?.resetsAt } : undefined} onClose={props.onClose} />;
}

function menuChord(label: string, chord: string) {
  return <><span className="min-w-0 flex-1">{label}</span><kbd className="ml-4 font-sans text-xs text-muted-foreground">{chord}</kbd></>;
}

function AccountQuotaPill({ item }: { item: AntigravityModelItem }) {
  if (item.remainingFraction === null || item.remainingFraction === undefined) {
    return null;
  }
  const pct = item.remainingFraction < 0.01 ? 0 : Math.round(item.remainingFraction * 100);
  const resetShort = formatQuotaResetShort(item.resetTime);
  const isZero = pct <= 0;
  const isLow = pct > 0 && pct <= 20;
  const toneClass = isZero
    ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
    : isLow
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";

  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none ${toneClass}`}
      title={item.resetTime ? `Resets at ${new Date(item.resetTime).toLocaleString()}` : `${pct}% remaining`}
    >
      {resetShort ? `${pct}% · ${resetShort}` : `${pct}%`}
    </span>
  );
}

function ConnectedAccountGroup({
  account,
  current,
  query,
  onSelectModel,
}: {
  account: AntigravityAccountInfo;
  current: ModelRef;
  query: string;
  onSelectModel: (account: AntigravityAccountInfo, item: AntigravityModelItem) => void;
}) {
  const search = query.trim().toLowerCase();
  const visibleModels = useMemo(() => {
    if (!search) return account.models;
    return account.models.filter((m) =>
      `${m.displayName} ${m.rawId} ${account.email} antigravity`.toLowerCase().includes(search),
    );
  }, [account.models, account.email, search]);

  if (visibleModels.length === 0) return null;

  return (
    <div className="px-2 pt-1 pb-1" data-testid={`antigravity-account-group-${account.email}`}>
      <div className="flex min-h-7 items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate" title={`${account.email} (Antigravity)`}>
            {account.email} (Antigravity)
          </span>
          {account.verificationRequired ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (account.verificationUrl) void openDesktopUrl(account.verificationUrl);
              }}
              className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400 hover:underline cursor-pointer"
              title="Click to complete verification in browser"
            >
              ⚠ Needs Verification
            </button>
          ) : account.isPlus ? (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              Plus
            </span>
          ) : null}
          {account.isActive ? (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              Active
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Refresh account limits"
            aria-label={`Refresh limits for ${account.email}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void useAntigravityAccountsStore.getState().refreshQuotas();
            }}
          >
            <RefreshCw className={`size-3 ${account.quotaLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            title={`Remove ${account.email}`}
            aria-label={`Remove ${account.email}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void useAntigravityAccountsStore.getState().deleteAccount(account.email);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {visibleModels.map((item) => {
          const isSelected =
            account.isActive &&
            current.providerID === "google" &&
            Boolean(findAntigravityModelItem([item], current.modelID));
          const maker = modelMakerId({
            providerID: "google",
            modelID: item.modelID,
            title: item.displayName,
          });
          return (
            <button
              key={`${account.email}:${item.modelID}`}
              type="button"
              data-testid={`antigravity-model-${account.email}-${item.modelID}`}
              onClick={() => onSelectModel(account, item)}
              className={`group/model flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected ? "bg-accent/60 font-medium" : ""
              }`}
            >
              <div className="flex size-4 shrink-0 items-center justify-center">
                <ProviderIcon providerId={maker ?? "google"} size={16} />
              </div>
              <span className="min-w-0 flex-1 truncate leading-5" title={item.displayName}>
                {item.displayName}
              </span>

              <AccountQuotaPill item={item} />
              <span className="flex size-4 shrink-0 items-center justify-center">
                {isSelected ? <Check aria-hidden="true" className="size-4 text-foreground" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPickerRows({ options, current, query, onQueryChange, onSelect, focusAlternative = false, footer, searchInputRef,
  catalogState, retainedSelection, onConnectProvider, onConnectCodex, onOpenProviderSettings, onSetWorkspaceDefault, currentBehaviorValue, openWorkModelsSyncing, onReloadWorkspace, onRetryAuto, onClose, autoRow, plainFreeModel = false,
}: ModelPickerListProps & { autoRow?: AutoRowState; plainFreeModel?: boolean }) {
  const display = { plainFreeModel };
  const favorites = useModelCollectionsStore((state) => state.favorites);
  const recent = useModelCollectionsStore((state) => state.recent);
  const antigravityAccounts = useAntigravityAccountsStore((state) => state.accounts);
  const thinkingTier = useAntigravityAccountsStore((state) => state.thinkingTier);

  // Filter out generic "google" provider models from standard groups since connected Antigravity accounts render as peer groups.
  const nonGoogleOptions = useMemo(
    () => options.filter((option) => option.providerID !== "google"),
    [options],
  );
  const nonGoogleFavorites = useMemo(
    () => favorites.filter((fav) => fav.providerID !== "google"),
    [favorites],
  );
  const nonGoogleRecent = useMemo(
    () => recent.filter((rec) => rec.providerID !== "google"),
    [recent],
  );

  const modelShortcuts = useModelShortcutsStore((state) => state.shortcuts);
  const shortcutLabels = useMemo(() => {
    const os = resolveShortcutOs(undefined, typeof navigator === "undefined" ? "" : navigator.platform);
    return new Map(modelShortcuts.map((shortcut) => [modelRefKey({ providerID: shortcut.action.providerID, modelID: shortcut.action.modelID }), formatChord(shortcut.keys, os)]));
  }, [modelShortcuts]);
  const searching = query.trim().length > 0;
  const search = useMemo(() => searching ? searchModels(nonGoogleOptions, query) : null, [searching, nonGoogleOptions, query]);
  const groups: ModelGroup[] = useMemo(() => {
    if (search) {
      return search.matches.length ? [{ value: SEARCH_GROUP, items: search.matches.map((match) => match.option) }] : [];
    }
    return modelGroups(nonGoogleOptions, nonGoogleFavorites, nonGoogleRecent, query).filter(
      (g) => g.value !== "Recent",
    );
  }, [search, nonGoogleOptions, nonGoogleFavorites, nonGoogleRecent, query]);
  const providerMiss = search?.provider && !search.provider.found ? search.provider : undefined;
  const pins = orderedModelPins(nonGoogleOptions, nonGoogleFavorites);
  const pinned = new Set(pins.map(modelRefKey));
  const root = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<ModelOption | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const [pinTarget, setPinTarget] = useState<{ option: ModelOption; variant?: { variant: string | null } } | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinChecking, setPinChecking] = useState(false);

  const handleUnlockPin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pinTarget || pinChecking) return;
    const pin = pinInput.trim();
    if (!pin) {
      setPinError("Please enter the Gate PIN.");
      return;
    }
    setPinChecking(true);
    setPinError(null);
    try {
      const res = await fetch("https://nanami-ai.pages.dev/api/shared-chats", {
        method: "GET",
        headers: { "x-nanami-gate-pin": pin },
      });
      if (res.ok) {
        const target = pinTarget;
        setPinTarget(null);
        setPinInput("");
        setPinError(null);
        onSelect(target.option, target.variant);
      } else {
        setPinError("Incorrect Gate PIN. Please try again.");
      }
    } catch {
      setPinError("Could not reach Nanami gate server. Please check your connection.");
    } finally {
      setPinChecking(false);
    }
  };
  const blockedAuto = (option: ModelRef) => autoRow?.state !== undefined && autoRow.state !== "ready" && modelRefKey(option) === modelRefKey(autoRow.model);
  const canSelect = (option: ModelOption) => !option.disabled && !blockedAuto(option) && nonGoogleOptions.some((item) => modelRefKey(item) === modelRefKey(option) && !item.disabled);
  const select = (option: ModelOption) => {
    if (!canSelect(option)) return;
    const variant = search ? resolveSearchIntent(option, search.intent).variant : undefined;
    const variantObj = variant === undefined ? undefined : { variant };
    if (option.providerID === "nanami") {
      setPinTarget({ option, variant: variantObj });
      setPinInput("");
      setPinError(null);
      return;
    }
    onSelect(option, variantObj);
  };
  const selectAntigravityModel = (account: AntigravityAccountInfo, item: AntigravityModelItem) => {
    const resolvedModelID = resolveAntigravityModelForTier(item, thinkingTier);
    useAntigravityAccountsStore.getState().setSelectedModel({
      providerID: "google",
      modelID: resolvedModelID,
    });
    void useAntigravityAccountsStore.getState().selectAccount(account.email);
    onSelect(
      {
        providerID: "google",
        modelID: resolvedModelID,
        title: item.displayName,
        description: `${account.email} (Antigravity)`,
      } as unknown as ModelOption,
      item.supportsThinkingTier ? { variant: thinkingTier } : undefined,
    );
  };
  const alternative = pins.find((option) => !isAutoModel(option) && modelRefKey(option) !== modelRefKey(current))
    ?? nonGoogleOptions.find((option) => !option.disabled && !isAutoModel(option) && modelRefKey(option) !== modelRefKey(current));
  const alternativeKey = alternative ? modelRefKey(alternative) : undefined;
  useEffect(() => {
    if (!focusAlternative) return;
    const frame = requestAnimationFrame(() => {
      const row = [...(root.current?.querySelectorAll<HTMLElement>("[data-model-key]") ?? [])].find((item) => item.dataset.modelKey === alternativeKey);
      const target = row ?? root.current?.querySelector<HTMLInputElement>('[aria-label="Search all models"]');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAlternative, alternativeKey]);
  const clearSearch = () => {
    onQueryChange("");
    root.current?.querySelector<HTMLInputElement>('[aria-label="Search all models"]')?.focus({ preventScroll: true });
  };
  const retry = async () => {
    if (!catalogState?.onRetry || retryBusy) return;
    setRetryBusy(true); setRetryFailed(false);
    try { await catalogState.onRetry(); } catch { setRetryFailed(true); } finally { setRetryBusy(false); }
  };
  const toggle = (option: ModelOption) => {
    if (!immutableModelPin(option) && canSelect(option)) useModelCollectionsStore.getState().toggleFavorite(option);
  };
  const hasOptions = nonGoogleOptions.some((option) => !option.disabled) || antigravityAccounts.length > 0;
  const loading = catalogState?.state === "loading";
  const failed = catalogState?.state === "error" || retryFailed;
  const empty = !loading && !hasOptions && !query.trim() && !failed;
  const isSelectedAntigravityAvailable = current.providerID === "google" && antigravityAccounts.length > 0;
  const retained = !isSelectedAntigravityAvailable && retainedSelection && modelRefKey(retainedSelection.model) === modelRefKey(current)
    && !options.some((option) => modelRefKey(option) === modelRefKey(current) && !option.disabled) ? retainedSelection : undefined;
  const retainedCopy = retained ? retainedModelCopy(retained.reason) : null;
  const retainedName = retained ? (fixedModelTitle(retained.model, display) ?? (retained.title ? modelTitle({ ...retained.model, title: retained.title, description: retained.description }, display) : "Saved model")) : "";
  const retainedVisible = retained && (!query.trim() || `${retainedName} ${retained.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const retainedState = retained && isAutoModel(retained.model) && autoRow && autoRow.state !== "ready" ? autoPickerCopy(autoRow.state, false, undefined, autoRow.code, autoRow.resetsAt).subtitle : retainedCopy?.subtitle;
  const retainedSubtitle = [retained && !isAutoModel(retained.model) ? retained.description?.trim() : null, retainedState].filter(Boolean).join(" · ");
  const retainedPinned = Boolean(retained && favorites.some((favorite) => modelRefKey(favorite) === modelRefKey(retained.model)));
  const retainedLabel = retainedPinned ? "Pinned" : "Saved selection";
  const mergedLabel = retainedVisible && retainedPinned && groups[0]?.value === "Pinned" ? "Pinned" : null;
  const verifiedDate = catalogState?.lastVerifiedAt ? new Date(catalogState.lastVerifiedAt) : null;
  const verified = verifiedDate && Number.isFinite(verifiedDate.valueOf()) ? verifiedDate : null;

  return <div ref={root} className="flex min-h-0 flex-1 flex-col relative" onKeyDownCapture={(event) => {
    if (!isPinModelShortcut(event) || event.repeat) return;
    const focusedRow = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-model-key]") : null;
    const row = focusedRow ?? root.current?.querySelector<HTMLElement>("[data-model-key][data-highlighted]");
    const option = nonGoogleOptions.find((item) => modelRefKey(item) === row?.dataset.modelKey) ?? highlighted;
    if (!option) return;
    event.preventDefault(); event.stopPropagation(); toggle(option);
  }}>
    {pinTarget ? (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xs p-6 text-center select-none animate-in fade-in-0 duration-150">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-400 mb-3 shadow-xs">
          <Lock className="size-6" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          Nanami Gate PIN Required
        </h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs leading-relaxed">
          Enter the Gate PIN from the Nanami AI portal to switch to{" "}
          <span className="font-medium text-foreground">{pinTarget.option.title}</span>.
        </p>
        <form
          onSubmit={handleUnlockPin}
          className="mt-4 flex w-full max-w-xs flex-col gap-2.5"
        >
          <input
            type="password"
            autoFocus
            disabled={pinChecking}
            placeholder="Enter Gate PIN..."
            value={pinInput}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinError(null);
            }}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 py-1 text-center font-mono text-sm tracking-widest text-foreground outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60"
          />
          {pinError ? (
            <span className="text-[11px] font-medium text-rose-400 animate-in fade-in-0">
              {pinError}
            </span>
          ) : null}
          <div className="flex gap-2 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pinChecking}
              className="flex-1 text-xs h-9 cursor-pointer"
              onClick={() => {
                setPinTarget(null);
                setPinInput("");
                setPinError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pinChecking}
              className="flex-1 text-xs h-9 bg-amber-500 hover:bg-amber-600 text-white font-medium cursor-pointer disabled:opacity-50"
            >
              {pinChecking ? (
                <div className="flex items-center justify-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Verifying...</span>
                </div>
              ) : (
                "Unlock & Switch"
              )}
            </Button>
          </div>
        </form>
      </div>
    ) : null}
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="min-w-0 pr-2">
        <h3 className="text-sm font-semibold text-foreground">Select Model</h3>
        <p className="text-xs text-muted-foreground">Choose a model from your connected accounts</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter models..."
            aria-label="Search all models"
            className="h-8 w-44 rounded-lg border border-border bg-muted/30 pl-2.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
              title="Clear filter"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close dialog"
            title="Close"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
    <Command items={groups} filter={null} value={query} onValueChange={onQueryChange}>
      <CommandPanel className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-width:thin] [&>[data-slot=scroll-area]]:h-auto">
        {retainedVisible ? <div data-testid="retained-selected-model" aria-disabled="true" aria-label={`${retainedName}, current model, ${retainedSubtitle}`} className="px-2 pt-2">
          <p className="flex h-7 items-center px-2 text-xs text-muted-foreground">{retainedLabel}</p>
          <div className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm opacity-55">
            <ProviderMark model={retained.model} description={retained.description} retained />
            <span className="min-w-0 flex-1 leading-[18px]"><span className="block truncate font-medium">{retainedName}</span><span className="block text-muted-foreground">{retainedSubtitle}</span></span>
            <span className="flex size-4 shrink-0 items-center justify-center">{retained.reason === "policy" ? <Lock aria-label="Blocked" strokeWidth={1.5} className="size-4" /> : <Check aria-hidden="true" className="size-4" />}</span>
          </div>
        </div> : null}
        {loading && !hasOptions ? <ModelLoadingRows /> : null}
        {search && groups.length > 0 && (providerMiss || searchIntentSummary(search.intent)) ? <p role="status" data-testid="model-search-provider-miss" className="px-4 pb-1 pt-3 text-xs text-muted-foreground">
          {[providerMiss ? (search.modelWords.length ? `No “${search.modelWords.join(" ")}” on ${providerMiss.label}. Showing other providers.` : `${providerMiss.label} has no models here.`) : null,
            searchIntentSummary(search.intent)].filter(Boolean).join(" ")}
        </p> : null}
        {!loading && groups.length === 0 && antigravityAccounts.length === 0 && query.trim() ? <div role="status" className="flex flex-col items-center gap-1 px-4 py-7 text-center text-sm">
          <p>No models match “{query.trim()}”</p><p className="text-muted-foreground">{providerMiss ? `${providerMiss.label} isn't connected in this workspace.` : "Try a shorter name, or search by provider."}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={clearSearch}>Clear search</Button>
        </div> : null}
        {empty ? <div role="status" className="flex flex-col items-center gap-1 px-4 py-7 text-center text-sm" data-testid="model-catalog-empty">
          <p>No models yet</p><p className="text-muted-foreground">{onConnectProvider ? <>Add an account below, or configure providers in {onOpenProviderSettings ? <button type="button" className="text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none" onClick={onOpenProviderSettings}>AI providers</button> : "AI providers"}.</> : "Your organization manages model access. Ask your workspace owner or admin."}</p>
        </div> : null}
        <CommandList>
          {(group: ModelGroup) => <CommandGroup key={group.value} items={group.items}>
            {group.value === mergedLabel || UNLABELED_GROUPS.has(group.value) ? null : <CommandGroupLabel className="flex min-h-7 items-center">{group.value}</CommandGroupLabel>}
            <CommandCollection>{(option: ModelOption) => {
              const key = modelRefKey(option);
              const name = modelTitle(option, display);
              const fixed = immutableModelPin(option);
              const active = modelRefKey(current) === key;
              const autoState = autoRow && modelRefKey(autoRow.model) === key ? autoRow.state : undefined;
              const blocked = !canSelect(option);
              const subtitle = autoState ? autoPickerCopy(autoState, false, undefined, autoRow?.code, autoRow?.resetsAt).subtitle : active && failed ? `${modelSubtitle(option, false, display)}${modelSubtitle(option, false, display) ? " · " : ""}availability not verified` : modelSubtitle(option, false, display);
              const meta = autoState || (isAutoModel(option) && !plainFreeModel) || isAutoRouterModel(option) ? subtitle
                : [MIXED_GROUPS.has(group.value) ? option.description?.trim() : null, modelStateLabel(option),
                  active && failed ? "Availability not verified" : null].filter(Boolean).join(" · ");
              const applies = search ? searchIntentTag(option, search.intent) : null;
              const pinLabel = pinned.has(key) ? "Unpin" : "Pin to top";
              const actions: MenuAction[] = [
                { type: "item", id: "pin", label: fixed ? "Pinned by your org" : pinLabel, webContent: fixed ? undefined : menuChord(pinLabel, "⇧P"), disabled: fixed || blocked, onSelect: () => toggle(option) },
                { type: "item", id: "default", label: "Set as workspace default", disabled: !onSetWorkspaceDefault || blocked, onSelect: async () => { if (canSelect(option) && onSetWorkspaceDefault) { const saved = await onSetWorkspaceDefault(option, active ? currentBehaviorValue ?? null : null); if (saved !== false) markExplicitModelChoice(); } } },
                { type: "item", id: "select", label: "Switch to this model", webContent: menuChord("Switch to this model", "⏎"), disabled: blocked, onSelect: () => select(option) },
                { type: "item", id: "copy", label: "Copy model ID", onSelect: () => navigator.clipboard.writeText(`${option.providerID}/${option.modelID}`) },
              ];
              return <ActionContextMenu key={key} actions={actions} render={<CommandItem
                value={`${group.value}:${key} ${name} ${subtitle}`} disabled={blocked}
                data-model-key={key} data-checked={active} data-testid={`model-option-${option.providerID}-${option.modelID}`}
                aria-label={`${name}, ${subtitle}, ${MODEL_SOURCE_LABELS[modelSource(option)]}${active ? ", current model" : ""}`}
                tabIndex={blocked ? -1 : 0} className="group/model min-h-9 gap-2.5 rounded-lg px-2 py-1.5 text-sm data-disabled:opacity-55"
                onFocus={() => setHighlighted(option)} onClick={() => select(option)}
                onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); select(option); } }}
              />}>
                <ProviderMark model={option} description={option.description} plainFreeModel={plainFreeModel} />
                <span data-slot="model-label" className="min-w-0 flex-1 leading-5">
                  <span className={`flex items-center gap-1 truncate${active ? " font-medium" : ""}`} title={name}>
                  <span className="truncate">{name}</span>
                  {option.providerID === "nanami" ? (
                    <Lock className="size-3 shrink-0 text-amber-400 inline" />
                  ) : null}
                </span>
                  {meta ? <span className="block truncate text-xs text-muted-foreground" title={meta}>{meta}</span> : null}
                </span>
                {applies ? <span data-testid="model-search-applies" className="shrink-0 text-xs text-muted-foreground">{applies}</span> : null}
                {shortcutLabels.get(key) ? <kbd data-testid="model-shortcut-key" className="shrink-0 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">{shortcutLabels.get(key)}</kbd> : null}
                <span className="flex size-6 shrink-0 items-center justify-center">{!fixed && !blocked ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`${pinLabel}: ${name}`} title={pinLabel}
                  className="size-6 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus:opacity-100 group-hover/model:opacity-100 group-focus-within/model:opacity-100"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggle(option); }}>
                  {pinned.has(key) ? <PinOff aria-hidden="true" strokeWidth={1.5} className="size-3.5" /> : <Pin aria-hidden="true" strokeWidth={1.5} className="size-3.5" />}
                </Button> : null}</span>
                <span data-slot="model-selection" className="flex size-4 shrink-0 items-center justify-center">{active ? <Check aria-hidden="true" className="size-4 text-foreground" /> : null}</span>
              </ActionContextMenu>;
            }}</CommandCollection>
          </CommandGroup>}
        </CommandList>
        {antigravityAccounts.length > 0 ? (
          <div className="pb-1">
            {antigravityAccounts.map((acc) => (
              <ConnectedAccountGroup
                key={acc.email}
                account={acc}
                current={current}
                query={query}
                onSelectModel={selectAntigravityModel}
              />
            ))}
          </div>
        ) : null}
        {loading && hasOptions ? <ModelLoadingRows /> : null}
        {failed && !verified && hasOptions && !query.trim() ? <ModelLoadingRows rows={2} label="Other models not loaded" still /> : null}
      </CommandPanel>
      {failed ? <PickerNotice tone={verified ? "neutral" : "error"} role="alert" testId="model-catalog-error" action={<Button size="sm" variant="outline" disabled={!catalogState?.onRetry || retryBusy || catalogState.refreshing} onClick={() => void retry()}>Retry</Button>}>
        {verified ? <>Showing models from <time dateTime={verified.toISOString()}>{verified.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>. Couldn’t refresh just now.</> : hasOptions ? "Couldn’t load the rest of your models. Pinned models still work." : "Couldn’t load your models. Try again."}
      </PickerNotice> : null}
      {retainedCopy && !query.trim() && !(isAutoModel(current) && autoRow && autoRow.state !== "ready") ? <PickerNotice action={<>
        {retained?.reason === "unavailable" && catalogState?.onRetry ? <Button size="sm" variant="outline" disabled={retryBusy || catalogState.refreshing} onClick={() => void retry()}>Refresh</Button> : null}
        {retained?.reason === "disabled" && onOpenProviderSettings ? <Button size="sm" variant="outline" onClick={onOpenProviderSettings}>AI providers</Button> : null}
      </>}>{retainedCopy.detail}</PickerNotice> : null}
      {autoRow && autoRow.state !== "ready" ? <AutoPickerRecovery state={autoRow.state} code={autoRow.code} resetsAt={autoRow.resetsAt} onRetry={onRetryAuto} onReload={onReloadWorkspace} hasAlternatives={Boolean(alternativeKey)} />
        : openWorkModelsSyncing ? <AutoPickerRecovery state="sync" onReload={onReloadWorkspace} /> : null}
      {onConnectProvider ? (
        <div className="border-t border-border bg-muted/20 p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 justify-center gap-1.5 text-xs text-foreground truncate"
              onClick={() => {
                onClose?.();
                useAntigravityAccountsStore.getState().setModalOpen(true);
                window.dispatchEvent(new Event(openWorkbenchInstancesEvent));
              }}
              title="Add Antigravity Account"
            >
              <Sparkles className="size-3.5 text-amber-500" />
              <span>Antigravity</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 justify-center gap-1.5 text-xs text-foreground truncate"
              onClick={() => {
                onClose?.();
                useCopilotAccountsStore.getState().setModalOpen(true);
              }}
              title="Add GitHub Copilot Account"
            >
              <Sparkles className="size-3.5 text-emerald-500" />
              <span>Copilot</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 justify-center gap-1.5 text-xs text-foreground truncate"
              onClick={() => {
                onClose?.();
                useChatGptAccountsStore.getState().setModalOpen(true);
              }}
              title="Add ChatGPT / OpenAI Account"
            >
              <Bot className="size-3.5 text-sky-500" />
              <span>ChatGPT</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 justify-center text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => window.location.reload()}
              title="Confirm & Refresh"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/80 px-1 leading-snug">
            For accounts using Antigravity for the first time, use the official app to authenticate. They will not work unless verified.
          </p>
        </div>
      ) : null}
      {footer}
    </Command>
  </div>;
}
