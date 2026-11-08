/** Focus guard (spec 5.13): while a sprint is active, at most N ideas (seed 2) are in Testing. */
export function testingGuard(ideas: { id: string; status: string; is_archived: boolean }[], movingId: string, sprintActive: boolean, limit: number) {
  const testing = ideas.filter((i) => !i.is_archived && i.status === "testing" && i.id !== movingId);
  if (!sprintActive || testing.length < limit) return { ok: true as const, mustPark: [] as string[] };
  return { ok: false as const, mustPark: testing.map((i) => i.id) };
}
