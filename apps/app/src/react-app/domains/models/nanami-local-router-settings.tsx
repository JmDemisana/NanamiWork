import { useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, RotateCcw } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import { modelMakerId } from "./model-catalog";
import {
  LOCAL_ROUTER_STRATEGIES,
  localRouterModels,
  orderByLocalRouterOrder,
  orderLocalRouterAccounts,
  useLocalRouterStore,
  type LocalRouterAccount,
  type LocalRouterStrategy,
} from "./nanami-local-router";

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

function RoutingRow({ strategy, label, description, enabled, onToggle }: {
  strategy: LocalRouterStrategy;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      data-testid={`router-strategy-${strategy}`}
      aria-pressed={enabled}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.1 }}
      onClick={onToggle}
      className={`flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        enabled ? "bg-accent text-foreground border border-primary/20 shadow-xs" : "hover:bg-accent/40 text-muted-foreground"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground" title={description}>{description}</span>
      </span>
    </motion.button>
  );
}

export function LocalRouterSettingsPage({
  onBack,
  accounts,
}: {
  onBack: () => void;
  accounts: readonly LocalRouterAccount[];
}) {
  const strategies = useLocalRouterStore((state) => state.strategies);
  const toggleStrategy = useLocalRouterStore((state) => state.toggleStrategy);
  const excludedAccounts = useLocalRouterStore((state) => state.excludedAccounts);
  const toggleAccount = useLocalRouterStore((state) => state.toggleAccount);
  const moveAccount = useLocalRouterStore((state) => state.moveAccount);
  const accountOrder = useLocalRouterStore((state) => state.accountOrder);
  const excludedModels = useLocalRouterStore((state) => state.excludedModels);
  const toggleModel = useLocalRouterStore((state) => state.toggleModel);
  const moveModel = useLocalRouterStore((state) => state.moveModel);
  const modelOrder = useLocalRouterStore((state) => state.modelOrder);
  const resetUsage = useLocalRouterStore((state) => state.resetUsage);

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


  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 3 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col bg-dls-surface"
      data-testid="local-router-settings-page"
    >
        <header className="flex min-h-[60px] shrink-0 items-center gap-1.5 border-b border-border px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={onBack}>
            <ChevronLeft className="size-4" /> Models
          </Button>
          <div className="min-w-0">
          <h1 className="text-sm font-semibold">
            NanamiWork Local Router
          </h1>
          </div>
        </header>

        <div className="@container/router min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-width:thin]">
          <div className="flex flex-col gap-4">
          <section className="min-w-0 rounded-xl border border-border/70 bg-card/35 p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Model Selection</h3>
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
              <div tabIndex={0} aria-label="Router models" className="grid max-h-[min(45vh,24rem)] grid-cols-1 gap-x-4 gap-y-0.5 overflow-y-auto [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-ring @[41rem]/router:grid-cols-2 @[62rem]/router:grid-cols-3">
                {orderedModels.map((entry, index) => {
                  const included = !excludedModels.includes(entry.model.key);
                  const maker = modelMakerId({ providerID: entry.providerID, modelID: entry.model.modelID, title: entry.model.label }) ?? entry.providerID;
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
                      <span data-model-maker={maker} className="flex size-4 shrink-0 items-center justify-center">
                        <ProviderIcon providerId={maker} size={16} />
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

          <section className="min-w-0 rounded-xl border border-border/70 bg-card/35 p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">Included Accounts</h3>
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
              <div tabIndex={0} aria-label="Router accounts" className="grid max-h-[min(45vh,24rem)] grid-cols-1 gap-x-4 gap-y-0.5 overflow-y-auto [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-ring @[41rem]/router:grid-cols-2 @[62rem]/router:grid-cols-3">
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
                        {account.unavailableReason ? <span className="block text-xs text-amber-500">{account.unavailableReason}</span> : null}
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

          <section className="min-w-0 rounded-xl border border-border/70 bg-card/35 p-4">
            <div className="mb-2">
              <h3 className="text-sm font-medium">Routing Strategy</h3>
              <p className="text-xs text-muted-foreground">Choose how requests rotate through accounts and models.</p>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 @[41rem]/router:grid-cols-2 @[62rem]/router:grid-cols-3">
              {LOCAL_ROUTER_STRATEGIES.map((entry) => (
                <RoutingRow
                  key={entry.value}
                  strategy={entry.value}
                  label={entry.label}
                  description={entry.description}
                  enabled={strategies[0] === entry.value}
                  onToggle={() => toggleStrategy(entry.value)}
                />
              ))}
            </div>
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
    </motion.div>
  );
}
