/** @jsxImportSource react */
import * as React from "react";
import { Bot, ExternalLink, Key, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openDesktopUrl } from "@/app/lib/desktop";
import { useChatGptAccountsStore } from "./chatgpt-accounts-store";

export function ChatGptAuthModal() {
  const modalOpen = useChatGptAccountsStore((s) => s.modalOpen);
  const setModalOpen = useChatGptAccountsStore((s) => s.setModalOpen);
  const isConnecting = useChatGptAccountsStore((s) => s.isConnecting);
  const error = useChatGptAccountsStore((s) => s.error);
  const connectApiKey = useChatGptAccountsStore((s) => s.connectApiKey);

  const [apiKeyInput, setApiKeyInput] = React.useState("");

  const handleOpenOpenAiKeys = () => {
    void openDesktopUrl("https://platform.openai.com/api-keys");
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await connectApiKey(apiKeyInput);
    if (success) {
      setApiKeyInput("");
    }
  };

  return (
    <Dialog
      open={modalOpen}
      onOpenChange={(open) => {
        if (!open) {
          setModalOpen(false);
          setApiKeyInput("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4 text-sky-500" />
            Connect ChatGPT (OpenAI)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Connect your OpenAI account or API key to access GPT-4o, o1, and o3-mini models.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConnect} className="flex flex-col gap-4 py-2">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted-foreground">
              1. Enter your OpenAI API key:
            </span>

            <div className="relative flex items-center">
              <Key className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                disabled={isConnecting}
                className="w-full rounded-lg border bg-muted/40 px-3 py-2 pl-9 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>

            <span className="text-xs text-muted-foreground">
              2. Need an API key? Create one in your OpenAI platform dashboard:
            </span>

            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={handleOpenOpenAiKeys}
            >
              <span>Open OpenAI API Keys Page</span>
              <ExternalLink className="size-3.5" />
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isConnecting}
              onClick={() => {
                setModalOpen(false);
                setApiKeyInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isConnecting || !apiKeyInput.trim()}
              className="gap-2"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Verifying Key...</span>
                </>
              ) : (
                <span>Connect Account</span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
