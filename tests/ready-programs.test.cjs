const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relative, overrides = {}) {
  const file = path.resolve(root, relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const original = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts", overrides);
    return original(name);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  return loaded.exports;
}

test("ready program catalog contains a deadline-free interactive dream plan", () => {
  const { READY_PROGRAMS } = load("shared/domain/ready-programs.ts");
  assert.equal(READY_PROGRAMS.length, 1);
  assert.equal(READY_PROGRAMS[0].key, "dream-plan");
  assert.equal(READY_PROGRAMS[0].tasks[0].publicationType, "evergreen");
  assert.equal(READY_PROGRAMS[0].tasks[0].interactiveKind, "dream-plan");
  assert.match(READY_PROGRAMS[0].title, /Мечта с планом/);
});

test("ready program publication sends an evergreen interactive step to the atomic RPC", async () => {
  const calls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    not() { return this; },
    order() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const service = load("backend/services/programs.service.ts", {
    "@/backend/infrastructure/supabase/admin-client": {
      getSupabaseAdmin: () => ({
        from: () => query,
        rpc: async (...args) => { calls.push(args); return { data: { program: { id: "program" }, tasks: [{ id: "task" }] }, error: null }; },
      }),
    },
    "@/backend/services/network.service": {},
    "@/backend/infrastructure/supabase/read-pages": {},
  });

  const result = await service.publishReadyProgram({ teamId: "team", key: "dream-plan", publisherId: "mentor", audienceRootId: null });
  assert.equal(result.data.program.id, "program");
  assert.equal(calls.length, 1);
  const payload = calls[0][1].p_input;
  assert.equal(payload.templateKey, "dream-plan");
  assert.equal(payload.tasks[0].publicationType, "evergreen");
  assert.equal(payload.tasks[0].interactiveKind, "dream-plan");
});

test("interactive ready tasks are shown in the member Programs view", () => {
  const source = fs.readFileSync(path.join(root, "frontend/features/member/MemberApp.tsx"), "utf8");
  assert.match(source, /task\.publicationType === "sequential" \|\| Boolean\(task\.interactiveKind\)/);
  assert.match(source, /task\.publicationType !== "sequential" && !task\.interactiveKind/);
});

test("the converted game does not execute arbitrary HTML", () => {
  const source = fs.readFileSync(path.join(root, "frontend/features/member/DreamPlanGame.tsx"), "utf8");
  assert.doesNotMatch(source, /innerHTML|dangerouslySetInnerHTML/);
  assert.match(source, /quizAnswer/);
  assert.match(source, /formatMiles/);
  assert.match(source, /onReadyChange/);
  assert.match(fs.readFileSync(path.join(root, "frontend/features/member/TaskCard.tsx"), "utf8"), /interactiveReady/);
});
