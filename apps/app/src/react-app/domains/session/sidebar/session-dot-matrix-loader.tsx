/** @jsxImportSource react */
import { OwDotTicker } from "@/react-app/shell/dot-ticker";
import { cn } from "@/lib/utils";

type SessionDotMatrixLoaderProps = {
  className?: string;
  label: string;
};

/** Match the startup ticker while retaining the sidebar status announcement. */
export function SessionDotMatrixLoader({ className, label }: SessionDotMatrixLoaderProps) {
  return (
    <span data-session-loading-indicator role="status" aria-label={label} title={label}
      className={cn("ow-sidebar-activity inline-flex shrink-0 items-center justify-center text-sidebar-foreground", className)}>
      <OwDotTicker size="md" />
    </span>
  );
}
