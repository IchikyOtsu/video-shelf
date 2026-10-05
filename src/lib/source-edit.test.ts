import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceEdit, resolveSourceEdit } from "./source-edit";
const edit = {name:"Mon titre", feedUrl:"https://example.com/rss", siteUrl:"https://example.com", imageUrl:"https://example.com/image.jpg", category:"Tech"};
const source = {feedUrl:edit.feedUrl, contentType:"article"};
test("explicit source metadata does not fetch or overwrite custom fields", async () => {
  const result = await resolveSourceEdit(parseSourceEdit(edit), source, async () => { throw new Error("Must not fetch"); });
  assert.deepEqual(result, {...edit,contentType:"article"});
});
test("blank title, website and image are resolved with one provider inspection", async () => {
  let calls=0;
  const result=await resolveSourceEdit(parseSourceEdit({...edit,name:" ",siteUrl:"",imageUrl:""}),source,async () => { calls++; return {name:"Titre du flux",siteUrl:"https://example.com/news",imageUrl:"https://example.com/cover.jpg",contentType:"podcast"}; });
  assert.equal(calls,1); assert.equal(result.name,"Titre du flux"); assert.equal(result.contentType,"podcast"); assert.equal(result.siteUrl,"https://example.com/news");
});
test("changed feed is checked even when all metadata is explicit", async () => {
  let checked="";
  const result=await resolveSourceEdit({...edit,feedUrl:"https://example.com/new-feed"},source,async url => { checked=url; return {name:"Remote",siteUrl:null,imageUrl:null,contentType:"article",feedUrl:"https://example.com/canonical"}; });
  assert.equal(checked,"https://example.com/new-feed"); assert.equal(result.name,"Mon titre"); assert.equal(result.feedUrl,"https://example.com/canonical");
});
test("provider failure aborts an edit and unsafe discovered links are ignored", async () => {
  await assert.rejects(resolveSourceEdit({...edit,name:""},source,async () => { throw new Error("TIMEOUT"); }),/TIMEOUT/);
  const result=await resolveSourceEdit({...edit,name:"",siteUrl:"",imageUrl:""},source,async () => ({name:null,siteUrl:"javascript:alert(1)",imageUrl:"https://user:secret@example.com/img",contentType:"article"}));
  assert.equal(result.name,"example.com"); assert.equal(result.siteUrl,null); assert.equal(result.imageUrl,null);
});
test("malformed, authenticated, unsafe or oversized metadata is rejected", () => {
  for(const url of ["javascript:alert(1)","file:///etc/passwd","https://user:secret@example.com/rss","bad"])
    assert.throws(() => parseSourceEdit({...edit,feedUrl:url}));
  assert.throws(() => parseSourceEdit({...edit,name:42})); assert.throws(() => parseSourceEdit({...edit,name:"a".repeat(201)}));
  assert.throws(() => parseSourceEdit({...edit,imageUrl:"data:image/png;base64,AA"}));
});
