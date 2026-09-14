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
  if (parts.some((part) => !/^(?:[a-z][\w-]*)?(?:\.[\w-]+)*$/.test(part))) return false;
  function simple(part, element) {
    const tag = part.match(/^[a-z][\w-]*/)?.[0];
    return (!tag || tag === element.tag) && [...part.matchAll(/\.([\w-]+)/g)].every((match) => element.classes.includes(match[1]));
  }
  let index = chain.length - 1;
  if (!simple(parts.pop(), chain[index--])) return false;
  while (parts.length) {
    const part = parts.pop();
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
