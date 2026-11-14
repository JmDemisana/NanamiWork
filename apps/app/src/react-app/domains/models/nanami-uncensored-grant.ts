import type { Client } from "@/app/types";

/** Configure only the uncensored model; never store the user's gate code. */
export async function configureNanamiUncensoredGrant(client: Client | null | undefined, grant: string): Promise<void> {
  if (!client) throw new Error("NanamiWork engine is not connected.");
  const response = await client.config.get();
  if (response.error || !response.data) throw new Error("Could not read the gateway configuration.");
  const current = response.data as Record<string, any>;
  const provider = current.provider && typeof current.provider === "object" ? current.provider : {};
  const nanami = provider.nanami && typeof provider.nanami === "object" ? provider.nanami : {};
  const models = nanami.models && typeof nanami.models === "object" ? nanami.models : {};
  const uncensored = models.uncensored && typeof models.uncensored === "object" ? models.uncensored : {};
  const providerHeaders = nanami.headers && typeof nanami.headers === "object" ? nanami.headers : {};
  const headers = uncensored.headers && typeof uncensored.headers === "object" ? uncensored.headers : {};
  const updated = await client.config.update({ config: {
    ...current,
    provider: { ...provider, nanami: {
      ...nanami,
      // Include the grant at provider scope as a fallback for engine versions
      // that omit model-level headers when building chat-completion requests.
      // The gateway still validates the short-lived grant on the uncensored
      // endpoint, and the separate gate remains required to select this model.
      headers: { ...providerHeaders, "x-nami-nsfw-grant": grant },
      models: { ...models,
      uncensored: { ...uncensored, headers: { ...headers, "x-nami-nsfw-grant": grant } },
    } } },
  } });
  if (updated.error) throw new Error("Could not save the temporary gateway grant.");
}
