const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const loadTs = require("./helpers/load-ts.cjs");
const hookHarness = require("./helpers/hook-harness.cjs");
const { renderToStaticMarkup } = require("react-dom/server");

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
  assert.equal(READY_PROGRAMS.length, 2);
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

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test("member Tasks view contains games and ordinary tasks, while Programs only contains sequential steps", async () => {
  const harness = hookHarness(), previousWindow = global.window;
  global.window = { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} };
  const tasks = [
    { id: "game", title: "Мечта с планом", isActive: true, publicationType: "evergreen", interactiveKind: "dream-plan", createdAt: "2026-09-25" },
    { id: "ordinary", title: "Задание", isActive: true, publicationType: "evergreen", createdAt: "2026-09-25" },
    { id: "step", title: "Шаг", isActive: true, publicationType: "sequential", createdAt: "2026-09-25" },
  ];
  const TaskCard = () => null;
  const { MemberApp } = loadTs("frontend/features/member/MemberApp.tsx", {
    react: harness.react,
    "./TaskCard": { TaskCard },
    "@/frontend/shared/hooks/use-live-updates": { useLiveUpdates() {} },
    "./use-member-data": { useMemberData: () => ({ store: { tasks, submissions: [], announcements: [], starAwards: [] }, ranking: [], starRanking: [], network: [], refreshData() {}, dataLoading: false }) },
    "@/frontend/shared/api/client": { refreshAuthSession: async () => ({ id: "member", role: "member", name: "Участник", teamId: "team" }), mapAuthUserToUser: (user) => user },
  });
  try {
    harness.mount(MemberApp, {});
    let tree = await harness.settle();
    assert.deepEqual(nodes(tree, (node) => node.type === TaskCard).map((node) => node.props.task.id), ["game", "ordinary"]);
    const switcher = nodes(tree, (node) => node.props?.className === "task-switch")[0];
    nodes(switcher, (node) => node.type === "button" && node.props.children === "Программы")[0].props.onClick();
    tree = harness.render();
    assert.deepEqual(nodes(tree, (node) => node.type === TaskCard).map((node) => node.props.task.id), ["step"]);
  } finally { harness.unmount(); global.window = previousWindow; }
});

test("removing a ready publication removes its task from member feed without changing underlying tasks", async () => {
  const tasks = [
    { id: "game", team_id: "team", is_active: true, publication_type: "evergreen", program_id: "ready", audience_root_id: null },
    { id: "ordinary", team_id: "team", is_active: true, publication_type: "evergreen", audience_root_id: null },
    { id: "sibling-game", team_id: "team", is_active: true, publication_type: "evergreen", program_id: "sibling", audience_root_id: "sibling" },
  ];
  const programs = [{ id: "ready", team_id: "team", is_active: true, audience_root_id: null, created_at: "2026-09-25" }, { id: "sibling", team_id: "team", is_active: true, audience_root_id: "sibling", created_at: "2026-09-25" }];
  const tables = { tasks, task_programs: programs, member_program_progress: [] };
  const client = { from(table) {
    return { table, filters: [], select() { return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, order() { return this; } };
  } };
  const { getMemberTaskFeed } = loadTs("backend/services/member-progress.service.ts", {
    "@/backend/infrastructure/supabase/admin-client": { getSupabaseAdmin: () => client },
    "@/backend/infrastructure/supabase/read-pages": { readPages: async (query) => ({ data: tables[query.table].filter((row) => query.filters.every(([key, value]) => row[key] === value)), error: null }) },
    "@/backend/services/network.service": { findTeamNetwork: async () => ({ data: [] }), isAudienceVisible: (_network, _user, audience) => audience == null },
  });
  assert.deepEqual((await getMemberTaskFeed("member", "team")).data.map((row) => row.id), ["game", "ordinary"]);
  const originalTasks = JSON.stringify(tasks);
  programs[0].is_active = false;
  assert.deepEqual((await getMemberTaskFeed("member", "team")).data.map((row) => row.id), ["ordinary"]);
  assert.equal(JSON.stringify(tasks), originalTasks, "unpublishing does not delete or alter the underlying tasks");
  programs[0].is_active = true;
  programs[0].is_pinned = true;
  assert.deepEqual((await getMemberTaskFeed("member", "team")).data.map((row) => row.id), ["game", "ordinary"]);
  const pinnedFeed = (await getMemberTaskFeed("member", "team")).data;
  assert.equal(pinnedFeed.find((row) => row.id === "game").is_pinned, true);
  assert.equal(pinnedFeed.find((row) => row.id === "ordinary").is_pinned, false);
});

test("catalog add/remove/re-add reuses the publication and preserves task identity without deletion", async () => {
  const harness = hookHarness(), calls = [];
  const { READY_PROGRAMS } = load("shared/domain/ready-programs.ts");
  let publication, props, tree;
  const task = { id: "game", programId: "ready", interactiveKind: "dream-plan", isActive: true };
  const api = {
    loadReadyPrograms: async () => READY_PROGRAMS.map(({ tasks: _tasks, ...item }) => ({ ...item, published: Boolean(publication), publishedProgramId: publication?.id, publishedActive: publication?.isActive, canManage: Boolean(publication) })),
    publishReadyProgram: async () => { calls.push("publish"); publication = { id: "ready", templateKey: "dream-plan", publisherId: "mentor", isActive: true }; return { program: publication, tasks: [task] }; },
    updateAdminProgram: async (id, patch) => { calls.push([id, patch]); publication = { ...publication, ...patch }; return publication; },
  };
  const { ReadyProgramsPanel } = loadTs("frontend/features/admin/ReadyProgramsPanel.tsx", { react: harness.react, "@/frontend/shared/api/admin-client": api });
  props = { programs: [], tasks: [], actorId: "mentor", canManageAll: false, onError() {}, onChange(programs, tasks) { props = { ...props, programs, tasks }; harness.render(props); } };
  harness.mount(ReadyProgramsPanel, props);
  tree = await harness.settle();
  const press = async (label) => {
    const button = nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.startsWith(label))[0];
    assert.ok(button); assert.equal(button.props.disabled, false);
    button.props.onClick(); tree = await harness.settle();
  };
  try {
    await press("Добавить в задания");
    await press("Убрать из заданий");
    assert.equal(props.programs[0].isActive, false);
    assert.equal(props.tasks[0], task);
    await press("Добавить в задания");
    assert.deepEqual(calls, ["publish", ["ready", { isActive: false }], ["ready", { isActive: true }]]);
    assert.equal(props.programs.length, 1); assert.equal(props.tasks.length, 1);
    assert.doesNotMatch(renderToStaticMarkup(tree), />(?:Изменить|Скрыть|Удалить)</);
  } finally { harness.unmount(); }
});

test("catalog cannot manage another mentor's publication and keeps errors next to the action", async () => {
  const { READY_PROGRAMS } = load("shared/domain/ready-programs.ts");
  const harness = hookHarness();
  let reject = false;
  const status = READY_PROGRAMS.map(({ tasks: _tasks, ...item }) => ({ ...item, published: true, publishedProgramId: "ready", publishedActive: true, canManage: false }));
  const { ReadyProgramsPanel } = loadTs("frontend/features/admin/ReadyProgramsPanel.tsx", {
    react: harness.react,
    "@/frontend/shared/api/admin-client": { loadReadyPrograms: async () => status, updateAdminProgram: async () => { reject = true; throw Error("Нет соединения"); } },
  });
  const props = { programs: [], tasks: [], actorId: "mentor", canManageAll: false, onError() {}, onChange() { assert.fail("failed publication must not update the store"); } };
  harness.mount(ReadyProgramsPanel, props);
  let tree = await harness.settle();
  assert.equal(nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.includes("из заданий")).length, 0);
  tree = harness.render({ ...props, programs: [{ id: "ready", templateKey: "dream-plan", publisherId: "mentor", isActive: true }] });
  nodes(tree, (node) => node.type === "button" && node.props["aria-label"]?.startsWith("Убрать"))[0].props.onClick();
  tree = await harness.settle();
  assert.equal(reject, true);
  assert.equal(nodes(tree, (node) => node.props?.role === "alert")[0].props.children, "Нет соединения");
  harness.unmount();
});

test("ordinary task management excludes ready games so generic edit/hide/delete cannot affect them", () => {
  const harness = hookHarness();
  const { TasksView } = loadTs("frontend/features/admin/AdminViews.tsx", { react: harness.react });
  const tree = harness.mount(TasksView, { actorId: "mentor", canManageAll: true, onToggle() {}, onEdit() {}, onRemove() {}, store: {
    programs: [{ id: "ready", templateKey: "dream-plan" }], submissions: [],
    tasks: [
      { id: "game", title: "Мечта с планом", programId: "ready", interactiveKind: "dream-plan", isActive: true, publicationType: "evergreen", createdAt: "2026-09-25" },
      { id: "ordinary", title: "Обычное задание", maxPoints: 5, isActive: true, publicationType: "evergreen", createdAt: "2026-09-25" },
    ],
  } });
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /Мечта с планом/);
  assert.match(html, /Обычное задание/);
  assert.match(html, />Изменить</);
  harness.unmount();
});

test("the converted game does not execute arbitrary HTML", () => {
  const source = fs.readFileSync(path.join(root, "frontend/features/member/DreamPlanGame.tsx"), "utf8");
  const taskCard = fs.readFileSync(path.join(root, "frontend/features/member/TaskCard.tsx"), "utf8");
  const sheetCss = fs.readFileSync(path.join(root, "frontend/shared/ModalSheet.module.css"), "utf8");
  const gameCss = fs.readFileSync(path.join(root, "frontend/features/member/DreamPlanGame.module.css"), "utf8");
  assert.doesNotMatch(source, /innerHTML|dangerouslySetInnerHTML/);
  assert.match(source, /questions/);
  assert.match(source, /QUIZ_TOTAL = 5/);
  assert.match(source, /formatMiles/);
  assert.match(source, /completeReadyProgram/);
  assert.match(source, /restartReadyProgramQuiz/);
  assert.match(source, /answeredIncorrectly/);
  assert.match(source, /onCompleted/);
  assert.match(source, /бонусных баллов/);
  assert.match(taskCard, /onInteractiveComplete/);
  assert.match(taskCard, /variant=\{isInteractive \? "immersive" : "default"\}/);
  assert.match(sheetCss, /\.immersivePanel \{ width:100%; height:100dvh; max-height:100dvh;/);
  assert.match(gameCss, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(gameCss, /\.quizFailure/);
});

test("ready program scoring is server-owned and cannot be edited as a regular submission", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/20260925-ready-programs.sql"), "utf8");
  const retryMigration = fs.readFileSync(path.join(root, "supabase/20260925-ready-program-quiz-retry.sql"), "utf8");
  assert.match(migration, /app_complete_ready_program/);
  assert.match(migration, /submission_source = 'interactive'/);
  assert.match(migration, /app_guard_interactive_submission_update/);
  assert.match(migration, /Ответ неверный/);
  assert.match(migration, /earned_points = next_points/);
  assert.match(migration, /attempt\.earned_points <> 5/);
  assert.match(retryMigration, /app_restart_ready_program_quiz/);
  assert.match(retryMigration, /'failed', true/);
  assert.doesNotMatch(retryMigration, /current_step = 12, earned_points = 0/);
});
