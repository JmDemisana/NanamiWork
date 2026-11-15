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
  const { openrouter: _removedOpenRouter, ...remainingModels } = models as Record<string, unknown>;
  const uncensored = models.uncensored && typeof models.uncensored === "object" ? models.uncensored : {};
  const providerOptions = nanami.options && typeof nanami.options === "object" ? nanami.options : {};
  const providerOptionsHeaders =
    providerOptions.headers && typeof providerOptions.headers === "object" ? providerOptions.headers : {};
  const headers = uncensored.headers && typeof uncensored.headers === "object" ? uncensored.headers : {};
  const modelOptions = uncensored.options && typeof uncensored.options === "object" ? uncensored.options : {};
  const modelOptionsHeaders =
    modelOptions.headers && typeof modelOptions.headers === "object" ? modelOptions.headers : {};
  const updated = await client.config.update({ config: {
    ...current,
    provider: { ...provider, nanami: {
      ...nanami,
      // OpenCode forwards provider.options.headers to @ai-sdk/openai-compatible;
      // keep model-level headers in sync as well.
      options: { ...providerOptions, headers: { ...providerOptionsHeaders, "x-nami-nsfw-grant": grant } },
      models: { ...remainingModels,
      uncensored: {
        ...uncensored,
        headers: { ...headers, "x-nami-nsfw-grant": grant },
        options: { ...modelOptions, headers: { ...modelOptionsHeaders, "x-nami-nsfw-grant": grant } },
      },
    } } },
  } });
  if (updated.error) throw new Error("Could not save the temporary gateway grant.");
}
