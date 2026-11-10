import type { ModelRef } from "@/app/types";
import { isLocalRouterModel } from "@/app/lib/local-router-ref";
import { ModelAdmissionFence, modelAdmissionFence } from "@/app/lib/model-admission-fence";
import {
  hasLocalRouterRouting,
  localRouterSummary,
  resolveLocalRouterCandidates,
  type LocalRouterAccount,
  type LocalRouterCandidate,
  type LocalRouterSettings,
} from "./nanami-local-router";

export type ResolvedTurnModel = { model: ModelRef | null; variant: string | null };

function providerRejectionStatus(error: unknown): number | null {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.shift();
    if (typeof value === "string") {
      try {
        pending.push(JSON.parse(value));
      } catch {
        // Plain messages do not prove a definite provider rejection.
      }
      continue;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const status of [record.statusCode, record.status]) {
      if (typeof status === "number" && Number.isInteger(status)) return status;
    }
    for (const nested of [record.data, record.response, record.cause, record.error,
      value instanceof Error ? value.message : null]) {
      if (nested !== undefined && nested !== null) pending.push(nested);
    }
  }
  return null;
}

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
  steer?: boolean;
  localRuntime: boolean;
  settings: () => LocalRouterSettings;
  accounts: () => Promise<readonly LocalRouterAccount[]>;
  steeringCandidate?: () => LocalRouterCandidate | null;
  release?: () => Promise<void>;
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
  if (input.steer) {
    return fence.regular(async () => {
      input.assertCurrent?.();
      if (!input.localRuntime) throw new Error("Local Router is available only on this computer.");
      const candidate = input.steeringCandidate?.();
      if (!candidate) throw new Error("The active routed model is unknown, so this steer was not sent. Stop the run and try again.");
      const result = await input.send({ model: candidate.ref, variant: candidate.model.variant ?? null });
      input.record(candidate);
      return result;
    }, input.assertCurrent);
  }
  return fence.routed(async () => {
    input.assertCurrent?.();
    if (!input.localRuntime) throw new Error("Local Router is available only on this computer.");
    if (!hasLocalRouterRouting(input.settings())) throw new Error("Choose a routing strategy in Local Router settings before sending.");
    const accounts = await input.accounts();
    input.assertCurrent?.();
    const settings = input.settings();
    if (!hasLocalRouterRouting(settings)) throw new Error("Choose a routing strategy in Local Router settings before sending.");
    const candidates = resolveLocalRouterCandidates(accounts, settings);
    if (candidates.length === 0) {
      const included = localRouterSummary(accounts, settings);
      const available = localRouterSummary(accounts.filter((account) => !account.unavailableReason), settings);
      if (!included.modelCount) throw new Error("Include at least one account and model in Local Router settings.");
      if (!available.modelCount) throw new Error("The included accounts are unavailable. Check provider settings or account verification.");
      throw new Error("All included accounts are out of quota. Wait for a reset or include another account.");
    }
    let lastProviderRejection: unknown;
    for (const candidate of candidates) {
      input.assertCurrent?.();
      const latest = input.settings();
      if (!hasLocalRouterRouting(latest)) throw new Error("Choose a routing strategy in Local Router settings before sending.");
      if (routingSignature(latest) !== routingSignature(settings)) {
        throw new Error("Local Router settings changed while the message was being prepared. Try again.");
      }
      if (candidate.account.kind !== "local") {
        await input.ensureIdle(candidate);
        input.assertCurrent?.();
        await input.activate(candidate);
        input.assertCurrent?.();
      } else {
        await input.release?.();
        await input.activate(candidate);
        input.assertCurrent?.();
      }
      const currentAccounts = await input.accounts();
      input.assertCurrent?.();
      const currentAccount = currentAccounts.find((account) => account.key === candidate.account.key);
      const currentModel = currentAccount?.models.find((model) => model.key === candidate.model.key);
      if (!currentAccount || currentAccount.unavailableReason || !currentModel
        || (currentModel.remainingFraction !== null && currentModel.remainingFraction <= 0)) continue;
      if (routingSignature(input.settings()) !== routingSignature(settings)) {
        throw new Error("Local Router settings changed while the message was being prepared. Try again.");
      }
      try {
        const result = await input.send({ model: candidate.ref, variant: currentModel.variant ?? null });
        input.record(candidate);
        return result;
      } catch (error) {
        const status = providerRejectionStatus(error);
        // A provider's 403/404 is a definite model/account rejection, so no
        // turn was accepted. Try the next picker-listed account/model. Never
        // replay on rate limits, network errors, or ambiguous server failures.
        if (status !== 403 && status !== 404) throw error;
        lastProviderRejection = error;
      }
    }
    if (lastProviderRejection) throw lastProviderRejection;
    throw new Error("All included accounts are out of quota. Wait for a reset or include another account.");
  }, input.assertCurrent);
}
