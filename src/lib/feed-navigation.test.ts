import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

test("reselecting the current view, media type and sort never leaves the feed loading", async t => {
  const { window } = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
  const browser = { window, document:window.document, HTMLElement:window.HTMLElement, history:{ replaceState() {} }, location:{ search:"",origin:"http://localhost" }, requestAnimationFrame:() => 0, IS_REACT_ACT_ENVIRONMENT:true };
  const originals = new Map(Object.keys(browser).map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(browser)) Object.defineProperty(globalThis,key,{ configurable:true,writable:true,value });
  Object.defineProperty(window,"location",{ configurable:true,value:browser.location });
  const item = { id:"video",sourceId:"source",sourceName:"Test channel",sourceKind:"youtube",guid:"dQw4w9WgXcQ",title:"Test video",url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",mediaType:"video",read:false,saved:false,readLater:false,progressSeconds:0,durationSeconds:100,publishedAt:"2026-10-06T10:00:00Z",createdAt:"2026-10-06T10:00:00Z" };
  let destroyed = 0;
  let playerOrigin: string | number | undefined;
  Object.defineProperty(window,"YT",{ configurable:true,value:{ Player:class {
    constructor(_element: unknown, options: { playerVars:Record<string,string | number> }) { playerOrigin = options.playerVars.origin; }
    destroy() { destroyed++; }
    getCurrentTime() { return 0; }
    getDuration() { return 100; }
  },PlayerState:{ ENDED:0,PLAYING:1,PAUSED:2 } } });
  let itemRequests = 0;
  t.mock.method(globalThis,"fetch",async (url: string) => {
    const data = url.includes("/auth/me") ? { user:{ id:"test",email:"test@example.test",name:null } } : url.includes("/sources") ? { sources:[] } : url.includes("/cron") ? {} : { items:[item],total:1,nextOffset:null,counts:{ inbox:1,all:1,saved:0,archive:0 } };
    if (url.includes("/api/items?")) itemRequests++;
    return new Response(JSON.stringify(data));
  });
  const { default:Home } = await import("../app/page");
  const root = createRoot(window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(createElement(Home)); });
    const click = async (selector: string, text: string) => {
      const button = [...window.document.querySelectorAll(selector)].find(element => element.textContent?.includes(text));
      assert.ok(button,`Missing button ${text}`);
      await act(async () => { button.dispatchEvent(new window.Event("click",{ bubbles:true })); });
      assert.equal(window.document.body.textContent?.includes("Chargement des flux…"),false);
    };
    assert.equal(itemRequests,1);
    await click(".video-thumb","▶");
    assert.ok(window.document.querySelector(".watch-panel"));
    assert.equal(playerOrigin,"http://localhost");
    await click(".side nav button","Nouveautés");
    assert.equal(window.document.querySelector(".watch-panel"),null);
    assert.equal(destroyed,1);
    await click(".content-nav button","Tous");
    await click(".content-filters button","Tous");
    await click(".side nav button","Bibliothèque");
    const afterChange = itemRequests;
    await click(".side nav button","Bibliothèque");
    assert.equal(itemRequests,afterChange);
  } finally {
    await act(async () => root.unmount());
    for (const [key,descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); }
  }
});
