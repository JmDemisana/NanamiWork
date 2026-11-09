/** @jsxImportSource react */
import { Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMacPlatform } from "@/app/utils";
import { t } from "@/i18n";

export type ConversationHistoryControls = {
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (direction: "back" | "forward") => void;
};

function SidebarToggle({ surface }: { surface: "sidebar" | "main" }) {
  const { open } = useSidebar();
  return (
    <SidebarTrigger
      data-sidebar-toggle={surface}
      data-testid={`${surface}-sidebar-toggle`}
      className="size-8! rounded-lg text-muted-foreground transition-colors hover:bg-muted titlebar-no-drag"
      aria-expanded={open}
      aria-keyshortcuts={isMacPlatform() ? "Meta+B" : "Control+B"}
      title={`Toggle sidebar (${isMacPlatform() ? "⌘B" : "Ctrl+B"})`}
      onClick={() => {
        // The clicked control moves with the sidebar. Keep keyboard focus on
        // its visible counterpart rather than inside the now-inert panel.
        requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>(`[data-sidebar-toggle="${open ? "main" : "sidebar"}"]`)?.focus({ preventScroll: true });
        });
      }}
    />
  );
}

export function SidebarTitlebar() {
  return (
    <div data-sidebar-titlebar className="window-titlebar mac-window-controls-inset flex shrink-0 items-center gap-1 px-2 titlebar-drag">
      <SidebarToggle surface="sidebar" />
    </div>
  );
}

/** One search/settings pair, in the brand row or the main titlebar when hidden. */
export function SidebarActions({ onOpenSessionSearch, onOpenSettings }: { onOpenSessionSearch?: () => void; onOpenSettings?: () => void; onOpenInstances?: () => void }) {
  const triggerSettings = onOpenSettings ?? (() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
  });
  return (
    <div data-sidebar-actions className="flex shrink-0 items-center gap-0.5 titlebar-no-drag">
      {onOpenSessionSearch ? (
        <Tooltip>
          <TooltipTrigger render={
            <Button variant="ghost" size="icon-sm" className="rounded-lg text-muted-foreground transition-colors hover:bg-muted"
              aria-label={t("workspace_list.search_sessions")}
              aria-keyshortcuts={isMacPlatform() ? "Meta+Shift+F" : "Control+Shift+F"}
              onClick={onOpenSessionSearch}>
              <Search strokeWidth={1.5} />
            </Button>
          } />
          <TooltipContent>{t("workspace_list.search_sessions")} ({isMacPlatform() ? "⌘⇧F" : "Ctrl+Shift+F"})</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger render={
          <Button variant="ghost" size="icon-sm" className="rounded-lg text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Settings"
            aria-keyshortcuts={isMacPlatform() ? "Meta+," : "Control+,"}
            data-sidebar-settings
            onClick={triggerSettings}>
            <Settings strokeWidth={1.5} className="size-4" />
          </Button>
        } />
        <TooltipContent>Settings ({isMacPlatform() ? "⌘," : "Ctrl+,"})</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function MainSidebarControls({ onOpenSessionSearch, onOpenSettings, onOpenInstances }: { onOpenSessionSearch?: () => void; onOpenSettings?: () => void; onOpenInstances?: () => void }) {
  const { open } = useSidebar();
  if (open) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 titlebar-no-drag">
      <SidebarToggle surface="main" />
      <SidebarActions onOpenSessionSearch={onOpenSessionSearch} onOpenSettings={onOpenSettings} onOpenInstances={onOpenInstances} />
    </div>
  );
}
