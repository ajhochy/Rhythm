/** Presentation only; the signed-in user remains the authority for account-scoped behavior. */
export function displayAccountIdentity(userName?: string): { name: string; initials: string } {
  const name = userName?.trim() || 'AJ Hochhalter'; // Studio fixture's existing demo label.
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.slice(0, 2).map((word) => Array.from(word)[0].toLocaleUpperCase()).join('') || 'AJ';
  return { name, initials };
}
