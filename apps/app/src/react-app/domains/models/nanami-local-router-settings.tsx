import { useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import {
  LOCAL_ROUTER_STRATEGIES,
  isExclusiveFirstStrategy,
  terminalRoutingStrategy,
  localRouterModels,
  localRouterSummary,
  orderByLocalRouterOrder,
  orderLocalRouterAccounts,
  useLocalRouterStore,
  type LocalRouterAccount,
  type LocalRouterMode,
  type LocalRouterStrategy,
} from "./nanami-local-router";

const MODE_OPTIONS: readonly { value: LocalRouterMode; label: string }[] = [
  { value: "model", label: "Model order" },
  { value: "account", label: "Account order" },
  { value: "priority", label: "Priority" },
];

function OrderButtons({
  label,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return <span className="flex shrink-0 items-center">
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-6 text-muted-foreground hover:text-foreground"
      disabled={!canMoveUp}
      onClick={() => onMove(-1)}
      aria-label={`Move ${label} up`}
      title="Move up"
    >
      <ChevronUp className="size-3.5" />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-6 text-muted-foreground hover:text-foreground"
      disabled={!canMoveDown}
      onClick={() => onMove(1)}
      aria-label={`Move ${label} down`}
      title="Move down"
    >
      <ChevronDown className="size-3.5" />
    </Button>
  </span>;
}

function ModeToggle({ mode, onChange }: { mode: LocalRouterMode; onChange: (mode: LocalRouterMode) => void }) {
  return <div role="radiogroup" aria-label="Routing order" className="grid grid-cols-3 gap-0.5 rounded-lg border border-border p-0.5">
    {MODE_OPTIONS.map((option) => (
      <label key={option.value} className={`flex h-8 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-ring ${
          mode === option.value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
        }`}>
        <input type="radio" name="local-router-mode" value={option.value} checked={mode === option.value}
          onChange={() => onChange(option.value)} className="sr-only" />
        {option.label}
      </label>
    ))}
  </div>;
}

function RoutingRow({
  strategy,
  label,
  description,
  enabled,
  priority,
  canMoveUp,
  canMoveDown,
  disabled,
  disabledReason,
  onToggle,
  onMove,
}: {
  strategy: LocalRouterStrategy;
  label: string;
  description: string;
  enabled: boolean;
  priority: number | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  disabledReason?: string;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return <div
    data-testid={`router-strategy-${strategy}`}
    className={`flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${disabled ? "opacity-50" : enabled ? "bg-accent/45" : "hover:bg-accent/30"}`}
    title={disabledReason}
  >
    <Switch
      aria-label={`${label} routing`}
      checked={enabled}
      disabled={disabled}
      onCheckedChange={onToggle}
    />
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium">{label}</span>
        {enabled && priority !== null ? (
          <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {priority}
          </span>
        ) : null}
      </span>
      <span className="block truncate text-xs text-muted-foreground" title={disabledReason ?? description}>{disabledReason ?? description}</span>
    </span>
    {enabled ? (
      <span className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground"
          disabled={disabled || !canMoveUp}
          onClick={() => onMove(-1)}
          aria-label={`Move ${label} earlier`}
          title="Move earlier"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground"
          disabled={disabled || !canMoveDown}
          onClick={() => onMove(1)}
          aria-label={`Move ${label} later`}
          title="Move later"
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </span>
    ) : null}
  </div>;
}

export function LocalRouterSettingsPage({
  onBack,
  accounts,
}: {
  onBack: () => void;
  accounts: readonly LocalRouterAccount[];
}) {
  const mode = useLocalRouterStore((state) => state.mode);
  const setMode = useLocalRouterStore((state) => state.setMode);
  const strategies = useLocalRouterStore((state) => state.strategies);
  const toggleStrategy = useLocalRouterStore((state) => state.toggleStrategy);
  const moveStrategy = useLocalRouterStore((state) => state.moveStrategy);
  const excludedAccounts = useLocalRouterStore((state) => state.excludedAccounts);
  const toggleAccount = useLocalRouterStore((state) => state.toggleAccount);
  const moveAccount = useLocalRouterStore((state) => state.moveAccount);
  const accountOrder = useLocalRouterStore((state) => state.accountOrder);
  const excludedModels = useLocalRouterStore((state) => state.excludedModels);
  const toggleModel = useLocalRouterStore((state) => state.toggleModel);
  const moveModel = useLocalRouterStore((state) => state.moveModel);
  const modelOrder = useLocalRouterStore((state) => state.modelOrder);
  const resetUsage = useLocalRouterStore((state) => state.resetUsage);
  const summary = localRouterSummary(accounts, { excludedAccounts, excludedModels });

  const modelEntries = useMemo(
    () => localRouterModels(accounts).flatMap((group) =>
      group.models.map((model) => ({ model, providerID: group.providerID, providerLabel: group.label }))),
    [accounts],
  );
  const orderedModels = useMemo(
    () => orderByLocalRouterOrder(modelEntries, (entry) => entry.model.key, modelOrder),
    [modelEntries, modelOrder],
  );
  const orderedAccounts = useMemo(() => orderLocalRouterAccounts(accounts, accountOrder), [accounts, accountOrder]);
  const allModelsIncluded = modelEntries.length > 0
    && modelEntries.every((entry) => !excludedModels.includes(entry.model.key));
  const allAccountsIncluded = accounts.length > 0
    && accounts.every((account) => !excludedAccounts.includes(account.key));
  const exclusiveFirst = isExclusiveFirstStrategy(strategies[0]) ? strategies[0] : undefined;
  const exclusiveLabel = exclusiveFirst === "round-robin" ? "Round robin" : "Random";
  const terminal = terminalRoutingStrategy(strategies);
  const terminalLabel = terminal === "round-robin" ? "Round robin" : "Random";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-dls-surface" data-testid="local-router-settings-page">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-2" onClick={onBack}>
            <ChevronLeft className="size-4" /> Models
          </Button>
          <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-dls-accent" strokeWidth={1.5} />
            NanamiWorks Local Router
          </h1>
          <p className="text-xs text-muted-foreground">{summary.accountCount} accounts · {summary.modelCount} models · Unknown quotas are treated as available</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-width:thin]">
          <div className="grid gap-x-5 gap-y-6 md:grid-cols-3">
          <section className="min-w-0">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Model Selection</h3>
                <p className="text-xs text-muted-foreground">Every model is selected by default. Use the arrows to arrange routing order.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={modelEntries.length === 0}
                onClick={() => {
                  for (const entry of modelEntries) {
                    const included = !excludedModels.includes(entry.model.key);
                    if (allModelsIncluded ? included : !included) toggleModel(entry.model.key);
                  }
                }}
              >
                {allModelsIncluded ? "Clear all" : "Select all"}
              </Button>
            </div>
            {orderedModels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No routable models yet. Connect an account below.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {orderedModels.map((entry, index) => {
                  const included = !excludedModels.includes(entry.model.key);
                  return (
                    <div
                      key={entry.model.key}
                      className={`flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1 text-sm ${included ? "hover:bg-accent/60" : "opacity-60 hover:bg-accent/30"}`}
                    >
                      <Checkbox
                        aria-label={`Include ${entry.model.label}`}
                        checked={included}
                        onCheckedChange={() => toggleModel(entry.model.key)}
                      />
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <ProviderIcon providerId={entry.providerID} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" title={entry.model.label}>{entry.model.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{entry.providerLabel}</span>
                      </span>
                      <OrderButtons
                        label={entry.model.label}
                        canMoveUp={index > 0}
                        canMoveDown={index < orderedModels.length - 1}
                        onMove={(direction) => moveModel(entry.model.key, direction, orderedModels.map((item) => item.model.key))}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Included Accounts</h3>
                <p className="text-xs text-muted-foreground">Every connected account is included by default. Use the arrows to arrange routing order.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={accounts.length === 0}
                onClick={() => {
                  for (const account of accounts) {
                    const included = !excludedAccounts.includes(account.key);
                    if (allAccountsIncluded ? included : !included) toggleAccount(account.key);
                  }
                }}
              >
                {allAccountsIncluded ? "Clear all" : "Select all"}
              </Button>
            </div>
            {accounts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                Connect an account below, then its models appear here.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {orderedAccounts.map((account, index) => {
                  const included = !excludedAccounts.includes(account.key);
                  return (
                    <div
                      key={account.key}
                      className={`flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${included ? "hover:bg-accent/60" : "opacity-60 hover:bg-accent/30"}`}
                    >
                      <Checkbox
                        aria-label={`Include ${account.label}`}
                        checked={included}
                        onCheckedChange={() => toggleAccount(account.key)}
                      />
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <ProviderIcon providerId={account.providerID} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" title={account.label}>{account.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {account.providerLabel} · {account.models.length} model{account.models.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <OrderButtons
                        label={account.label}
                        canMoveUp={index > 0}
                        canMoveDown={index < orderedAccounts.length - 1}
                        onMove={(direction) => moveAccount(account.key, direction, orderedAccounts.map((entry) => entry.key))}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-2">
              <h3 className="text-sm font-medium">Routing</h3>
              <p className="text-xs text-muted-foreground">
                {mode === "priority"
                  ? exclusiveFirst
                    ? `${exclusiveLabel} is priority 1, so other strategies cannot affect the choice. Turn it off to choose another first priority.`
                    : strategies.length === 0 ? "Choose at least one priority before routing." : "Round robin and Random always come last; earlier priorities resolve first."
                  : `Routing follows the ${mode === "model" ? "model" : "account"} order above. Priority strategies are paused.`}
              </p>
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
            {mode === "priority" ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {LOCAL_ROUTER_STRATEGIES.map((entry) => {
                  const priority = strategies.indexOf(entry.value);
                  const blockedByFirst = Boolean(exclusiveFirst && entry.value !== exclusiveFirst);
                  const blockedByTerminal = Boolean(terminal && entry.value !== terminal && isExclusiveFirstStrategy(entry.value));
                  const disabled = blockedByFirst || blockedByTerminal;
                  const disabledReason = blockedByFirst
                    ? `${exclusiveLabel} already decides the choice at priority 1.`
                    : blockedByTerminal ? `${terminalLabel} already occupies the final priority.` : undefined;
                  return <RoutingRow
                    key={entry.value}
                    strategy={entry.value}
                    label={entry.label}
                    description={entry.description}
                    enabled={priority >= 0}
                    priority={priority >= 0 ? priority + 1 : null}
                    canMoveUp={priority > 0 && !isExclusiveFirstStrategy(entry.value)}
                    canMoveDown={priority >= 0 && priority < strategies.length - 1 && !isExclusiveFirstStrategy(strategies[priority + 1])}
                    disabled={disabled}
                    disabledReason={disabledReason}
                    onToggle={() => toggleStrategy(entry.value)}
                    onMove={(direction) => moveStrategy(entry.value, direction)}
                  />;
                })}
              </div>
            ) : null}
          </section>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={resetUsage}
          >
            <RotateCcw className="size-3.5" />
            Reset usage history
          </Button>
          <span className="text-xs text-muted-foreground">Changes are saved locally</span>
        </footer>
    </div>
  );
}
