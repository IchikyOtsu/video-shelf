import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { request, ApiError } from "./client";

test("timeout includes a response body that stalls after successful headers", async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders(); res.write('{"items":'); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await assert.rejects(request(`http://127.0.0.1:${address.port}`, { timeoutMs:100 }), error => error instanceof ApiError && error.code === "REQUEST_TIMEOUT");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("invalid successful JSON is a recoverable API error, not an empty feed", async t => {
  t.mock.method(globalThis,"fetch",async () => new Response("not json"));
  await assert.rejects(request("/api/items"), error => error instanceof ApiError && error.code === "INVALID_RESPONSE");
});
test("external cancellation remains connected while reading the body", async t => {
  const external = new AbortController();
  t.mock.method(globalThis,"fetch",async (_input: unknown, init: RequestInit) => ({ ok:true, json: () => new Promise((_resolve,reject) => { init.signal?.addEventListener("abort",() => reject(init.signal?.reason),{ once:true }); external.abort(new Error("navigated")); }) }));
  await assert.rejects(request("/api/items",{ signal:external.signal }),/navigated/);
});
test("already-cancelled requests propagate their signal, and provider error details survive", async t => {
  const external = new AbortController(); external.abort(new Error("cancelled"));
  t.mock.method(globalThis,"fetch",async (_input: unknown, init: RequestInit) => { assert.equal(init.signal?.aborted,true); throw init.signal?.reason; });
  await assert.rejects(request("/api/items",{ signal:external.signal }),/cancelled/);
  t.mock.method(globalThis,"fetch",async () => new Response(JSON.stringify({ error:"Forbidden",code:"DENIED" }),{ status:403 }));
  await assert.rejects(request("/api/items"),error => error instanceof ApiError && error.status === 403 && error.code === "DENIED");
});
