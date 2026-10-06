import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedShortItemIds, youtubeFormatPlaylist } from "./youtube-shorts";

test("format playlists separate ordinary videos from Shorts for the same channel", () => {
  const channel = "UCln9P4Qm3-EAY4aiEPmRwEA";
  assert.equal(youtubeFormatPlaylist(channel, "videos"), "UULFln9P4Qm3-EAY4aiEPmRwEA");
  assert.equal(youtubeFormatPlaylist(channel, "shorts"), "UUSHln9P4Qm3-EAY4aiEPmRwEA");
  assert.throws(() => youtubeFormatPlaylist("@ado", "videos"));
});

test("cleanup matches confirmed Shorts imported as watch URLs while preserving other videos", () => {
  const rows = [
    { id: "watch-short", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" },
    { id: "mobile-short", url: "https://m.youtube.com/watch?v=aaaaaaaaaaa" },
    { id: "explicit-short", url: "https://www.youtube.com/shorts/bbbbbbbbbbb" },
    { id: "normal-video", url: "https://www.youtube.com/watch?v=ccccccccccc" },
    { id: "fake-host", url: "https://evil.test/watch?v=aaaaaaaaaaa" },
  ];
  assert.deepEqual(confirmedShortItemIds(rows, ["aaaaaaaaaaa"]), ["watch-short", "mobile-short", "explicit-short"]);
  assert.deepEqual(confirmedShortItemIds(rows, []), ["explicit-short"]);
});

test("cleanup recognizes the reported Short even with a mobile watch URL", () => {
  assert.deepEqual(confirmedShortItemIds([{ id:"short",url:"https://m.youtube.com/watch?v=LFIibTvPW6I" },{ id:"normal",url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],["LFIibTvPW6I"]),["short"]);
});
