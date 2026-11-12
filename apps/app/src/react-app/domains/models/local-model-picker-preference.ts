/** Managed and browser sessions require the registry-backed deployment flag. */
export function localModelPickerAvailable(input: {
  desktop: boolean;
  signedOut: boolean;
  managedEnabled: boolean;
}): boolean {
  return (input.desktop && input.signedOut) || input.managedEnabled;
}
