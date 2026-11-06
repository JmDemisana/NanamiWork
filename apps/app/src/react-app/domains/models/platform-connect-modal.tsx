/** @jsxImportSource react */
import * as React from "react";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openDesktopUrl } from "@/app/lib/desktop";
import { openWorkbenchInstancesEvent } from "@/react-app/shell/new-providers-listener";
import { useAntigravityAccountsStore } from "./antigravity-accounts-store";
import { useCopilotAccountsStore } from "./copilot-accounts-store";
import { useChatGptAccountsStore } from "./chatgpt-accounts-store";

export type PlatformType = "antigravity" | "chatgpt" | "copilot";

export function PlatformConnectModal() {
  const [activePlatform, setActivePlatform] = React.useState<PlatformType>("antigravity");

  // Antigravity Store
  const antigravityOpen = useAntigravityAccountsStore((s) => s.modalOpen);
  const setAntigravityOpen = useAntigravityAccountsStore((s) => s.setModalOpen);
  const antigravityAuthUrl = useAntigravityAccountsStore((s) => s.authUrl);
  const antigravityConnecting = useAntigravityAccountsStore((s) => s.isConnecting);
  const antigravityAccounts = useAntigravityAccountsStore((s) => s.accounts);

  // Copilot Store
  const copilotOpen = useCopilotAccountsStore((s) => s.modalOpen);
  const setCopilotOpen = useCopilotAccountsStore((s) => s.setModalOpen);
  const copilotFlow = useCopilotAccountsStore((s) => s.deviceFlow);
  const copilotConnecting = useCopilotAccountsStore((s) => s.isConnecting);
  const copilotAccount = useCopilotAccountsStore((s) => s.account);
  const startCopilotFlow = useCopilotAccountsStore((s) => s.startDeviceFlow);
  const pollCopilotFlow = useCopilotAccountsStore((s) => s.pollDeviceFlow);
  const cancelCopilotFlow = useCopilotAccountsStore((s) => s.cancelDeviceFlow);

  // ChatGPT Store
  const chatGptOpen = useChatGptAccountsStore((s) => s.modalOpen);
  const setChatGptOpen = useChatGptAccountsStore((s) => s.setModalOpen);
  const chatGptAccount = useChatGptAccountsStore((s) => s.account);
  const chatGptConnecting = useChatGptAccountsStore((s) => s.isConnecting);
  const connectChatGptKey = useChatGptAccountsStore((s) => s.connectApiKey);
  const chatGptError = useChatGptAccountsStore((s) => s.error);

  const [copiedCode, setCopiedCode] = React.useState(false);
  const [apiKeyInput, setApiKeyInput] = React.useState("");

  const isOpen = antigravityOpen || copilotOpen || chatGptOpen;

  // Sync tab when opened from a specific button
  React.useEffect(() => {
    if (copilotOpen) setActivePlatform("copilot");
    else if (chatGptOpen) setActivePlatform("chatgpt");
    else if (antigravityOpen) setActivePlatform("antigravity");
  }, [copilotOpen, chatGptOpen, antigravityOpen]);

  // When switching to Copilot, initiate device flow if needed
  React.useEffect(() => {
    if (isOpen && activePlatform === "copilot" && !copilotFlow && !copilotConnecting) {
      void (async () => {
        const flow = await startCopilotFlow();
        if (flow) {
          void pollCopilotFlow();
        }
      })();
    }
  }, [isOpen, activePlatform, copilotFlow, copilotConnecting, startCopilotFlow, pollCopilotFlow]);

  const handleClose = () => {
    cancelCopilotFlow();
    setAntigravityOpen(false);
    setCopilotOpen(false);
    setChatGptOpen(false);
    setApiKeyInput("");
  };

  const handleCopyCopilotCode = async () => {
    if (!copilotFlow?.userCode) return;
    try {
      await navigator.clipboard.writeText(copilotFlow.userCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (e) {
      console.warn("Could not copy code:", e);
    }
  };

  const handleOpenGoogle = () => {
    if (antigravityAuthUrl) {
      void openDesktopUrl(antigravityAuthUrl);
    } else {
      window.dispatchEvent(new Event(openWorkbenchInstancesEvent));
    }
  };

  const handleOpenCopilot = () => {
    if (!copilotFlow?.verificationUri) return;
    void openDesktopUrl(copilotFlow.verificationUri);
  };

  const handleOpenChatGpt = () => {
    void openDesktopUrl("https://chatgpt.com");
  };

  const handleOpenOpenAiKeys = () => {
    void openDesktopUrl("https://platform.openai.com/api-keys");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[32rem] sm:max-w-[32rem] p-0 overflow-hidden rounded-2xl border-border bg-card shadow-2xl">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            {activePlatform === "antigravity" ? (
              <Sparkles className="size-4 text-amber-500" />
            ) : activePlatform === "copilot" ? (
              <Sparkles className="size-4 text-emerald-500" />
            ) : (
              <Bot className="size-4 text-sky-500" />
            )}
            <span>Connect a Platform</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            Link developer accounts for intelligent routing, multi-account load balancing, and quota limits.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {/* Platform Selector Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/60 bg-muted/30 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActivePlatform("antigravity")}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all cursor-pointer ${
                activePlatform === "antigravity"
                  ? "bg-background text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="size-3.5 text-amber-500" />
              <span className="truncate">Antigravity</span>
              {antigravityAccounts.length > 0 && (
                <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActivePlatform("copilot")}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all cursor-pointer ${
                activePlatform === "copilot"
                  ? "bg-background text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="size-3.5 text-emerald-500" />
              <span className="truncate">Copilot</span>
              {copilotAccount && (
                <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActivePlatform("chatgpt")}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all cursor-pointer ${
                activePlatform === "chatgpt"
                  ? "bg-background text-foreground shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bot className="size-3.5 text-sky-500" />
              <span className="truncate">ChatGPT</span>
              {chatGptAccount && (
                <span className="size-1.5 rounded-full bg-sky-500 shrink-0" />
              )}
            </button>
          </div>

          {/* Tab 1: Antigravity */}
          {activePlatform === "antigravity" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Sparkles className="size-4 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Google Antigravity</div>
                  <div className="text-[11px] text-muted-foreground">Local OAuth 2.0 Loopback (:51121)</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Sign in with your Google account in your default browser. Nanami will capture the session automatically.
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                onClick={handleOpenGoogle}
              >
                <span>Open Sign-In in Browser</span>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </Button>

              <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-amber-500 shrink-0" />
                <span>
                  {antigravityConnecting
                    ? "Waiting for authorization on localhost:51121..."
                    : "Checking connection status automatically…"}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground/80 leading-snug">
                For accounts using Antigravity for the first time, authenticate once with the official app if verification is required.
              </p>
            </div>
          )}

          {/* Tab 2: Copilot */}
          {activePlatform === "copilot" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Sparkles className="size-4 text-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">GitHub Copilot</div>
                  <div className="text-[11px] text-muted-foreground">Student & Individual Device Authorization</div>
                </div>
              </div>

              {copilotFlow ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Copy your one-time activation code, then enter it on the GitHub device activation page:
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Activation Code</div>
                      <div className="text-base font-mono font-bold tracking-widest text-foreground">{copilotFlow.userCode}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={handleCopyCopilotCode}
                    >
                      {copiedCode ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          <span className="text-emerald-500">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                    onClick={handleOpenCopilot}
                  >
                    <span>Open GitHub Activation Page</span>
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </Button>

                  <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-emerald-500 shrink-0" />
                    <span>Waiting for device authorization on GitHub…</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-emerald-500" />
                  <span>Requesting device code from GitHub...</span>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: ChatGPT */}
          {activePlatform === "chatgpt" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background shadow-xs">
                  <Bot className="size-4 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">OpenAI / ChatGPT</div>
                  <div className="text-[11px] text-muted-foreground">Consumer Session & Direct API Key</div>
                </div>
              </div>

              {chatGptError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {chatGptError}
                </div>
              )}

              {chatGptAccount?.accessToken ? (
                <div className="flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs">
                  <span className="font-medium text-sky-400">Connected ChatGPT Session</span>
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-300">
                    {chatGptAccount.planType || "Active"}
                  </span>
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Sign in to ChatGPT in your browser, or paste an OpenAI API key below:
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium border-border/80 hover:bg-muted/50"
                onClick={handleOpenChatGpt}
              >
                <span>Open ChatGPT in Browser</span>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </Button>

              <div className="space-y-1.5 pt-1">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Key className="absolute left-3 top-2.5 size-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      disabled={chatGptConnecting}
                      className="w-full rounded-md border border-border/70 bg-muted/40 py-1.5 pl-8 pr-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 text-xs border-border/80 hover:bg-muted/50"
                    disabled={chatGptConnecting || !apiKeyInput.trim()}
                    onClick={() => void connectChatGptKey(apiKeyInput)}
                  >
                    {chatGptConnecting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "Save Key"
                    )}
                  </Button>
                </div>

                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                  onClick={handleOpenOpenAiKeys}
                >
                  Get an OpenAI API Key →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Standard Modal Footer */}
        <div className="border-t border-border px-5 py-3 flex items-center justify-between bg-muted/10">
          <span className="text-[11px] text-muted-foreground">
            This window will close once connected.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => window.location.reload()}
              title="Reload NanamiWork"
            >
              <RefreshCw className="size-3" />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
