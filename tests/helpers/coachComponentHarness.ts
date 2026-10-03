/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only hook slots and JSX properties. */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { messages, type AppLocale } from "../../lib/i18n/messages.ts";

type Props = Record<string, any>; // Test-only JSX tree, never application data.
export type Element = { type: string; props: Props };
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const same = (a?: unknown[], b?: unknown[]) => Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));

/** Runs component handlers/effects with fake IO; it is not a browser or a DOM test. */
export function coachComponentHarness(path: string, options: {
  fetch: typeof fetch; searchParams?: string; props?: Props; locale?: AppLocale; database?: unknown; params?: Record<string, string>;
  navigate?: (path: string) => void; notify?: (input: unknown) => Promise<unknown>;
  modules?: Record<string, unknown>; exportName?: string;
  /** Opt in only for presentational children without their own state or effects. */
  inlineComponentNames?: string[];
}) {
  let cursor = 0;
  let locale = options.locale ?? "fr";
  let props = options.props ?? {};
  const hooks: any[] = [];
  let pending: Array<() => void> = [];
  const react = {
    useId() { return `test-id-${cursor++}`; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value: unknown) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useImperativeHandle(ref: { current: unknown } | ((value: unknown) => void) | undefined, create: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (same(hooks[index]?.deps, deps)) return;
      const value = create();
      hooks[index] = { deps };
      if (typeof ref === "function") ref(value);
      else if (ref) ref.current = value;
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { deps, value: factory() };
      return hooks[index].value;
    },
    useCallback(fn: unknown, deps: unknown[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (same(hooks[index]?.deps, deps)) return;
      pending.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    },
  };
  const inlineComponents = new Set<unknown>();
  const jsx = (type: string | ((props: Props) => unknown), props: Props) => typeof type === "function" && (inlineComponents.has(type) || options.inlineComponentNames?.includes(type.name)) ? type(props) : ({ type, props });
  const mocks: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { __esModule: true, default: "a" },
    "next/navigation": { useSearchParams: () => new URLSearchParams(options.searchParams ?? ""), useParams: () => options.params ?? {}, useRouter: () => ({ push: options.navigate ?? (() => {}) }) },
    "@/lib/notifications": { createAppNotification: options.notify ?? (async () => ({})), getEventAttendeeUserIds: async () => [] },
    "@/lib/notificationMessages": { getNotificationMessage: async () => ({ title: "Test notification", body: "Test notification" }) },
    "lucide-react": new Proxy({}, { get: (_, key) => String(key) }),
    "@/components/i18n/AppI18nProvider": { useI18n: () => ({ locale, t: (key: string) => messages[locale][key] ?? key }) },
    "@/components/ui/AccessibleDialog": { __esModule: true, default: "dialog" },
    "@/components/ui/LoadingBlocks": { ListLoadingBlock: "skeleton", CompactLoadingBlock: "skeleton" },
    "@/components/coach/CoachListSkeleton": { __esModule: true, default: "skeleton" },
    "./CoachListSkeleton": { __esModule: true, default: "skeleton" },
    "@/components/coach/CoachMemberPicker": { __esModule: true, default: "member-picker" },
    "@/components/coach/CoachPlayerTransferDialog": { __esModule: true, default: "transfer-dialog" },
    "@/components/manager/ManagerStatisticsTabs": { __esModule: true, default: "tabs" },
    "@/components/ui/ManagementActivityDate": { __esModule: true, default: "activity-date" },
    "@/components/coach/player-detail/CoachPlayerActivityCard": { __esModule: true, default: "activity-card" },
    "@/lib/supabaseClient": { supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: "test-only" } } }), getUser: async () => ({ data: { user: { id: "coach" } } }) },
      ...options.database as object,
    } },
    ...options.modules,
  };
  function load(file: string): any {
    const code = ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const compiledModule = { exports: {} };
    new Function("require", "module", "exports", "fetch", code)((id: string) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.endsWith(".css")) return { default: {} };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? id.slice(2) : resolve(file, "..", id);
        const target = [base, base + ".ts", base + ".tsx"].find((candidate) => existsSync(resolve(root, candidate)));
        if (!target) throw new Error("Missing test module: " + base);
        return load(target);
      }
      return require(id);
    }, compiledModule, compiledModule.exports, options.fetch);
    if (file.endsWith("CoachActivityCard.tsx")) Object.values(compiledModule.exports).forEach((component) => inlineComponents.add(component));
    return compiledModule.exports;
  }
  const Component = load(path)[options.exportName ?? "default"];
  return {
    render(nextProps?: Props) {
      if (nextProps) props = nextProps;
      cursor = 0;
      const tree = Component(props);
      const effects = pending; pending = [];
      effects.forEach((fn) => fn());
      return tree as Element;
    },
    setLocale(next: AppLocale) { locale = next; },
    cleanup() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

export function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}

export function textContent(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(textContent).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return "";
  return textContent((tree as Element).props.children);
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
