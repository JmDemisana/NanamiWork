# Nanami Workbench model instances

Nanami Workbench is local-first. It starts with the **Nanami Gateway** instance
so a new session can run without an OpenWork Cloud account. Other instances are
enabled through OpenCode's normal local provider configuration, not bundled
credentials.

## Default instance

| Instance | Provider id | Endpoint | Setup |
| --- | --- | --- | --- |
| Nanami Gateway | `nanami` | `https://nanami-ai.pages.dev/api/v1` | Uses `NANAMI_API_KEY` or an existing local `provider.nanami.options.apiKey`. Never committed. |

The default model is `nanami/gemini-router`. The gateway key remains the only
unavoidable setup item when the local profile has no existing Nanami key.

## Optional local instances

The gateway is added beside the stock local provider catalog by default. Add the
matching credentials from **Settings → Add Instance** or the local OpenCode
config. Set `OPENWORK_NANAMI_ONLY=1` only when a gateway-only catalog is wanted.

| Instance | Provider route | Required local credential / limitation |
| --- | --- | --- |
| Google Antigravity Personal bridge | Custom OpenAI-compatible provider pointing at the locally running Antigravity Language Server/CLI bridge | The bridge address is machine-specific. Start and authenticate Antigravity separately, then enter its loopback base URL. No bridge or token is fabricated by Workbench. |
| Google AI Studio | `google` | A personal Google AI Studio API key. Select the currently available Flash model shown by the provider after authentication. Model aliases such as “Gemini 3.6 Flash Medium” are not assumed because Google controls the published identifiers. |
| GitHub Copilot | `github-copilot` / provider catalog entry | A GitHub token or the provider's local OAuth flow, with Copilot entitlement. |
| OpenCode Zen | `opencode` | An OpenCode key from `https://opencode.ai/auth`; free availability and model access are controlled by Zen. |
| Nanami Gateway | `nanami` | The default instance above. |

### Custom bridge example

Use a local-only placeholder and replace it with the address exposed by your
authenticated Antigravity bridge. Do not put a real token in this file:

```jsonc
{
  "provider": {
    "antigravity-personal": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Google Antigravity Personal",
      "options": {
        "baseURL": "http://127.0.0.1:PORT/v1",
        "apiKey": "${ANTIGRAVITY_BRIDGE_TOKEN}"
      }
    }
  }
}
```

Store environment values in the app's Environment settings or the operating
system, never in the repository. The packaged app does not probe OpenWork Cloud,
PostHog, Sentry, or the managed `openwork-cloud` MCP.
