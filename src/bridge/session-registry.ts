let currentSessionToken: string | undefined;

export function setCurrentSessionToken(token: string | undefined): void {
  currentSessionToken = token;
}

export function getCurrentSessionToken(): string | undefined {
  return currentSessionToken;
}
