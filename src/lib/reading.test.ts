import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReaderPreferences, readingIsComplete, readingPercent, resumeReadingPercent } from "./reading";
import { parseProgressUpdate, processProgressUpdate, ProgressSaveQueue } from "./playback";
test("article completion requires full content, attention and near-bottom position", () => {
  assert.equal(readingIsComplete(100,0,true,false),false);
  assert.equal(readingIsComplete(100,9,true,false),false);
  assert.equal(readingIsComplete(89,20,true,false),false);
  assert.equal(readingIsComplete(90,10,true,false),true);
  assert.equal(readingIsComplete(100,60,false,false),false);
  assert.equal(readingIsComplete(100,60,true,true),false);
});
test("reading resumes unfinished articles but re-reading completed articles starts at the top", () => {
  assert.equal(resumeReadingPercent(42,false),42); assert.equal(resumeReadingPercent(90,false),90);
  assert.equal(resumeReadingPercent(42,true),0); assert.equal(resumeReadingPercent(100,false),0);
  assert.equal(readingPercent(500,1500,500),50); assert.equal(readingPercent(0,200,500),100);
  assert.equal(readingPercent(-50,1500,500),0);
});
test("reader preferences survive round trips and reject unsupported styling values", () => {
  const preferences={size:22,font:"sans",width:"wide"};
  assert.deepEqual(parseReaderPreferences(JSON.parse(JSON.stringify(preferences))),preferences);
  assert.deepEqual(parseReaderPreferences({size:99,font:"<script>",width:"unsafe"}),{size:24,font:"serif",width:"comfortable"});
  assert.equal(parseReaderPreferences({size:NaN}).size,18);
});
test("article percentage uses the authenticated progress pipeline with throttled final saves", async () => {
  const writes: number[]=[];
  const queue=new ProgressSaveQueue(async sample => {
    await processProgressUpdate({itemId:"11111111-1111-4111-8111-111111111111",...sample},async () => true,async update => { assert.equal(update.durationSeconds,100); writes.push(update.progressSeconds); },20_000);
  });
  queue.observe(20,100,1000); await queue.persist(); queue.observe(21,100,2000); await queue.persist(); queue.observe(90,100,12000); await queue.persist(true,true);
  assert.deepEqual(writes,[20,90]);
});
test("podcasts can save progress before their duration is known", () => {
  assert.equal(parseProgressUpdate({itemId:"11111111-1111-4111-8111-111111111111",progressSeconds:30,durationSeconds:null}).durationSeconds,null);
});
