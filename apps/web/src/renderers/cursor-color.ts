// UIX-392: this codebase has no existing per-member color convention (chat
// attribution and token ownership both render membership as plain text/
// avatars, not color), so cursor presence introduces a small deterministic
// hash -> HSL scheme rather than inventing per-campaign color assignment
// state. Same membershipId always yields the same color for every viewer,
// with no coordination required between clients.
export function cursorColorForMembership(membershipId: string): string {
  let hash = 0;
  for (let index = 0; index < membershipId.length; index++) {
    hash = (hash * 31 + membershipId.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 85%, 60%)`;
}
