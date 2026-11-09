import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ModelPickerPageHost = {
  host: HTMLDivElement | null;
  setHost: (host: HTMLDivElement | null) => void;
  active: boolean;
  setActive: (active: boolean) => void;
};

const Context = createContext<ModelPickerPageHost | null>(null);

/** Keeps chat mounted while the picker occupies the workspace page. */
export function ModelPickerPageHostProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const value = useMemo(() => ({ host, setHost, active, setActive }), [host, active]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useModelPickerPageHost() {
  return useContext(Context);
}
