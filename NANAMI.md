# Nami OpenWork

A fork of [OpenWork](https://github.com/different-ai/openwork) that talks to the
**Nanami Gateway** and nothing else.

Upstream OpenWork ships an OpenCode catalog of 50+ providers (OpenCode Zen,
OpenAI, Anthropic, GitHub Copilot, OpenRouter, OpenWork Cloud, and the free
"Auto" pool). This fork removes every one of them and leaves a single
OpenAI-compatible provider:

| Field | Value |
| --- | --- |
| Provider id | `nanami` |
| Base URL | `https://nanami-ai.pages.dev/api/v1` |
| Models | `gemini-router` (Gemini 3.6 router), `openrouter` (Nemotron 3 Ultra) |
| Default model | `nanami/gemini-router` |

The gateway rejects a `nanami/` model prefix, so the ids the engine sends
upstream stay exactly `gemini-router` and `openrouter`.

## API key

The gateway needs an `nmn_...` agent key. Resolution order:

1. `NANAMI_API_KEY` in the environment.
2. `provider.nanami.options.apiKey` in `~/.config/opencode/opencode.jsonc`
   (or `opencode.json`), which the official Nanami OpenCode installer already
   writes.

No key is stored in this repository. A key set through OpenWork's own
`Settings > AI Providers`, or passed in `Settings > Environment`, still wins for
the configured provider.

## Turning it off

`OPENWORK_NANAMI_ONLY=0` restores stock multi-provider behaviour, which is handy
when comparing against upstream or debugging a missing model.

`NANAMI_GATEWAY_BASE_URL` points the provider at a local proxy instead of the
deployed gateway.

## What changed

| File | Change |
| --- | --- |
| `apps/server/src/nanami-gateway.ts` | New: provider spec, model catalog, key resolution, Nanami-only switch |
| `apps/server/src/managed-opencode-v2.ts` | Nanami is injected into the engine config, and the model catalog is restricted to it |
| `apps/server/src/opencode-plugins/openwork-provider-filters-v2.ts` | `only` rule drops every model the generated config does not own, including engine built-ins |
| `apps/server/src/engine-v2-preview.ts` | Provider mirror pushes exactly one spec, so catalog readiness covers only the gateway |
| `apps/server/src/openwork-runtime-config.ts` | v1 engine path gets the same provider plus `enabled_providers: ["nanami"]` |
| `apps/app/src/app/constants.ts` | Default model is `nanami/gemini-router` |

## Verified

Against the live gateway:

- `GET /api/v1/models` returns `gemini-router` and `openrouter`.
- `POST /api/v1/chat/completions` with `model: "gemini-router"` answers.
- Function calling returns a proper `tool_calls` response.
- `model: "nanami/gemini-router"` is rejected with `unsupported_model`.

Unit checks for the provider spec, key resolution, and catalog filter pass under
`node` type stripping. The full desktop build has not been run yet.

## License

Upstream licensing is unchanged: MIT outside `/ee`, OpenWork Enterprise Edition
inside `/ee`. This fork only touches files outside `/ee`.
