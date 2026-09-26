const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./helpers/load-ts.cjs");
const { comparePublications } = load("shared/domain/publication-order.ts");
const { mapTask, mapProgram, mapAnnouncement } = load("frontend/shared/api/client.ts");
const currentKey = "@/backend/http/current-user";
const dbKey = "@/backend/infrastructure/supabase/admin-client";

test("new publications go last; pin/unpin preserves original chronology even after edits", () => {
  const rows = [
    { id: "new", createdAt: "2026-09-27T10:00:00Z", isPinned: false },
    { id: "old", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-27T12:00:00Z" },
    { id: "middle", createdAt: "2026-09-15T10:00:00Z" },
  ];
  const ids = () => [...rows].sort(comparePublications).map((row) => row.id);
  assert.deepEqual(ids(), ["old", "middle", "new"]);
  rows[0].isPinned = true; rows[2].isPinned = true;
  assert.deepEqual(ids(), ["middle", "new", "old"]);
  rows[0].isPinned = false; rows[2].isPinned = false;
  assert.deepEqual(ids(), ["old", "middle", "new"]);
  assert.ok(comparePublications({ id: "a", createdAt: "2026-09-27" }, { id: "b", createdAt: "2026-09-27" }) < 0);
  for (const mapper of [mapTask, mapProgram, mapAnnouncement]) {
    assert.equal(mapper({ id: "p", is_pinned: true }).isPinned, true);
    assert.equal(mapper({ id: "p", is_pinned: false }).isPinned, false);
    assert.equal(mapper({ id: "p" }).isPinned, false);
  }
});

for (const [kind, handler, serviceMethod] of [["tasks", "updateTask", "patchTask"], ["programs", "patchProgram", "updateProgram"], ["announcements", "updateAnnouncement", "patchAnnouncement"]]) {
  test(kind + " pin endpoint rejects non-booleans and unauthorised users before writing", async () => {
    let actor = { id: "owner", role: "member", teamId: "team", canPublishTasks: true };
    const writes = [];
    const controller = load("backend/controllers/" + kind + ".controller.ts", {
      [currentKey]: { getCurrentUser: async () => actor },
      ["@/backend/services/" + kind + ".service"]: { [serviceMethod]: async (id, patch, user) => { writes.push({ id, patch, user }); return { data: { id, is_pinned: patch.isPinned } }; } },
    });
    const id = "a98a099e-8d8c-4cfb-882b-dcc6b56f845f";
    const request = value => new Request("http://localhost/api/" + kind + "/" + id, { method: "PATCH", body: JSON.stringify({ isPinned: value }) });
    for (const value of [null, "false", 0, {}, []]) assert.equal((await controller[handler](request(value), id)).status, 400);
    assert.equal(writes.length, 0);
    actor = { ...actor, canPublishTasks: false };
    assert.equal((await controller[handler](request(true), id)).status, 403);
    assert.equal(writes.length, 0);
    actor = { ...actor, canPublishTasks: true };
    assert.equal((await controller[handler](request(true), id)).status, 200);
    assert.equal((await controller[handler](request(false), id)).status, 200);
    assert.deepEqual(writes.map(row => row.patch.isPinned), [true, false]);
  });
}

for (const [kind, method, ownerColumn] of [["tasks", "patchTask", "publisher_id"], ["announcements", "patchAnnouncement", "author_id"]]) {
  test(kind + " pinning is limited to the author or team admin, preserving content and dates", async () => {
    const row = { id: "publication", team_id: "team", [ownerColumn]: "owner", title: "Original", created_at: "2026-09-01", is_pinned: false };
    const writes = [];
    const service = load("backend/services/" + kind + ".service.ts", {
      [dbKey]: { getSupabaseAdmin: () => ({ from: () => ({
        select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row }; },
        update(patch) { writes.push(patch); Object.assign(row, patch); return this; }, async single() { return { data: row }; },
      }) }) },
    });
    for (const actor of [
      { id: "sibling", role: "member", teamId: "team", canPublishTasks: true },
      { id: "owner", role: "member", teamId: "team", canPublishTasks: false },
      { id: "foreign", role: "admin", teamId: "other" },
      { id: "teamless", role: "admin" },
    ]) assert.equal((await service[method](row.id, { isPinned: true }, actor)).forbidden, true);
    assert.equal(writes.length, 0);
    await service[method](row.id, { isPinned: true }, { id: "owner", role: "member", teamId: "team", canPublishTasks: true });
    await service[method](row.id, { isPinned: false }, { id: "mentor", role: "admin", teamId: "team" });
    assert.deepEqual(writes, [{ is_pinned: true }, { is_pinned: false }]);
    assert.equal(row.created_at, "2026-09-01"); assert.equal(row.title, "Original");
  });
}
