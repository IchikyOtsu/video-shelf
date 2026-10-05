import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { createCronDigestStore, type DigestQuery } from "./cron-digest-store";
import { itemImportStatement, insertedSyncResult, type CronImportContext } from "./item-import";
import { dailyCronRunId, deliverDigests, DigestDeliveryError, type DigestMessage } from "./daily-digest";
import { runScheduledSync } from "./scheduled-sync";
import { syncSourceBatch } from "./source-sync-batch";
import type { NormalizedItem, SourceSyncInput } from "./sources";

const database = new PGlite();
const dialect = new PgDialect();
const query: DigestQuery = async <T extends Record<string, unknown>>(statement: SQL) => {
  const { sql, params } = dialect.sqlToQuery(statement);
  return (await database.query<T>(sql, params)).rows;
};
const store = createCronDigestStore(query);
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const sourceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sourceC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const makeItem = (guid: string, mediaType = "video"): NormalizedItem => ({ guid, title: "Item " + guid, url: "https://example.test/" + guid, mediaType, publishedAt: new Date("2001-01-01T00:00:00Z") });
const fixture = new Map<string, NormalizedItem[]>();
let sends: { key: string; message: DigestMessage }[] = [];
let token = 0;
const delivery = (runId: string, deadlineMs: number, send = async (message: DigestMessage, key: string) => { sends.push({ key, message }); return 200; }) => deliverDigests(runId, store, {
  deadlineMs, token: () => `email-${++token}`, config: () => ({ appUrl: "https://shelf.test", from: "Shelf <updates@shelf.test>" }), send, wait: async () => {},
});
async function persist(source: SourceSyncInput, cron?: CronImportContext) {
  const rows = fixture.get(source.id) || [];
  if (!rows.length) return insertedSyncResult([]);
  return insertedSyncResult(await query<{ id: string; inserted: boolean }>(itemImportStatement(source.id, rows, cron)));
}
async function run(send?: (message: DigestMessage, key: string) => Promise<number>) {
  return runScheduledSync(store, { startedAt: Date.now(), token: `run-${++token}`, sync: async (source, options) => persist(source, options.cron), deliver: (runId, deadline) => delivery(runId, deadline, send) });
}
before(async () => {
  for (const file of readdirSync("drizzle").filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    await database.exec(readFileSync("drizzle/" + file, "utf8"));
  }
});
after(() => database.close());
beforeEach(async t => {
  if ("mock" in t) { t.mock.method(console, "info", () => {}); t.mock.method(console, "error", () => {}); }
  await database.exec("truncate users cascade; truncate cron_runs cascade;");
  await database.query("insert into users(id,email,password_hash) values ($1,'a@example.test','hash'),($2,'b@example.test','hash')", [userA, userB]);
  await database.query("insert into sources(id,user_id,name,feed_url,kind) values ($1,$4,'YouTube A','https://youtube.test/a','youtube'),($2,$4,'Articles B','https://rss.test/b','rss'),($3,$5,'Podcasts C','https://rss.test/c','rss')", [sourceA, sourceB, sourceC, userA, userB]);
  fixture.clear(); sends = [];
});

test("one digest per user groups YouTube and RSS sources, while zero-new-item users receive nothing", async () => {
  fixture.set(sourceA, [makeItem("video")]); fixture.set(sourceB, [makeItem("article", "article")]);
  const result = await run();
  assert.equal(result.imported, 2); assert.equal(result.emailsSent, 1); assert.equal(result.emailsFailed, 0);
  assert.equal(sends.length, 1); assert.equal(sends[0].message.to, "a@example.test");
  assert.ok(sends[0].message.html.includes("YouTube A")); assert.ok(sends[0].message.html.includes("Articles B"));
  assert.ok(sends[0].message.html.includes("Vidéo")); assert.ok(sends[0].message.html.includes("Article"));
  assert.ok(sends[0].message.html.includes("2001")); // Old publication dates still count if inserted now.
});

test("metadata-only updates are not new imports and preserve item ID and user state", async () => {
  fixture.set(sourceA, [makeItem("known")]);
  const inserted = await persist({ id: sourceA, kind: "youtube", feedUrl: "https://youtube.test/a" });
  const id = inserted.insertedItemIds[0];
  await database.query("insert into item_states(user_id,item_id,read,saved,progress_seconds) values ($1,$2,true,true,120)", [userA, id]);
  fixture.set(sourceA, [{ ...makeItem("known"), title: "Renamed", imageUrl: "https://example.test/new.jpg" }]);
  const result = await run();
  assert.equal(result.imported, 0); assert.equal(result.emailsSent, 0); assert.equal(sends.length, 0);
  const rows = await database.query<{ id: string; title: string; saved: boolean; read: boolean; progress_seconds: number }>("select i.id,i.title,s.saved,s.read,s.progress_seconds from items i join item_states s on s.item_id=i.id");
  assert.deepEqual(rows.rows[0], { id, title: "Renamed", saved: true, read: true, progress_seconds: 120 });
  assert.equal((await database.query("select * from cron_run_items")).rows.length, 0);
});

test("default-enabled preferences work for existing accounts and explicit opt-out prevents delivery", async () => {
  fixture.set(sourceA, [makeItem("video")]); fixture.set(sourceC, [makeItem("episode", "podcast")]);
  await database.query("insert into digest_preferences(user_id,enabled) values ($1,false)", [userA]);
  const result = await run();
  assert.equal(result.emailsSent, 1); assert.equal(sends[0].message.to, "b@example.test");
  assert.ok(sends[0].message.html.includes("Podcast"));
});

test("one provider failure does not affect another user's digest", async () => {
  fixture.set(sourceA, [makeItem("video")]); fixture.set(sourceC, [makeItem("episode", "podcast")]);
  const result = await run(async (message, key) => {
    if (message.to === "a@example.test") throw new DigestDeliveryError("PROVIDER_ERROR", 503);
    sends.push({ message, key }); return 200;
  });
  assert.equal(result.emailsSent, 1); assert.equal(result.emailsFailed, 1);
  assert.equal(sends[0].message.to, "b@example.test");
});

test("cron retry skips completed source synchronization and never resends successful digests", async () => {
  fixture.set(sourceA, [makeItem("video")]);
  await run();
  fixture.set(sourceA, [makeItem("different-video")]);
  const result = await run();
  assert.equal(result.emailsSent, 0); assert.equal(sends.length, 1);
  assert.equal((await database.query("select * from items")).rows.length, 1);
  assert.equal((await database.query("select * from cron_digests")).rows.length, 1);
});

test("acknowledgement loss retries the identical Resend payload/key without duplicate acceptance", async () => {
  fixture.set(sourceA, [makeItem("video")]);
  const accepted = new Map<string, string>(); let attempts = 0;
  const send = async (message: DigestMessage, key: string) => {
    attempts++;
    const body = JSON.stringify(message);
    if (accepted.has(key)) assert.equal(accepted.get(key), body); else accepted.set(key, body);
    if (attempts === 1) throw new DigestDeliveryError("NETWORK_ERROR");
    return 200;
  };
  await run(send);
  await database.query("update cron_run_items set title='Changed after first attempt'");
  const result = await run(send);
  assert.equal(attempts, 2); assert.equal(accepted.size, 1); assert.equal(result.emailsSent, 1);
});

test("a crash after insertion but before checkpointing retains exact imports for the resumed run", async () => {
  fixture.set(sourceA, [makeItem("video")]);
  const runId = dailyCronRunId(); const leaseToken = "crashed";
  await store.acquire(runId, leaseToken); await store.seed(runId, leaseToken);
  const result = await persist({ id: sourceA, kind: "youtube", feedUrl: "https://youtube.test/a" }, { runId, leaseToken });
  assert.equal(result.imported, 1);
  await database.query("update cron_runs set lease_until=now()-interval '1 second'");
  const resumed = await run();
  assert.equal(resumed.imported, 1); assert.equal(resumed.emailsSent, 1);
  assert.equal((await database.query("select * from cron_run_items")).rows.length, 1);
});

test("manual batch refresh creates no cron import ledger, outbox, or emails", async () => {
  fixture.set(sourceA, [makeItem("manual-video")]);
  const summary = await syncSourceBatch([{ id: sourceA, kind: "youtube", feedUrl: "https://youtube.test/a" }], async source => (await persist(source)).imported);
  assert.equal(summary.imported, 1); assert.equal(sends.length, 0);
  assert.equal((await database.query("select * from cron_run_items")).rows.length, 0);
  assert.equal((await database.query("select * from cron_digests")).rows.length, 0);
  assert.equal((await database.query("select * from cron_runs")).rows.length, 0);
});

test("emails cannot start until all source workers have completed", async () => {
  fixture.set(sourceA, [makeItem("video")]); fixture.set(sourceB, [makeItem("article", "article")]);
  let running = 0; let completed = 0;
  await runScheduledSync(store, { startedAt: Date.now(), token: "ordered-run", sync: async (source, options) => {
    running++; await new Promise<void>(resolve => setImmediate(resolve));
    const result = await persist(source, options.cron); running--; completed++; return result;
  }, deliver: (runId, deadline) => {
    assert.equal(running, 0); assert.equal(completed, 3);
    return delivery(runId, deadline);
  } });
  assert.equal(sends.length, 1);
});

test("snapshot limits displayed items to twenty but retains total count and inbox link", async () => {
  fixture.set(sourceA, Array.from({ length: 25 }, (_, i) => makeItem("video-" + i)));
  const result = await run();
  assert.equal(result.imported, 25); assert.equal(sends.length, 1);
  assert.ok(sends[0].message.subject.includes("25"));
  assert.equal((sends[0].message.html.match(/https:\/\/example.test\/video-/g) || []).length, 20);
  assert.ok(sends[0].message.html.includes("Voir toutes les nouveautés"));
  const rows = await database.query<{ payload: unknown[] }>("select payload from cron_digests");
  assert.equal(rows.rows[0].payload.length, 20);
});

test("disabled preference also suppresses a queued unsent retry", async () => {
  fixture.set(sourceA, [makeItem("video")]);
  await run(async () => { throw new DigestDeliveryError("PROVIDER_ERROR", 503); });
  await database.query("insert into digest_preferences(user_id,enabled) values ($1,false)", [userA]);
  const result = await run();
  assert.equal(result.emailsSent, 0); assert.equal(sends.length, 0);
});

test("expired uncertain deliveries are not resent after Resend's idempotency window", async () => {
  fixture.set(sourceA, [makeItem("video")]);
  await run(async () => { throw new DigestDeliveryError("NETWORK_ERROR"); });
  await database.exec("update cron_digests set first_attempt_at=now()-interval '24 hours'");
  const result = await run();
  assert.equal(result.emailsSent, 0); assert.equal(result.emailsFailed, 1); assert.equal(sends.length, 0);
  assert.equal((await database.query<{ status: string }>("select status from cron_digests")).rows[0].status, "abandoned");
});

test("overlapping cron requests cannot acquire the same run lease", async () => {
  assert.ok(await store.acquire(dailyCronRunId(), "first"));
  const result = await run();
  assert.equal(result.busy, true); assert.equal(sends.length, 0);
});

test("a finalized run rejects late item attribution from an old worker", async () => {
  const runId = dailyCronRunId(); const leaseToken = "sealed";
  await store.acquire(runId, leaseToken); await store.seed(runId, leaseToken); await store.seal(runId, leaseToken);
  fixture.set(sourceA, [makeItem("late-video")]);
  const result = await persist({ id: sourceA, kind: "youtube", feedUrl: "https://youtube.test/a" }, { runId, leaseToken });
  assert.equal(result.imported, 0);
  assert.equal((await database.query("select * from items")).rows.length, 0);
});

test("ledger write failure rolls back the item insert atomically", async () => {
  const runId = dailyCronRunId(); const leaseToken = "atomic";
  await store.acquire(runId, leaseToken);
  fixture.set(sourceA, [makeItem("atomic")]);
  await database.exec("create function reject_digest_ledger() returns trigger language plpgsql as $$ begin raise exception 'ledger unavailable'; end $$; create trigger reject_ledger before insert on cron_run_items for each row execute function reject_digest_ledger();");
  try {
    await assert.rejects(persist({ id: sourceA, kind: "youtube", feedUrl: "https://youtube.test/a" }, { runId, leaseToken }));
    assert.equal((await database.query<{ count: number }>("select count(*)::int as count from items")).rows[0].count, 0);
    assert.equal((await database.query<{ count: number }>("select count(*)::int as count from cron_run_items")).rows[0].count, 0);
  } finally { await database.exec("drop trigger reject_ledger on cron_run_items; drop function reject_digest_ledger();"); }
});

test("unsafe provider exceptions never reach logs and failures still permit other users", async t => {
  fixture.set(sourceA, [makeItem("video")]); fixture.set(sourceC, [makeItem("podcast", "podcast")]);
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const result = await run(async message => {
    if (message.to === "a@example.test") throw new Error("secret-token body a@example.test");
    return 200;
  });
  assert.equal(result.emailsFailed, 1); assert.equal(result.emailsSent, 1);
  const serialized = JSON.stringify(logs);
  assert.ok(serialized.includes(userA)); assert.ok(serialized.includes("DELIVERY_ERROR"));
  assert.ok(!serialized.includes("secret-token")); assert.ok(!serialized.includes("a@example.test"));
  assert.deepEqual(Object.keys(logs[0][1] as object).sort(), ["error", "itemCount", "status", "success", "userId"]);
});


test("full RSS content persists and refreshes without changing read/saved state or creating new digest imports", async () => {
  const item = { ...makeItem("reader", "article"), contentHtml: "<p>Full article</p>" };
  fixture.set(sourceB, [item]);
  await persist({ id: sourceB, kind: "rss", feedUrl: "https://rss.test/b" });
  fixture.set(sourceB, [{ ...item, contentHtml: "<h2>Updated article</h2>" }]);
  const result = await run();
  assert.equal(result.imported, 0); assert.equal(result.emailsSent, 0);
  const rows = await database.query<{ content_html: string }>("select content_html from items where guid = 'reader'");
  assert.equal(rows.rows[0].content_html, "<h2>Updated article</h2>");
});

test("initial RSS import creates read states atomically using the existing deterministic IDs", async () => {
  const item = makeItem("baseline", "article");
  const rows = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceB, [item], undefined, { initialImport: true }));
  const state = (await database.query<{ id: string; read: boolean; saved: boolean }>("select id, read, saved from item_states where item_id = $1", [rows[0].id])).rows[0];
  const { deterministicItemStateId } = await import("./item-state");
  assert.equal(state.id, deterministicItemStateId(userA, rows[0].id)); assert.equal(state.read, true); assert.equal(state.saved, false);
});

test("baseline retry repairs missing read states after an earlier partial import", async () => {
  const item = makeItem("partial-baseline", "article");
  const rows = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceB, [item]));
  assert.equal(rows[0].inserted, true);
  const retry = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceB, [item], undefined, { initialImport: true }));
  assert.equal(retry[0].inserted, false);
  const state = (await database.query<{ read: boolean }>("select read from item_states where item_id = $1", [rows[0].id])).rows[0];
  assert.equal(state.read, true);
});

test("baseline retry preserves an explicit unread/saved/progress state", async () => {
  const item = makeItem("manual-state", "article");
  const rows = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceB, [item], undefined, { initialImport: true }));
  await database.query("update item_states set read=false,saved=true,progress_seconds=42 where item_id=$1", [rows[0].id]);
  await query(itemImportStatement(sourceB, [item], undefined, { initialImport: true }));
  assert.deepEqual((await database.query("select read,saved,progress_seconds from item_states where item_id=$1", [rows[0].id])).rows[0], { read: false, saved: true, progress_seconds: 42 });
});

test("later RSS imports stay unread while initial podcast imports are read", async () => {
  const later = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceB, [makeItem("later", "article")]));
  const podcast = await query<{ id: string; inserted: boolean }>(itemImportStatement(sourceC, [makeItem("first-podcast", "podcast")], undefined, { initialImport: true }));
  const rows = (await database.query<{ item_id: string; read: boolean }>("select item_id, read from item_states")).rows;
  assert.ok(!rows.some(row => row.item_id === later[0].id)); assert.equal(rows.find(row => row.item_id === podcast[0].id)?.read, true);
});

test("visible automatic sync status contains only the authenticated user's counts and no digest details", async () => {
  const { automaticSyncStatus } = await import("./sync-status");
  fixture.set(sourceA,[makeItem("video")]); fixture.set(sourceB,[makeItem("article","article")]); fixture.set(sourceC,[makeItem("podcast","podcast")]);
  await run();
  const statusA = await automaticSyncStatus(query,userA); const statusB = await automaticSyncStatus(query,userB);
  assert.equal(statusA?.synced,2); assert.equal(statusA?.imported,2); assert.equal(statusA?.emailsSent,1);
  assert.equal(statusB?.synced,1); assert.equal(statusB?.imported,1); assert.equal(statusB?.emailsSent,1);
  assert.equal(statusA?.phase,"complete"); assert.equal(statusA?.running,false);
  await database.query("delete from sources where id=$1",[sourceA]);
  assert.equal((await automaticSyncStatus(query,userA))?.synced,2); assert.doesNotMatch(JSON.stringify(statusA),/recipient|example.test|payload|leaseToken|message/);
});
test("global content search and combined filters remain isolated between accounts", async () => {
  const { buildItemCondition, itemStateJoin } = await import("./item-query");
  fixture.set(sourceA,[{ ...makeItem("a","podcast"),title:"Episode",author:"Ada",contentHtml:"<p>A hidden comet discovery</p>" }]);
  fixture.set(sourceC,[{ ...makeItem("b","podcast"),title:"Private",contentHtml:"<p>A hidden comet discovery</p>" }]);
  await persist({ id:sourceA,kind:"youtube",feedUrl:"https://example.test/a" }); await persist({ id:sourceC,kind:"rss",feedUrl:"https://example.test/c" });
  await database.query("update sources set category='Tech'");
  await database.query("insert into item_states (user_id,item_id,saved,read,progress_seconds) select s.user_id,i.id,true,false,60 from items i join sources s on s.id=i.source_id");
  const { sql:rawSql,params } = dialect.sqlToQuery((await import("drizzle-orm")).sql`select items.title from items join sources on sources.id=items.source_id left join item_states on ${itemStateJoin(userA)} where ${buildItemCondition({ view:"all",sourceId:"",query:"comet",contentType:"podcast",category:"Tech",savedOnly:true,status:"in_progress" },userA)}`);
  assert.deepEqual((await database.query(rawSql,params)).rows,[{ title:"Episode" }]);
});

test("bulk category moves reject a mixed-owner selection atomically and preserve other users", async () => {
  const { moveCategoryStatement } = await import("./source-category");
  assert.equal((await query(moveCategoryStatement(userA,[sourceA,sourceC],"Gaming"))).length,0);
  assert.equal((await database.query("select id from sources where category='Gaming'")).rows.length,0);
  assert.equal((await query(moveCategoryStatement(userA,[sourceA,sourceB],"Tech"))).length,2);
  assert.equal((await database.query<{ category:string }>("select category from sources where id=$1",[sourceC])).rows[0].category,"Unsorted");
});
test("atomic rate limits count concurrent requests without bypass and reset expired windows", async () => {
  const { rateLimitStatement } = await import("./rate-limit");
  await database.exec("truncate auth_rate_limits");
  const attempts = await Promise.all(Array.from({ length:20 },() => query<{ count:number }>(rateLimitStatement("key",60_000))));
  assert.deepEqual(attempts.map(row => row[0].count).sort((a,b) => a-b),Array.from({ length:20 },(_,i) => i+1));
  await database.exec("update auth_rate_limits set window_started_at=now() - interval '2 minutes'");
  assert.equal((await query<{ count:number }>(rateLimitStatement("key",60_000)))[0].count,1);
});

test("one-use password reset cannot be replayed concurrently and never updates another account", async () => {
  const { consumePasswordReset } = await import("./password-reset");
  const tokenId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await database.query("insert into password_reset_tokens(id,user_id,token_hash,expires_at) values ($1,$2,'hashed-token',now() + interval '1 hour')",[tokenId,userA]);
  const attempts = await Promise.all([query(consumePasswordReset(tokenId,"new-hash")),query(consumePasswordReset(tokenId,"replayed-hash"))]);
  assert.equal(attempts.reduce((count,rows) => count+rows.length,0),1);
  assert.deepEqual((await database.query("select password_hash,session_version from users where id=$1",[userA])).rows,[{ password_hash:"new-hash",session_version:1 }]);
  assert.deepEqual((await database.query("select password_hash,session_version from users where id=$1",[userB])).rows,[{ password_hash:"hash",session_version:0 }]);
});
