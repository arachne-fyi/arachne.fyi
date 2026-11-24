/**
 * Podium order: 2nd, 1st, 3rd, so first place stands in the middle.
 *
 * Every slot gets a key that can't clash: "user-12" for a player, "empty-2" for a free place.
 * The old code keyed players by their id (a number) and empty places by their position
 * (0, 1, 2). With user 2 on the podium and the third place empty, two boxes had the key 2;
 * React then couldn't tell them apart and kept old boxes when the ranking changed.
 */
export function podiumSlots<T extends { userId: number }>(rows: readonly T[]): { key: string; row: T | undefined; place: 1 | 2 | 3 }[] {
  return ([1, 0, 2] as const).map((i) => {
    const row = rows[i];
    return { key: row ? `user-${row.userId}` : `empty-${i}`, row, place: (i + 1) as 1 | 2 | 3 };
  });
}
