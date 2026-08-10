import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import { Peers } from "./peers";

type Msg = Parameters<Peers<Object3D>["onMessage"]>[0];

const join = (id: string): Msg => ({ type: "JOIN", text: id }) as Msg;
const leave = (id: string): Msg => ({ type: "LEAVE", text: id }) as Msg;
const init = (id: string): Msg => ({ type: "INIT", json: { id } }) as Msg;

const makePeers = () => {
  const peers = new Peers<Object3D>(new Object3D());
  peers.createPeer = (id: string) => {
    const avatar = new Object3D();
    avatar.name = id;
    return avatar;
  };
  const message = (msg: Msg) => peers.onMessage(msg, { username: "tester" });
  return { peers, message };
};

describe("Peers.collectShadowCasters", () => {
  it("returns the own avatar and every remote avatar's render root", () => {
    const { peers, message } = makePeers();
    const own = new Object3D();
    peers.setOwnPeer(own);
    message(init("me"));
    message(join("remote-a"));
    message(join("remote-b"));

    const out = peers.collectShadowCasters([]);
    expect(out).toContain(own);
    expect(out.map((o) => o.name)).toEqual(
      expect.arrayContaining(["remote-a", "remote-b"]),
    );
    expect(out).toHaveLength(3);
    // The roots handed out are the same objects parented into the scene
    // graph (the peers group), so hiding them during a cached world render
    // hides the actual rendered avatars.
    expect(peers.getPeerById("remote-a")?.parent).toBe(peers);
  });

  it("skips hidden avatars (first person, invisible peers)", () => {
    const { peers, message } = makePeers();
    const own = new Object3D();
    own.visible = false; // first person: own body not rendered
    peers.setOwnPeer(own);
    message(join("remote-a"));
    const remoteA = peers.getPeerById("remote-a");
    expect(remoteA).toBeDefined();
    if (remoteA) remoteA.visible = false;
    message(join("remote-b"));

    const out = peers.collectShadowCasters([]);
    expect(out.map((o) => o.name)).toEqual(["remote-b"]);
  });

  it("skips every avatar when the peers group itself is hidden", () => {
    // The documented way to hide multiplayer is toggling the Peers GROUP.
    // The shadow passes reparent collected roots out of the group, so a
    // group-hidden avatar must be filtered here — its own visible flag is
    // still true.
    const { peers, message } = makePeers();
    const own = new Object3D();
    peers.setOwnPeer(own);
    message(join("remote-a"));
    expect(peers.collectShadowCasters([])).toHaveLength(2);

    peers.visible = false;
    expect(peers.collectShadowCasters([])).toEqual([]);

    peers.visible = true;
    expect(peers.collectShadowCasters([])).toHaveLength(2);
  });

  it("tracks join, leave, and reconnect churn the same frame", () => {
    const { peers, message } = makePeers();
    message(init("me"));
    message(join("a"));
    message(join("b"));
    const originalA = peers.getPeerById("a") as Object3D;
    expect(peers.collectShadowCasters([])).toHaveLength(2);

    // Leave: the avatar drops out of the caster set and the scene graph
    // immediately — nothing left to bake or shadow.
    message(leave("a"));
    let out = peers.collectShadowCasters([]);
    expect(out.map((o) => o.name)).toEqual(["b"]);
    expect(originalA.parent).toBeNull();

    // Reconnect: a JOIN with the same id creates a fresh avatar; the old
    // render root never resurrects into the caster set.
    message(join("a"));
    out = peers.collectShadowCasters([]);
    expect(out).toHaveLength(2);
    expect(out).not.toContain(originalA);

    // Full disconnect: every remote leaves; only the own avatar remains.
    const own = new Object3D();
    peers.setOwnPeer(own);
    message(leave("a"));
    message(leave("b"));
    out = peers.collectShadowCasters([]);
    expect(out).toEqual([own]);
  });

  it("never lists the client's own peer twice and ignores its own JOIN", () => {
    const { peers, message } = makePeers();
    const own = new Object3D();
    peers.setOwnPeer(own);
    message(init("me"));
    message(join("me")); // servers echo the client's own join
    expect(peers.collectShadowCasters([])).toEqual([own]);
  });

  it("appends into the caller's scratch array without clearing it", () => {
    const { peers, message } = makePeers();
    message(join("a"));
    const pig = new Object3D();
    const out: Object3D[] = [pig];
    const returned = peers.collectShadowCasters(out);
    expect(returned).toBe(out);
    expect(out[0]).toBe(pig);
    expect(out).toHaveLength(2);
  });
});
