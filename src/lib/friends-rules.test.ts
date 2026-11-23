import { describe, expect, it } from "vitest";
import {
  FRIEND_SEARCH_MAX_LENGTH,
  friendPairKey,
  isFriendsEnabled,
  normalizeFriendSearch,
  relationFor,
} from "./friends-rules";

describe("POTES_FRIENDS_ENABLED", () => {
  it("n'est actif que pour la valeur exacte « true »", () => {
    expect(isFriendsEnabled({})).toBe(false);
    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) expect(isFriendsEnabled({ POTES_FRIENDS_ENABLED: value })).toBe(false);
    expect(isFriendsEnabled({ POTES_FRIENDS_ENABLED: "true" })).toBe(true);
  });
});

describe("clé de paire", () => {
  it("est identique dans les deux sens (une seule ligne par paire)", () => {
    expect(friendPairKey("abc", "xyz")).toBe(friendPairKey("xyz", "abc"));
    expect(friendPairKey("abc", "xyz")).toBe("abc:xyz");
  });
  it("distingue deux paires différentes", () => {
    expect(friendPairKey("a", "b")).not.toBe(friendPairKey("a", "c"));
  });
});

describe("recherche par pseudo", () => {
  it("refuse tout ce qui n'est pas du texte de 2 à 32 caractères", () => {
    for (const bad of [undefined, null, 5, {}, "", " ", "a", " a ", "x".repeat(FRIEND_SEARCH_MAX_LENGTH + 1)]) expect(normalizeFriendSearch(bad)).toBeNull();
  });
  it("réduit les espaces et rogne", () => {
    expect(normalizeFriendSearch("  Zey   Fro ")).toBe("Zey Fro");
    expect(normalizeFriendSearch("ab")).toBe("ab");
    expect(normalizeFriendSearch("x".repeat(FRIEND_SEARCH_MAX_LENGTH))).toHaveLength(FRIEND_SEARCH_MAX_LENGTH);
  });
});

describe("relation vue par un membre", () => {
  const sent = { requesterId: "me", status: "PENDING" as const };
  it("soi-même, aucune ligne, amis", () => {
    expect(relationFor("me", "me", null)).toBe("self");
    expect(relationFor("me", "you", null)).toBe("none");
    expect(relationFor("me", "you", { requesterId: "you", status: "ACCEPTED" })).toBe("friend");
    expect(relationFor("me", "you", { requesterId: "me", status: "ACCEPTED" })).toBe("friend");
  });
  it("demande envoyée ou reçue", () => {
    expect(relationFor("me", "you", sent)).toBe("pending_sent");
    expect(relationFor("me", "you", { requesterId: "you", status: "PENDING" })).toBe("pending_received");
  });
  it("une demande refusée reste « envoyée » pour son auteur (refus jamais annoncé) et vaut « aucune » pour celui qui a refusé", () => {
    expect(relationFor("me", "you", { requesterId: "me", status: "DECLINED" })).toBe("pending_sent");
    expect(relationFor("me", "you", { requesterId: "you", status: "DECLINED" })).toBe("none");
  });
});
