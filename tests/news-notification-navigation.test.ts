import assert from "node:assert/strict";
import test from "node:test";
import { newsNotificationHref } from "../lib/newsNotificationNavigation.ts";
import { coachComponentHarness, elements, textContent, flush, deferred } from "./helpers/coachComponentHarness.ts";

for (const role of ["player", "coach", "manager"]) {
  for (const field of ["news_id", "platform_news_id"]) {
    test(`${role} opens the dynamic ${field} even with an obsolete URL or linked activity`, () => {
      const href = newsNotificationHref({ kind: "manager_news", data: {
        [field]: "news-123", url: "/obsolete", linked_camp_id: "camp", child_id: "child", club_id: "club",
      } }, `/${role}`)!;
      const url = new URL(href, "https://activitee.app");
      assert.equal(url.pathname, `/${role}/news`);
      assert.equal(url.searchParams.get("news_id"), "news-123");
      assert.equal(url.searchParams.get("child_id"), role === "player" ? "child" : null);
      assert.equal(url.searchParams.get("club"), role === "manager" ? "club" : null);
      assert.ok(href.startsWith("/"), "Internal navigation stays in the web or Capacitor router");
    });
  }
}

for (const failure of [false, true]) {
  test(`opening the full news card ${failure ? "stays put if saving the read fails" : "saves the read before navigating"}`, async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
    const read = deferred<void>();
    const navigation: string[] = [];
    const reads: number[] = [];
    const channel = { on() { return channel; }, subscribe() { return channel; } };
    const harness = coachComponentHarness("components/notifications/NotificationsCenter.tsx", {
      fetch: async () => Response.json({}), navigate: href => navigation.push(href),
      database: { channel: () => channel, removeChannel() {} },
      props: { homeHref: "/manager", settingsHref: "/manager/notifications/settings", titleFr: "Notifications" },
      modules: { "@/lib/notifications": {
        loadMyNotifications: async () => [{ recipient: { id: 42, is_read: false, created_at: "2026-10-28T10:00:00Z" }, notification: {
          id: "notice", kind: "manager_news", title: "News title", body: "Summary", created_at: "2026-10-28T10:00:00Z", data: { news_id: "target" },
        } }],
        applyPwaBadge() {},
        markNotificationRead: async (id: number) => { reads.push(id); await read.promise; if (failure) throw Error("Save failed"); },
      } },
    });
    try {
      harness.render(); await flush();
      const tree = harness.render();
      const cardLink = elements(tree).find(row => row.type === "a" && row.props["aria-label"] === "News title")!;
      assert.ok(cardLink, "Full card has its own accessible link");
      let prevented = false;
      cardLink.props.onClick({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.deepEqual(reads, [42]);
      assert.deepEqual(navigation, []);
      read.resolve(); await flush();
      assert.deepEqual(navigation, failure ? [] : ["/manager/news?news_id=target"]);
      if (failure) assert.match(textContent(harness.render()), /Save failed/);
    } finally {
      harness.cleanup();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
    }
  });
}

test("other notification kinds and legacy unassociated news retain their routing", () => {
  for (const kind of ["thread_message", "training_evaluated", "event_created"]) {
    assert.equal(newsNotificationHref({ kind, data: { news_id: "unrelated" } }, "/coach"), null);
  }
  assert.equal(newsNotificationHref({ kind: "manager_news", data: {} }, "/player"), null);
});

for (const role of ["player", "coach", "manager"]) {
  for (const available of [true, false]) {
    test(`${role} news detail ${available ? "opens exactly the authorized article" : "handles removed or inaccessible articles"}`, () => {
      const navigations: string[] = [];
      const harness = coachComponentHarness("components/news/NotificationNewsDetail.tsx", {
        exportName: "NotificationNewsDetailContent", searchParams: "news_id=target&child_id=child",
        navigate: href => navigations.push(href), fetch: async () => { throw Error("Must use the authorized feed"); },
        modules: { "next/navigation": {
          useSearchParams: () => new URLSearchParams("news_id=target&child_id=child"),
          useRouter: () => ({ replace: (href: string) => navigations.push(href) }),
        } },
        props: { news: [{ id: available ? "target" : "other", title: "Exact article", body: "<p>Content</p>" }], loading: false, homeHref: `/${role}` },
      });
      try {
        const tree = harness.render();
        assert.match(textContent(tree), available ? /Exact article/ : /supprimée ou n’est plus accessible/);
        if (!available) assert.doesNotMatch(textContent(tree), /Exact article/);
        const close = elements(tree).find(row => row.type === "button")!;
        close.props.onClick();
        assert.deepEqual(navigations, [`/${role}/news?child_id=child`]);
        assert.equal(harness.render({ news: [], loading: true, homeHref: `/${role}` }), null);
        assert.equal(harness.render({ news: [], loading: false, error: "Network error", homeHref: `/${role}` }), null);
      } finally { harness.cleanup(); }
    });
  }
}
