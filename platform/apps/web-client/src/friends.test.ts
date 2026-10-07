import { describe, expect, it } from "vitest";
import type { FriendLists, FriendView } from "./api";
import { friendLine, friendNotices } from "./friends";

const friend = (username: string, online: boolean, last_seen_at: string | null = null): FriendView => ({
  player: `p-${username}`,
  username,
  online,
  world: online ? "main" : null,
  last_seen_at,
  since: null,
});
const lists = (friends: FriendView[], incoming: string[] = []): FriendLists => ({
  friends,
  incoming: incoming.map((u) => ({ player: `p-${u}`, username: u })),
  outgoing: [],
  limit: 200,
});

describe("friends", () => {
  it("says where a friend is or when they were seen", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(friendLine(friend("ana", true), now)).toBe("online in main");
    expect(friendLine(friend("bo", false), now)).toBe("not seen yet");
    expect(friendLine(friend("bo", false, "2026-10-04T11:59:40Z"), now)).toBe("seen just now");
    expect(friendLine(friend("bo", false, "2026-10-04T11:55:00Z"), now)).toBe("seen 5 min ago");
    expect(friendLine(friend("bo", false, "2026-10-04T09:00:00Z"), now)).toBe("seen 3 h ago");
    expect(friendLine(friend("bo", false, "2026-09-30T12:00:00Z"), now)).toBe("seen 4 days ago");
  });

  it("toasts friends coming online, new friends and new requests", () => {
    expect(friendNotices(null, lists([friend("ana", true)]))).toEqual([]);
    expect(friendNotices(null, lists([], ["cy"]))).toEqual(["1 friend request(s) waiting (O)"]);
    const before = lists([friend("ana", false), friend("bo", true)], ["cy"]);
    const after = lists([friend("ana", true), friend("bo", false), friend("di", false)], ["cy", "ed"]);
    expect(friendNotices(before, after)).toEqual(["ana is online", "di is now your friend", "ed wants to be friends (O)"]);
    expect(friendNotices(after, after)).toEqual([]);
  });
});
