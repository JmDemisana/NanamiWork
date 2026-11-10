import type { ModelRef } from "@/app/types";

export const LOCAL_ROUTER_PROVIDER_ID = "nanami-local-router";
export const LOCAL_ROUTER_MODEL_ID = "route-local-models";
export const LOCAL_ROUTER_MODEL: ModelRef = {
  providerID: LOCAL_ROUTER_PROVIDER_ID,
  modelID: LOCAL_ROUTER_MODEL_ID,
};
export const LOCAL_ROUTER_TITLE = "NanamiWork Local Router";

/** This is a client-side selection, never an engine provider ID. */
export function isLocalRouterModel(model: ModelRef | null | undefined): boolean {
  return model?.providerID === LOCAL_ROUTER_PROVIDER_ID && model.modelID === LOCAL_ROUTER_MODEL_ID;
}

export function assertConcreteModel(model: ModelRef | null | undefined): void {
  if (model?.providerID === LOCAL_ROUTER_PROVIDER_ID) throw new Error("Local Router must resolve a model before sending.");
}
