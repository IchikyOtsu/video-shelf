import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYouTubeBatch, syncBatchSources } from "./source-batch";

const first = { kind: "youtube", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", name: "One" };
const second = { kind: "youtube", channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", name: "Two" };

test("a YouTube batch validates, deduplicates and derives trusted provider metadata", () => {
  const result = parseYouTubeBatch({ sources: [first, first, second] });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].contentType, "video");
  assert.equal(result.candidates[0].feedUrl, "https://www.youtube.com/feeds/videos.xml?channel_id=" + first.channelId);
  assert.deepEqual(result.failed, []);
});

test("invalid batch entries fail independently from valid selections", () => {
  const result = parseYouTubeBatch({ sources: [first, { kind: "youtube", channelId: "bad", name: "Broken" }] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /invalide/);
});

test("batch synchronization reports partial failures without losing inserted sources", async () => {
  const sources = [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
  const result = await syncBatchSources(sources, async source => {
    if (source.id === "two") throw new Error("Feed unavailable");
    return 4;
  });
  assert.equal(result.imported, 4);
  assert.deepEqual(result.added.map(value => value.source.id), ["one"]);
  assert.deepEqual(result.failed, [{ name: "Two", error: "Feed unavailable", added: true }]);
});
