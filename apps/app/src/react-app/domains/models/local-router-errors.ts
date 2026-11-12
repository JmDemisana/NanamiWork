/** A candidate was confirmed exhausted before a prompt was submitted. */
export class LocalRouterQuotaExhaustedError extends Error {
  constructor() {
    super("The selected account or model is out of quota.");
    this.name = "LocalRouterQuotaExhaustedError";
  }
}
