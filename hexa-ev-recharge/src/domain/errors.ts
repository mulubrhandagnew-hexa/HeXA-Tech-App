export type HubErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "unavailable";

/** Domain error carrying a code the API maps to an HTTP status (400 / 403 / 404 / 409 / 503). */
export class HubError extends Error {
  constructor(
    readonly code: HubErrorCode,
    message: string,
  ) {
    super(message);
  }
}
