/** @jsxImportSource react */
import {
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH,
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
  MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  useUiStateStore,
} from "./ui-state-store";

type WorkspaceShellLayoutOptions = {
  expandedRightWidth: number;
  collapsedRightWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * The left navigation is an inline dock with a fixed design width. Only the
 * optional work panel remains resizable, so narrow desktop windows reflow
 * predictably without resize rails or global cursor changes.
 */
export function useWorkspaceShellLayout(options: WorkspaceShellLayoutOptions) {
  const collapsedRightWidth = Math.max(
    56,
    options.collapsedRightWidth ?? DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH,
  );
  const expandedRightWidth = Math.max(collapsedRightWidth, options.expandedRightWidth);
  const minRightWidth = Math.max(collapsedRightWidth, options.minRightWidth ?? MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH);
  const maxRightWidth = Math.max(minRightWidth, options.maxRightWidth ?? MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH);
  const defaultRightWidth = clampNumber(
    expandedRightWidth || DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
    minRightWidth,
    maxRightWidth,
  );

  const rightSidebarExpanded = useUiStateStore((state) => state.workspaceRightSidebarExpanded);
  const rightSidebarExpandedWidth = useUiStateStore((state) =>
    clampNumber(state.workspaceRightSidebarExpandedWidth || defaultRightWidth, minRightWidth, maxRightWidth),
  );
  const setRightSidebarExpanded = useUiStateStore((state) => state.setWorkspaceRightSidebarExpanded);
  const setRightSidebarExpandedWidth = useUiStateStore((state) => state.setWorkspaceRightSidebarExpandedWidth);
  const toggleRightSidebar = useUiStateStore((state) => state.toggleWorkspaceRightSidebar);

  return {
    rightSidebarExpanded,
    rightSidebarExpandedWidth,
    rightSidebarWidth: rightSidebarExpanded ? rightSidebarExpandedWidth : collapsedRightWidth,
    setRightSidebarExpanded,
    setRightSidebarExpandedWidth,
    toggleRightSidebar,
  };
}
