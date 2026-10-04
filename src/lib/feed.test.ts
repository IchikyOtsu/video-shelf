import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYouTubeFeed } from "./feed";

test("YouTube feed sync excludes Shorts while retaining normal videos", () => {
  const items = parseYouTubeFeed(`<feed xmlns:yt="x">
    <entry><yt:videoId>short-id</yt:videoId><title>Short</title><link rel="alternate" href="https://www.youtube.com/shorts/short-id"/></entry>
    <entry><yt:videoId>video-id</yt:videoId><title>Vidéo</title><link rel="alternate" href="https://www.youtube.com/watch?v=video-id"/></entry>
  </feed>`);
  assert.deepEqual(items.map(item => item.guid), ["video-id"]);
});
