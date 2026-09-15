const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
function loadTs(relative, overrides = {}) {
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}
const { buildNetworkTree, visibleNetworkEntries, networkDescendantIds } = loadTs("frontend/shared/lib/network-tree.ts");
const { isMenuSwipe } = loadTs("frontend/shared/lib/menu-swipe.ts");
const user = (id, parentUserId, name = id) => ({ id, parentUserId, name, role: "member", createdAt: "2026-09-14" });

test("network keeps each entire branch together instead of sorting all people by depth", () => {
  const input = [user("b1", "b"), user("a11", "a1"), user("b"), user("a1", "a"), user("a")];
  const before = JSON.stringify(input);
  const entries = buildNetworkTree(input);
  assert.deepEqual(entries.map((entry) => entry.user.id), ["a", "a1", "a11", "b", "b1"]);
  assert.deepEqual(entries.map((entry) => entry.depth), [0, 1, 2, 0, 1]);
  assert.equal(entries[0].childCount, 1);
  assert.equal(entries[0].descendantCount, 2);
  assert.equal(JSON.stringify(input), before, "does not mutate API data");
});

test("network supports ten thousand levels without recursive stack overflow", () => {
  const entries = buildNetworkTree(Array.from({ length: 10000 }, (_, i) => user(String(i), i ? String(i - 1) : undefined)));
  assert.equal(entries.length, 10000);
  assert.equal(entries[9999].depth, 9999);
  assert.equal(entries[0].descendantCount, 9999);
  assert.equal(visibleNetworkEntries(entries, new Set(["0"])).length, 1);
});

test("collapse hides descendants only and retains collapse state inside nested branches", () => {
  const entries = buildNetworkTree([user("a"), user("a1", "a"), user("a11", "a1"), user("b"), user("b1", "b")]);
  assert.deepEqual(visibleNetworkEntries(entries, new Set(["a", "a1"])).map((entry) => entry.user.id), ["a", "b", "b1"]);
  assert.deepEqual(visibleNetworkEntries(entries, new Set(["a1"])).map((entry) => entry.user.id), ["a", "a1", "b", "b1"]);
  assert.deepEqual([...networkDescendantIds(entries, "a")], ["a", "a1", "a11"]);
  assert.deepEqual([...networkDescendantIds(entries, "b1")], ["b1"]);
});

test("missing parents, duplicate records, self-links and legacy cycles never hang or drop people", () => {
  const entries = buildNetworkTree([user("a", "b"), user("b", "a"), user("c", "missing"), user("d", "d"), user("a", "b")]);
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map((entry) => entry.user.id)).size, 4);
  assert.ok(entries.every((entry) => entry.descendantCount < 4));
});

test("menu swipe accepts a quick horizontal edge gesture but not scroll, reverse or long gestures", () => {
  const start = { x: 20, y: 200, time: 10 };
  assert.equal(isMenuSwipe(start, { x: 130, y: 210, time: 300 }), true);
  for (const end of [
    { x: 130, y: 300, time: 300 },
    { x: 0, y: 200, time: 300 },
    { x: 45, y: 200, time: 300 },
    { x: 130, y: 200, time: 1500 },
  ]) assert.equal(isMenuSwipe(start, end), false);
  assert.equal(isMenuSwipe({ ...start, x: 80 }, { x: 200, y: 200, time: 300 }), false);
});

// Targeted CSS cascade checks, not a browser/layout emulator. They guard the
// exact inherited-gap, breakpoint and flex-order bugs found in this review.
const stylesheet = postcss.parse(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"));
function matches(selector, chain) {
  const parts = selector.trim().split(/\s+/);
  if (parts.some((part) => part !== ">" && !/^(?:[a-z][\w-]*)?(?:\.[\w-]+)*$/.test(part))) return false;
  function simple(part, element) {
    const tag = part.match(/^[a-z][\w-]*/)?.[0];
    return (!tag || tag === element.tag) && [...part.matchAll(/\.([\w-]+)/g)].every((match) => element.classes.includes(match[1]));
  }
  let index = chain.length - 1;
  if (!simple(parts.pop(), chain[index--])) return false;
  while (parts.length) {
    const direct = parts[parts.length - 1] === ">";
    if (direct) parts.pop();
    const part = parts.pop();
    if (direct) {
      if (index < 0 || !simple(part, chain[index])) return false;
      index--;
      continue;
    }
    while (index >= 0 && !simple(part, chain[index])) index--;
    if (index < 0) return false;
    index--;
  }
  return true;
}
const el = (classes, tag = "div") => ({ tag, classes: classes.split(" ") });
function style(chain, width) {
  const result = {};
  const scores = {};
  stylesheet.walkRules((rule) => {
    for (let parent = rule.parent; parent && parent !== stylesheet; parent = parent.parent) {
      if (parent.type !== "atrule" || parent.name !== "media") continue;
      const max = parent.params.match(/max-width:\s*(\d+)px/);
      const min = parent.params.match(/min-width:\s*(\d+)px/);
      if ((!max && !min) || (max && width > Number(max[1])) || (min && width < Number(min[1]))) return;
    }
    for (const selector of rule.selectors) {
      if (!matches(selector, chain)) continue;
      const specificity = (selector.match(/\./g)?.length || 0) * 10 + (selector.match(/(?:^|\s)[a-z]/g)?.length || 0);
      rule.walkDecls((declaration) => {
        const score = specificity + (declaration.important ? 10000 : 0);
        if (scores[declaration.prop] === undefined || score >= scores[declaration.prop]) {
          result[declaration.prop] = declaration.value;
          scores[declaration.prop] = score;
        }
      });
    }
  });
  return result;
}

for (const width of [320, 375, 390, 430, 560, 760, 761, 768, 820, 850, 851, 1024, 1440]) {
  test(`navigation and headings keep their contracts at ${width}px`, () => {
    const mentor = [el("admin-shell")];
    assert.equal(style([...mentor, el("admin-sidebar")], width).display === "none", width <= 850);
    assert.equal(style([...mentor, el("admin-mobile-menu-button", "button")], width).display === "none", width > 850);
    assert.equal(style([...mentor, el("admin-heading")], width)["align-items"], "flex-start");
    const member = [el("member-shell member-tab-tasks")];
    const nav = style([...member, el("bottom-nav", "nav")], width);
    assert.equal(nav.display, width <= 760 ? "grid" : "none");
    if (width <= 760) {
      assert.equal(nav.gap, "0");
      assert.equal(nav["grid-template-columns"], "repeat(5,minmax(0,1fr))");
      assert.equal(style([...member, el("bottom-nav", "nav"), el("", "button")], width)["min-width"], "0");
      assert.ok(!style([...member, el("bottom-nav", "nav"), el("", "button")], width).padding.includes("safe-area"));
    }
    assert.equal(style([...member, el("member-section-announcements"), el("section-heading")], width).display, "flex");
    assert.equal(style([...member, el("member-section-tasks"), el("section-heading")], width).display, "grid");
  });
}

test("program builder never reorders its fields/actions using legacy flex order", () => {
  stylesheet.walkRules((rule) => {
    if (!rule.selector.includes("program-builder")) return;
    rule.walkDecls("order", () => assert.fail(`Unexpected program order override: ${rule.selector}`));
  });
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
test("empty program presents add-step before a disabled next button; no immediate publish", () => {
  const { ProgramsPanel } = loadTs("frontend/features/admin/ProgramsPanel.tsx", {
    "@/frontend/shared/api/admin-client": {},
    "@/frontend/shared/ConfirmModal": { ConfirmModal: () => null },
  });
  const markup = renderToStaticMarkup(React.createElement(ProgramsPanel, {
    programs: [], tasks: [], actorId: "mentor", canManageAll: true, onChange() {}, onError() {},
  }));
  const form = markup.slice(markup.indexOf("<form"), markup.indexOf("</form>"));
  assert.ok(form.indexOf("Название программы") < form.indexOf("Добавить первый шаг"));
  assert.ok(form.indexOf("Добавить первый шаг") < form.indexOf("Далее: проверить программу"));
  assert.match(form, /<button[^>]*type="submit"[^>]*disabled=""/);
  assert.ok(!form.includes("Подтвердить и опубликовать"));
});

test("network search finds a deep participant and settings stay lazy until expanded", () => {
  const css = new Proxy({}, { get: (_, name) => String(name) });
  const { NetworkTree } = loadTs("frontend/shared/NetworkTree.tsx", {
    "./lib/network-tree": { buildNetworkTree, visibleNetworkEntries },
    "./NetworkTree.module.css": { default: css },
  });
  let controlRenders = 0;
  const markup = renderToStaticMarkup(React.createElement(NetworkTree, {
    users: [user("a", undefined, "Руководитель"), user("b", "a", "Наставник"), user("c", "b", "Участник <script>")],
    currentUserId: "a", query: "участник",
    renderControls() { controlRenders++; return React.createElement("select"); },
  }));
  assert.match(markup, /Участник &lt;script&gt;/);
  assert.match(markup, /В ветке: Наставник/);
  assert.ok(!markup.includes("<script>"));
  assert.equal(controlRenders, 0, "closed settings must not create an N×N dropdown DOM");
});

test("star award list continues to exclude the mentor's own account", () => {
  const { StarsPanel } = loadTs("frontend/features/admin/StarsPanel.tsx", {
    "@/frontend/shared/api/admin-client": {},
    "@/frontend/shared/lib/format": { formatDateTime: (value) => value },
  });
  const markup = renderToStaticMarkup(React.createElement(StarsPanel, {
    actorId: "self", users: [user("self", undefined, "Только я")], awards: [], onChange() {}, onError() {},
  }));
  assert.match(markup, /Нет участников, которых вы можете наградить/);
  assert.ok(!markup.includes("+ Выдать"));
});

const { validateAuthForm, registrationServerField } = loadTs("frontend/shared/lib/auth-validation.ts");
const validRegistration = { firstName: "Мерген", lastName: "Тлеген", email: "user@example.com", password: "123456", passwordConfirmation: "123456" };
test("registration returns every field error, while login only validates its two fields", () => {
  const empty = Object.fromEntries(Object.keys(validRegistration).map((key) => [key, ""]));
  assert.deepEqual(Object.keys(validateAuthForm("register", empty)), ["firstName", "lastName", "email", "password", "passwordConfirmation"]);
  assert.deepEqual(Object.keys(validateAuthForm("login", empty)), ["email", "password"]);
  assert.deepEqual(validateAuthForm("register", validRegistration), {});
  assert.deepEqual(Object.keys(validateAuthForm("register", { ...validRegistration, email: "test", passwordConfirmation: "different" })), ["email", "passwordConfirmation"]);
});

test("frontend preserves current password rules and server name/email boundaries", () => {
  for (const password of ["123456", "      ", "пароль", "a".repeat(300)]) {
    assert.deepEqual(validateAuthForm("register", { ...validRegistration, password, passwordConfirmation: password }), {});
  }
  assert.ok(validateAuthForm("login", { ...validRegistration, password: "12345" }).password);
  assert.deepEqual(validateAuthForm("register", { ...validRegistration, firstName: " аa ", lastName: "б".repeat(80), email: " user@example.com " }), {});
  assert.ok(validateAuthForm("register", { ...validRegistration, firstName: "а".repeat(61) }).firstName);
  assert.ok(validateAuthForm("register", { ...validRegistration, lastName: "б".repeat(81) }).lastName);
  assert.ok(validateAuthForm("register", { ...validRegistration, email: "a".repeat(249) + "@ex.co" }).email);
});

test("only explicit registration errors are assigned to individual fields", () => {
  assert.equal(registrationServerField("Пользователь с таким email уже зарегистрирован."), "email");
  assert.equal(registrationServerField("Пароли не совпадают."), "passwordConfirmation");
  assert.equal(registrationServerField("Неверный email или пароль."), undefined);
  assert.equal(registrationServerField("Слишком много попыток."), undefined);
});

const moduleCss = { default: new Proxy({}, { get: (_, name) => String(name) }) };
const { AuthScreen } = loadTs("frontend/features/auth/AuthScreen.tsx", {
  "@/frontend/shared/api/client": { clearDevSession() {} },
  "@/frontend/shared/lib/auth-validation": { validateAuthForm, registrationServerField },
  "./AuthScreen.module.css": moduleCss,
});
test("auth uses custom validation, labelled fields and accessible password visibility controls", () => {
  const markup = renderToStaticMarkup(React.createElement(AuthScreen, { initialMode: "register", onAuthenticated() {} }));
  assert.match(markup, /<form[^>]*noValidate=""/i);
  for (const name of Object.keys(validRegistration)) {
    assert.ok(markup.includes('for="auth-' + name + '"'));
    assert.ok(markup.includes('name="' + name + '"'));
  }
  assert.equal((markup.match(/aria-label="Показать пароль"/g) || []).length, 2);
  assert.equal((markup.match(/aria-invalid="false"/g) || []).length, 5);
  assert.ok(!markup.includes('role="alert"'), "blank untouched form should not begin covered in errors");
});

function swipeHarness() {
  const { bindMenuSwipe } = loadTs("frontend/shared/lib/menu-swipe.ts");
  const handlers = new Map(), removed = [];
  let opened = 0, enabled = true;
  const cleanup = bindMenuSwipe({
    addEventListener(name, handler, options) { handlers.set(name, { handler, options }); },
    removeEventListener(name, handler, capture) { removed.push({ name, handler, capture }); },
  }, () => opened++, () => enabled);
  function fire(name, overrides = {}) {
    const event = { touches: [{ clientX: 12, clientY: 200 }], changedTouches: [], timeStamp: 100,
      cancelable: true, target: { closest: () => null }, prevented: false,
      preventDefault() { this.prevented = true; }, ...overrides };
    handlers.get(name).handler(event);
    return event;
  }
  return { handlers, removed, cleanup, fire, opened: () => opened, disable: () => { enabled = false; } };
}

test("edge gesture prevents Safari default at touchstart, before any move/end", () => {
  const h = swipeHarness();
  for (const name of ["touchstart", "touchmove", "touchend"]) assert.deepEqual(h.handlers.get(name).options, { passive: false, capture: true });
  assert.equal(h.fire("touchstart").prevented, true);
  assert.equal(h.opened(), 0);
  assert.equal(h.fire("touchmove", { touches: [{ clientX: 100, clientY: 210 }], timeStamp: 200 }).prevented, true);
  h.fire("touchend", { touches: [], changedTouches: [{ clientX: 120, clientY: 210 }], timeStamp: 300 });
  assert.equal(h.opened(), 1);
  h.cleanup();
  assert.equal(h.removed.length, 4);
  for (const item of h.removed) {
    assert.equal(item.handler, h.handlers.get(item.name).handler);
    assert.equal(item.capture, true);
  }
});

test("swipe leaves normal content, form controls, dialogs and multi-touch alone", () => {
  const h = swipeHarness();
  for (const overrides of [
    { touches: [{ clientX: 60, clientY: 200 }] },
    { target: { closest: () => ({}) } },
    { touches: [{ clientX: 10, clientY: 200 }, { clientX: 20, clientY: 200 }] },
    { cancelable: false },
  ]) assert.equal(h.fire("touchstart", overrides).prevented, false);
  h.disable();
  assert.equal(h.fire("touchstart").prevented, false);
  assert.equal(h.opened(), 0);
});

test("cancelled, vertical and repeated end events cannot accidentally open the drawer", () => {
  const h = swipeHarness();
  const end = { touches: [], changedTouches: [{ clientX: 120, clientY: 210 }], timeStamp: 300 };
  h.fire("touchstart"); h.fire("touchcancel"); h.fire("touchend", end);
  h.fire("touchstart"); h.fire("touchend", { ...end, changedTouches: [{ clientX: 120, clientY: 350 }] });
  assert.equal(h.opened(), 0);
  h.fire("touchstart"); h.fire("touchend", end); h.fire("touchend", end);
  assert.equal(h.opened(), 1);
});

const formats = loadTs("frontend/shared/lib/format.ts");
const { ModalSheet } = loadTs("frontend/shared/ModalSheet.tsx", { "./ModalSheet.module.css": moduleCss });
const { TaskCard } = loadTs("frontend/features/member/TaskCard.tsx", {
  "@/frontend/shared/lib/format": formats,
  "@/frontend/shared/ModalSheet": { ModalSheet },
  "./TaskCard.module.css": moduleCss,
});
const fixtureTask = { id: "task", title: "Задание <script>", description: "Первая строка\nВторая строка", isActive: true, maxPoints: 10, createdAt: "2026-01-01", updatedAt: "2026-01-01", publicationType: "evergreen" };
const fixtureSubmission = { id: "submission", userId: "user", taskId: "task", status: "pending", points: 0, comment: "", submittedAt: "2026-01-01", mediaType: "text", answerText: "Ответ <script>alert(1)</script>\nНа следующей строке" };
const taskMarkup = (task, submission) => renderToStaticMarkup(React.createElement(TaskCard, { task, submission, onSubmit: async () => {} }));
test("task preview is escaped and opens details without embedding an extra modal for every task", () => {
  const markup = taskMarkup(fixtureTask);
  assert.match(markup, /Задание &lt;script&gt;/);
  assert.match(markup, /Подробнее/);
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.ok(!markup.includes('role="dialog"'));
  assert.match(markup, /Отправить ответ/);
});
test("task actions retain pending, accepted, late-program and closed-deadline states", () => {
  assert.ok(!taskMarkup(fixtureTask, fixtureSubmission).includes("Отправить ответ"));
  assert.match(taskMarkup(fixtureTask, { ...fixtureSubmission, status: "accepted", points: 7 }), /\+7 баллов/);
  assert.match(taskMarkup(fixtureTask, { ...fixtureSubmission, status: "revision" }), /Отправить повторно/);
  const expired = { ...fixtureTask, deadlineAt: "2000-01-01" };
  assert.match(taskMarkup(expired), /Приём завершён/);
  assert.match(taskMarkup({ ...expired, publicationType: "sequential" }), /Отправить с опозданием/);
  assert.match(taskMarkup({ ...fixtureTask, isActive: false }), /Приём завершён/);
});

const { SubmissionCard, SubmissionAnswer } = loadTs("frontend/features/admin/SubmissionCard.tsx", {
  "@/frontend/shared/lib/format": formats,
  "@/frontend/shared/ModalSheet": { ModalSheet },
  "./SubmissionCard.module.css": moduleCss,
});
test("review renders full escaped answers and review actions, not a misleading Telegram home link", () => {
  const markup = renderToStaticMarkup(React.createElement(SubmissionCard, { submission: fixtureSubmission, name: "Участник", taskTitle: "Задание", onReview() {} }));
  assert.match(markup, /Ответ &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /На следующей строке/);
  assert.match(markup, /Принять/);
  assert.match(markup, /На доработку/);
  assert.ok(!markup.includes("https://t.me"));
});
test("media remains on demand rather than fetching every submission's private attachment on list load", () => {
  for (const mediaType of ["photo", "video", "document"]) {
    const markup = renderToStaticMarkup(React.createElement(SubmissionAnswer, { submission: { ...fixtureSubmission, mediaType } }));
    assert.match(markup, /Посмотреть/);
    assert.ok(!markup.includes("/api/submissions/"));
    assert.ok(!markup.includes("<video") && !markup.includes("<img"));
  }
});
test("sheet always exposes a labelled close button and modal semantics", () => {
  const markup = renderToStaticMarkup(React.createElement(ModalSheet, { title: "Мой профиль", onClose() {} }, "Содержимое"));
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby=/);
  assert.match(markup, /aria-label="Закрыть окно"/);
  assert.ok(markup.indexOf("Закрыть") < markup.indexOf("Содержимое"));
});
test("mentor list actions stay compact and keep 44px touch targets", () => {
  for (const width of [320, 390, 760, 1440]) {
    for (const parent of ["row-actions", "announcement-admin-actions"]) {
      const chain = [el("admin-content"), el("task-admin-row"), el(parent), el("button button-danger", "button")];
      const rules = style(chain, width);
      assert.equal(rules.flex, "0 1 auto");
      assert.equal(rules["min-height"], "44px");
      assert.equal(rules["font-size"], "12px");
    }
  }
});

test("login offers registration below the password; confirmation uses the requested wording", () => {
  const login = renderToStaticMarkup(React.createElement(AuthScreen, { onAuthenticated() {} }));
  assert.match(login, /С возвращением!/);
  assert.match(login, /Нет аккаунта\?/);
  assert.match(login, /<button[^>]*type="button"[^>]*>Зарегистрируйтесь<\/button>/);
  assert.ok(login.indexOf('name="password"') < login.indexOf("Зарегистрируйтесь"));
  assert.ok(login.indexOf("Зарегистрируйтесь") < login.indexOf('type="submit"'));
  const registration = renderToStaticMarkup(React.createElement(AuthScreen, { initialMode: "register", onAuthenticated() {} }));
  assert.match(registration, /placeholder="Повторите пароль"/);
  assert.ok(!registration.includes("Пароль ещё раз"));
});

const { TeamSelectionView } = loadTs("frontend/features/teams/TeamSelectionScreen.tsx", {
  "@/frontend/shared/api/team-client": {},
  "@/frontend/shared/api/client": {},
  "@/frontend/shared/hooks/use-auto-refresh": {},
  "./TeamSelectionScreen.module.css": moduleCss,
});
const teamProps = {
  teams: [{ id: "team", name: "Тестовая команда", description: "Развиваемся вместе", isActive: true, createdAt: "2026-01-01" }],
  request: null, selectedTeam: "", loading: false, pending: false, checking: false, error: "",
  onSelect() {}, onSend() {}, onRefresh() {}, onLogout() {},
};
const renderTeam = (overrides = {}) => renderToStaticMarkup(React.createElement(TeamSelectionView, { ...teamProps, ...overrides }));
test("team selection and pending states both render the dark wordmark on the white card", () => {
  for (const overrides of [{}, { loading: true }, { request: { teamId: "team", status: "pending" } }]) {
    const markup = renderTeam(overrides);
    assert.match(markup, /src="\/brand\/logo.svg"/);
    assert.match(markup, /alt="Прокачка"/);
    assert.ok(!markup.includes("logo-light.svg"));
    assert.ok(!markup.includes("login-brand"), "avoid inheriting the auth logo's oversized bottom margin");
  }
});
test("pending screen describes human approval, exposes refresh, and cannot submit a second request", () => {
  const markup = renderTeam({ request: { teamId: "team", status: "pending" } });
  assert.match(markup, /Наставник рассмотрит вашу заявку/);
  assert.match(markup, /Тестовая команда/);
  assert.match(markup, /Проверить статус заявки/);
  assert.match(markup, /Выйти из аккаунта/);
  assert.ok(!markup.includes("проверяется автоматически"));
  assert.ok(!markup.includes("Отправить заявку"));
});
test("team selection is keyboard-accessible and submission requires a current team choice", () => {
  const initial = renderTeam();
  assert.match(initial, /type="radio"[^>]*name="team"/);
  assert.match(initial, /<button[^>]*disabled=""[^>]*>Отправить заявку/);
  const selected = renderTeam({ selectedTeam: "team" });
  assert.match(selected, /type="radio"[^>]*checked=""/);
  assert.match(selected, /<button(?![^>]*disabled)[^>]*>Отправить заявку/);
  assert.match(renderTeam({ selectedTeam: "removed" }), /<button[^>]*disabled=""[^>]*>Отправить заявку/);
  assert.match(renderTeam({ selectedTeam: "team", pending: true }), /<fieldset[^>]*disabled=""/);
});
test("empty, rejected and refresh-error states remain readable and recoverable", () => {
  assert.match(renderTeam({ teams: [] }), /Обновить список/);
  assert.match(renderTeam({ request: { status: "rejected" } }), /Вы можете выбрать другую команду/);
  const pendingError = renderTeam({ request: { teamId: "team", status: "pending" }, error: "Нет соединения" });
  assert.match(pendingError, /role="alert">Нет соединения/);
  assert.match(pendingError, /Ждём решения наставника/);
  assert.match(renderTeam({ request: { teamId: "team", status: "pending" }, checking: true }), /<button[^>]*disabled=""[^>]*>Проверяем статус/);
});

test("desktop greeting and content share a width; sticky sidebar keeps a viewport-relative height", () => {
  for (const width of [768, 1024, 1280, 1440, 1920]) {
    const member = [el("member-shell member-tab-home")];
    assert.equal(style([...member, el("welcome-section page-width")], width).width, style([...member, el("content-grid page-width")], width).width);
    assert.equal(style([...member, el("main-column")], width)["max-width"], "none");
    assert.equal(style([...member, el("member-sidebar")], width).position, "sticky");
    assert.equal(style([...member, el("member-sidebar")], width).height, "calc(100dvh - 78px)");
    assert.equal(style([el("", "html"), el("", "body")], width)["overflow-x"], "clip");
  }
});
test("mobile star award stays beside the participant, not a full-width second row", () => {
  for (const width of [320, 375, 390, 430, 560]) {
    const chain = [el("admin-shell"), el("stars-member-row"), el("button star-award-button", "button")];
    const rules = style(chain, width);
    assert.equal(rules.width, "auto");
    assert.equal(rules["grid-column"], "3");
    assert.equal(rules["grid-row"], "1");
    assert.equal(rules["justify-self"], "end");
    assert.equal(rules["min-height"], "44px");
    assert.equal(rules["font-size"], "12px");
  }
});
