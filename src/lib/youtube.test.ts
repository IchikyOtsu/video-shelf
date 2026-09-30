import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChannelResults, resolveYouTubeChannel } from "./youtube";
import { youtubeVideoId } from "./video";

test("only valid YouTube video URLs become embeds", () => {
  for (const url of ["https://youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ"]) assert.equal(youtubeVideoId(url), "dQw4w9WgXcQ");
  for (const url of ["https://evil.test/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com/watch?v=bad"]) assert.equal(youtubeVideoId(url), null);
});
test("search extracts channels, combines title runs and removes duplicates", () => {
  const channel = { channelRenderer: { channelId: "UCHnyfMqiRRG1u-2MsSQLbXA", title: { runs: [{ text: "Veri" }, { text: "tasium" }] }, thumbnail: { thumbnails: [{ url: "//example.com/avatar.jpg" }] } } };
  const page = '<script>var ytInitialData = ' + JSON.stringify({ contents: [channel, channel, { videoRenderer: { title: "Not a channel" } }] }) + ';</script>';
  assert.deepEqual(parseChannelResults(page), [{ channelId: "UCHnyfMqiRRG1u-2MsSQLbXA", name: "Veritasium", description: "", imageUrl: "https://example.com/avatar.jpg" }]);
  assert.throws(() => parseChannelResults("<html>Consent required</html>"), /indisponible/);
});
test("channel resolution rejects other hosts before fetching", async () => {
  await assert.rejects(resolveYouTubeChannel("https://example.com/channel/test"), /YouTube/);
});

test("handle resolution prefers channel metadata over recommended video owners", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<meta property="og:title" content="Veritasium"><script>{"channelId":"UCin0m13qWv3-051xlWlHamA","externalId":"UCHnyfMqiRRG1u-2MsSQLbXA"}</script>');
  try {
    assert.equal((await resolveYouTubeChannel("@veritasium")).channelId, "UCHnyfMqiRRG1u-2MsSQLbXA");
  } finally { globalThis.fetch = original; }
});
