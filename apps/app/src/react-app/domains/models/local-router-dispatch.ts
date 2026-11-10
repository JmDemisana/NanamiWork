import type { ModelRef } from "@/app/types";
import { isLocalRouterModel } from "@/app/lib/local-router-ref";
import { ModelAdmissionFence, modelAdmissionFence } from "@/app/lib/model-admission-fence";
import {
  hasLocalRouterRouting,
  localRouterSummary,
  resolveLocalRouterChoice,
  type LocalRouterAccount,
  type LocalRouterCandidate,
  type LocalRouterSettings,
} from "./nanami-local-router";

export type ResolvedTurnModel = { model: ModelRef | null; variant: string | null };

function routingSignature(settings: LocalRouterSettings): string {
  return JSON.stringify([settings.mode, settings.strategies, settings.modelOrder, settings.accountOrder, settings.excludedAccounts, settings.excludedModels]);
}

/**
 * The persisted router is a UI choice, not an engine model. Resolve it for
 * each new admission; only a concrete model may reach the engine. Account
 * changes are exclusive with other NanamiWork admissions and require an idle
 * local runtime. A failed or uncertain admission is never replayed here.
 */
export async function dispatchLocalRouterTurn<T>(input: {
  selected: ModelRef | null;
  variant: string | null;
  localRuntime: boolean;
  settings: () => LocalRouterSettings;
  accounts: () => Promise<readonly LocalRouterAccount[]>;
  ensureIdle: (candidate: LocalRouterCandidate) => Promise<void>;
  activate: (candidate: LocalRouterCandidate) => Promise<void>;
  record: (candidate: LocalRouterCandidate) => void;
  send: (selection: ResolvedTurnModel) => Promise<T>;
  assertCurrent?: () => void;
  fence?: ModelAdmissionFence;
}): Promise<T> {
  const fence = input.fence ?? modelAdmissionFence;
  if (!isLocalRouterModel(input.selected)) {
    return fence.regular(() => input.send({ model: input.selected, variant: input.variant }), input.assertCurrent);
  }
  return fence.routed(async () => {
    input.assertCurrent?.();
    if (!input.localRuntime) throw new Error("Local Router is available only on this computer.");
    if (!hasLocalRouterRouting(input.settings())) throw new Error("Choose a routing strategy in Local Router settings before sending.");
    const accounts = await input.accounts();
    input.assertCurrent?.();
    const settings = input.settings();
    if (!hasLocalRouterRouting(settings)) throw new Error("Choose a routing strategy in Local Router settings before sending.");
    const candidate = resolveLocalRouterChoice(accounts, settings);
    if (!candidate) {
      const included = localRouterSummary(accounts, settings);
      const available = localRouterSummary(accounts.filter((account) => !account.unavailableReason), settings);
      if (!included.modelCount) throw new Error("Include at least one account and model in Local Router settings.");
      if (!available.modelCount) throw new Error("The included accounts are unavailable. Check provider settings or account verification.");
      throw new Error("All included accounts are out of quota. Wait for a reset or include another account.");
    }
    if (candidate.account.kind !== "local") {
      await input.ensureIdle(candidate);
      input.assertCurrent?.();
      await input.activate(candidate);
      input.assertCurrent?.();
    }
    const latest = input.settings();
    if (!hasLocalRouterRouting(latest)) throw new Error("Choose a routing strategy in Local Router settings before sending.");
    if (routingSignature(latest) !== routingSignature(settings)) {
      throw new Error("Local Router settings changed while the message was being prepared. Try again.");
    }
    const currentAccounts = await input.accounts();
    input.assertCurrent?.();
    const currentAccount = currentAccounts.find((account) => account.key === candidate.account.key);
    const currentModel = currentAccount?.models.find((model) => model.key === candidate.model.key);
    if (!currentAccount || currentAccount.unavailableReason || !currentModel
      || (currentModel.remainingFraction !== null && currentModel.remainingFraction <= 0)) {
      throw new Error("The selected account or its quota changed while preparing the message. Try again.");
    }
    if (routingSignature(input.settings()) !== routingSignature(settings)) {
      throw new Error("Local Router settings changed while the message was being prepared. Try again.");
    }
    const result = await input.send({ model: candidate.ref, variant: currentModel.variant ?? null });
    input.record(candidate);
    return result;
  }, input.assertCurrent);
}
