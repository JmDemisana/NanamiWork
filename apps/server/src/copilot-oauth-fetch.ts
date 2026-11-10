type Fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;

/** Exchange the saved GitHub login for the short-lived Copilot inference token. */
export function createCopilotOAuthFetch(oauthToken: string, options: {
  token?: string;
  expiresAt?: number;
  fetch?: Fetch;
  now?: () => number;
} = {}): Fetch {
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let token = options.token && options.token !== oauthToken && !/^(gho_|ghu_|github_pat_)/.test(options.token)
    ? options.token : "";
  let expiresAt = typeof options.expiresAt === "number" ? options.expiresAt * 1000 : 0;
  let pending: Promise<void> | null = null;

  const refresh = async () => {
    if (pending) return pending;
    const operation = (async () => {
      const response = await send("https://api.github.com/copilot_internal/v2/token", {
        headers: { Authorization: `token ${oauthToken}`, Accept: "application/json", "User-Agent": "GithubCopilot/1.155.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Could not refresh Copilot authorization (${response.status}).`);
      const value: unknown = await response.json();
      if (!value || typeof value !== "object") throw new Error("Could not refresh Copilot authorization.");
      const nextToken: unknown = Reflect.get(value, "token");
      const nextExpiry: unknown = Reflect.get(value, "expires_at");
      if (typeof nextToken !== "string" || !nextToken || nextToken === oauthToken || /^(gho_|ghu_|github_pat_)/.test(nextToken)
        || typeof nextExpiry !== "number" || !Number.isFinite(nextExpiry) || nextExpiry * 1000 <= now()) {
        throw new Error("Could not refresh Copilot authorization.");
      }
      token = nextToken;
      expiresAt = nextExpiry * 1000;
    })();
    pending = operation;
    try { await operation; }
    finally { if (pending === operation) pending = null; }
  };

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.protocol !== "https:" || !/^api(?:\.(?:business|enterprise))?\.githubcopilot\.com$/i.test(url.hostname)) {
      throw new Error("Copilot authorization is restricted to GitHub Copilot endpoints.");
    }
    if (!token || expiresAt <= now() + 60_000) await refresh();
    const retry = request.clone();
    const used = token;
    const call = (original: Request, credential: string) => {
      const headers = new Headers(original.headers);
      headers.set("Authorization", `Bearer ${credential}`);
      return send(new Request(original, { headers, redirect: "manual" }));
    };
    const response = await call(request, used);
    if (response.status !== 401) return response;
    void response.body?.cancel().catch(() => undefined);
    if (token === used) await refresh();
    return call(retry, token);
  };
}
