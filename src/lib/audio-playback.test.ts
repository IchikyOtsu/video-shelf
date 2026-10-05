import assert from "node:assert/strict";
import { test } from "node:test";
import { createAudioPlayback } from "./audio-playback";
import type { ProgressSample } from "./playback";
function fixture(initialProgress = 42) {
  const writes: ProgressSample[] = []; const progress: number[] = []; let completed = 0; let suppressed = false;
  const controller = createAudioPlayback({ initialProgress, initialDuration: 200, write: async sample => { writes.push(sample); }, progress: seconds => { progress.push(seconds); }, complete: () => { completed++; return true; }, suppressed: () => suppressed, warning: () => {} });
  return { controller, writes, progress, completed: () => completed, suppress: () => { suppressed = true; } };
}
test("podcast resumes after metadata loads and preserves progress until ready", async () => {
  const f = fixture(); const audio = { currentTime: 0, duration: 200 };
  f.controller.sample(audio, true); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.writes.length, 0);
  f.controller.loaded(audio); assert.equal(audio.currentTime, 42);
  audio.currentTime = 75; f.controller.sample(audio, true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes[0].progressSeconds, 75); assert.equal(f.writes[0].durationSeconds, 200);
});
test("near completion marks seen once and ended flushes final duration", async () => {
  const f = fixture(); const audio = { currentTime: 0, duration: 200 }; f.controller.loaded(audio);
  audio.currentTime = 180; f.controller.sample(audio); f.controller.sample(audio); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.completed(), 1);
  audio.currentTime = 200; f.controller.sample(audio, true, false, true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.completed(), 1); assert.equal(f.writes.at(-1)?.progressSeconds, 200);
});
test("manual mark-as-new suppresses automatic completion and completed episodes restart", async () => {
  const f = fixture(198); const audio = { currentTime: 0, duration: 200 }; f.controller.loaded(audio); assert.equal(audio.currentTime, 0);
  f.suppress(); audio.currentTime = 200; f.controller.sample(audio, true, false, true); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.completed(), 0);
});
test("metadata events after initialization never reset a seeked position", () => {
  const f = fixture(); const audio = { currentTime: 0, duration: 200 }; f.controller.loaded(audio); audio.currentTime = 90; f.controller.loaded(audio); assert.equal(audio.currentTime, 90);
});

test("opening an episode without pressing play does not save a reset position or mark it seen", async () => {
  let writes=0, completed=0;
  const controller=createAudioPlayback({requirePlaybackStart:true, initialProgress:198,initialDuration:200,write:async () => { writes++; },progress:() => {},complete:() => { completed++; return true; },suppressed:() => false,warning:() => {}});
  const audio={currentTime:0,duration:200}; controller.loaded(audio); assert.equal(audio.currentTime,0);
  controller.sample(audio,true); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes,0); assert.equal(completed,0);
  controller.start(); audio.currentTime=180; controller.sample(audio,true); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes,1); assert.equal(completed,1);
});
