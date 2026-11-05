/** Local builds never report free-tier analytics to a remote service. */
export function FreeAutoAnalyticsBridge() {
  // No usage bridge or retry traffic in the local Nanami build.
  return null;
}
