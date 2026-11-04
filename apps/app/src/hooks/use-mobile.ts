import * as React from "react";

// The desktop app is a resizable window, not a phone: OpenWork's original 1024px
// cut-off made the sidebar vanish (and switch to sheet mode) as soon as the
// window was narrower than a tablet, which reads as broken in a desktop shell.
// 768px is the shadcn default and matches the `md:` styles the Sidebar is built
// on, so the inline sidebar survives down to genuinely small windows.
const MOBILE_BREAKPOINT = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

export function getInitialIsMobile(matchMedia?: (query: string) => { matches: boolean }) {
  return matchMedia?.(MOBILE_MEDIA_QUERY).matches ?? false
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    getInitialIsMobile(typeof window === "undefined" ? undefined : (query) => window.matchMedia(query)),
  )

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
