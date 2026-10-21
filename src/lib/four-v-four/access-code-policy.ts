// The same limits apply to local and production logins and password changes.
export const ACCESS_CODE_MIN_LENGTH = 3;
export const ACCESS_CODE_MAX_LENGTH = 64;

export function isValidAccessCode(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= ACCESS_CODE_MIN_LENGTH && value.length <= ACCESS_CODE_MAX_LENGTH;
}
