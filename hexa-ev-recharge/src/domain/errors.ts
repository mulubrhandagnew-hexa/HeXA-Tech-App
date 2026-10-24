export type HubErrorCode = "invalid" | "not_found" | "conflict";

/** Domain error carrying a code the API maps to an HTTP status (400 / 404 / 409). */
export class HubError extends Error {
  constructor(
    readonly code: HubErrorCode,
    message: string,
  ) {
    super(message);
  }
}
