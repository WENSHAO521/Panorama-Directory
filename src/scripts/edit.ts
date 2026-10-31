// Client side of /edit: sign-in screen, then a form for the scholar's own
// entry built from FIELDS below. Saving posts the whole entry to /api/me;
// the Worker decides what may change (worker/entry.ts).

type Value = unknown;
type Obj = Record<string, Value>;
interface Bound {
  el: HTMLElement;
  get(): Value;
}

interface Field {
  key: string;
  label: string;
  hint?: string;
  kind: "string" | "text" | "select" | "checkbox" | "strings" | "objects" | "typed";
  required?: boolean;
  options?: { value: string | number | ""; label: string }[];
  fields?: Field[];
  types?: { type: string; label: string; fields: Field[] }[];
  item?: "string" | "text";
  summary?: (o: Obj) => string;
  open?: boolean;
}

const card: Field[] = [
  { key: "title", label: "Title · 标题", kind: "string", required: true },
  { key: "meta", label: "Details, one per line · 副信息（每行一条）", kind: "strings", item: "string" },
  { key: "text", label: "Paragraphs · 段落", kind: "strings", item: "text" },
  { key: "list", label: "Bullet points · 要点", kind: "strings", item: "string" },
  {
    key: "entries",
    label: "Entries (title + note) · 条目",
    kind: "objects",
    fields: [
      { key: "title", label: "Title · 标题", kind: "string", required: true },
      { key: "meta", label: "Note · 说明", kind: "string", required: true },
    ],
    summary: (o) => String(o.title ?? ""),
  },
];

const FIELDS: Field[] = [
  { key: "name", label: "Name (English) · 姓名（英文）", kind: "string", required: true },
  { key: "nativeName", label: "Name in your own script · 中文名 / 母语姓名", kind: "string" },
  { key: "affiliation", label: "Affiliation · 单位", kind: "string", required: true },
  { key: "headline", label: "Headline under your name · 个人页副标题", kind: "string", hint: "Shown under your name when it differs from the affiliation. Optional. 与单位不同时显示，可留空。" },
  { key: "summary", label: "Short summary · 简介（一两句）", kind: "text", required: true, hint: "One or two sentences, shown on directory cards and in search. 显示在名录卡片和搜索结果里。" },
  { key: "keywords", label: "Research keywords · 研究方向关键词", kind: "strings", item: "string" },
  {
    key: "identifiers",
    label: "Academic IDs · 学术 ID",
    kind: "objects",
    hint: "e.g. ORCID, Web of Science ResearcherID, Scopus Author ID",
    fields: [
      { key: "label", label: "Name · 名称", kind: "string", required: true },
      { key: "value", label: "ID · 编号", kind: "string", required: true },
      { key: "href", label: "Link (https://…) · 链接", kind: "string", required: true },
    ],
    summary: (o) => [o.label, o.value].filter(Boolean).join(": "),
  },
  {
    key: "sections",
    label: "Profile sections (publications, appointments, honours…) · 个人页板块",
    kind: "objects",
    summary: (o) => String(o.title || o.eyebrow || "Section"),
    fields: [
      { key: "eyebrow", label: "Small heading · 小标题", kind: "string", hint: "e.g. Research Output" },
      { key: "title", label: "Heading · 标题", kind: "string", hint: "e.g. Selected Publications" },
      {
        key: "layout",
        label: "Layout · 排版",
        kind: "select",
        options: [
          { value: "list", label: "List (publications) · 列表（论文）" },
          { value: "grid", label: "Card grid (appointments, honours) · 卡片网格" },
        ],
      },
      {
        key: "columns",
        label: "Card columns · 卡片列数",
        kind: "select",
        options: [
          { value: "", label: "Default · 默认" },
          { value: 2, label: "2" },
          { value: 3, label: "3" },
        ],
      },
      { key: "compact", label: "Small highlight tiles · 紧凑小卡片", kind: "checkbox" },
      {
        key: "items",
        label: "Items · 条目",
        kind: "typed",
        types: [
          {
            type: "publication",
            label: "Publication · 论文 / 著作",
            fields: [
              { key: "label", label: "Label (usually the year) · 标签（通常是年份）", kind: "string", required: true },
              { key: "title", label: "Title · 题目", kind: "string", required: true },
              { key: "authors", label: "Authors · 作者", kind: "string", hint: "e.g. Shi, Q. (First Author)" },
              { key: "venue", label: "Journal / publisher · 期刊 / 出版信息", kind: "string", hint: "Use *asterisks* for italics. 可用 *斜体*。" },
              { key: "link.href", label: "Link (https://…) · 链接", kind: "string" },
              { key: "link.text", label: "Link text · 链接文字", kind: "string", hint: "e.g. DOI: 10.1234/abcd" },
            ],
          },
          { type: "card", label: "Card · 卡片", fields: card },
        ],
      },
    ],
  },
];

const ROLE: Field = {
  key: "role",
  label: "Your position on the board · 您在编委会的职位",
  kind: "string",
  required: true,
  hint: "e.g. Editorial Board Member, Executive Editorial Board Member. 例如 Editorial Board Member。",
};

const ERRORS: Record<string, string> = {
  removed: "This address no longer has access to that page. Please write to us. 该邮箱已无权编辑这一页，请联系编辑部。",
  link_expired: "This sign-in link has expired. Request a new one below. 链接已过期，请重新获取。",
  not_configured: "Sign-in is not available yet. 登录功能尚未开通。",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const INPUT = "block w-full rounded-md border-rule text-sm focus:border-brand-600 focus:ring-brand-600";
const SMALL_BTN = "rounded-sm border border-rule px-2 py-1 text-xs text-muted hover:border-brand-600 hover:text-brand-600";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

let uid = 0;
function labelled(field: Field, control: HTMLElement, wrapLabel = true): HTMLElement {
  const id = `f${++uid}`;
  control.id = id;
  const label = h("label", { for: id, class: "label mb-1.5 block" }, field.label + (field.required ? " *" : ""));
  const box = h("div", {}, wrapLabel && field.label ? label : "", control);
  if (field.hint) box.append(h("p", { class: "mt-1 text-xs text-faint" }, field.hint));
  return box;
}

function getPath(o: Obj, key: string): Value {
  return key.split(".").reduce<Value>((v, k) => (v && typeof v === "object" ? (v as Obj)[k] : undefined), o);
}
function setPath(o: Obj, key: string, value: Value) {
  const keys = key.split(".");
  let at = o;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Obj;
  at[keys.at(-1)!] = value;
}

function bind(field: Field, value: Value): Bound {
  switch (field.kind) {
    case "string":
    case "text": {
      const input = field.kind === "text" ? h("textarea", { rows: "3", class: INPUT }) : h("input", { type: "text", class: INPUT });
      input.value = value == null ? "" : String(value);
      return { el: labelled(field, input), get: () => input.value.trim() };
    }
    case "select": {
      const select = h("select", { class: INPUT });
      for (const o of field.options!) select.append(h("option", { value: String(o.value) }, o.label));
      select.value = value == null ? String(field.options![0].value) : String(value);
      return {
        el: labelled(field, select),
        get: () => field.options!.find((o) => String(o.value) === select.value)?.value,
      };
    }
    case "checkbox": {
      const box = h("input", { type: "checkbox", class: "rounded-sm border-rule text-brand focus:ring-brand-600" });
      box.checked = value === true;
      const id = `f${++uid}`;
      box.id = id;
      return { el: h("label", { for: id, class: "flex items-center gap-2 text-sm" }, box, field.label), get: () => box.checked };
    }
    case "strings":
      return listOf(field, Array.isArray(value) ? value : [], (v) => {
        const one = { ...field, kind: field.item ?? "string", label: "", hint: undefined } as Field;
        const b = bind(one, v);
        return { el: b.el, get: b.get, title: () => "" };
      }, false);
    case "objects":
      return listOf(field, Array.isArray(value) ? value : [], (v) => group(field.fields!, (v ?? {}) as Obj, field.summary));
    case "typed":
      return listOf(field, Array.isArray(value) ? value : [], (v) => {
        const o = (v ?? {}) as Obj;
        const t = field.types!.find((t) => t.type === o.type) ?? field.types![0];
        const g = group(t.fields, o, (x) => [t.label.split(" · ")[0], x.label, x.title].filter(Boolean).join(" · "));
        return { ...g, get: () => ({ type: t.type, ...(g.get() as Obj) }) };
      });
  }
}

function group(fields: Field[], value: Obj, summary?: (o: Obj) => string) {
  const parts = fields.map((f) => ({ f, b: bind(f, getPath(value, f.key)) }));
  const get = () => {
    const out: Obj = {};
    for (const { f, b } of parts) setPath(out, f.key, b.get());
    return out;
  };
  return { el: h("div", { class: "grid gap-4" }, ...parts.map((p) => p.b.el)), get, title: () => summary?.(get()) ?? "" };
}

/**
 * A repeatable list with add, remove and reorder. Object rows collapse
 * into a <details> showing a one-line summary.
 */
function listOf(
  field: Field,
  values: Value[],
  make: (v: Value) => { el: HTMLElement; get(): Value; title(): string },
  collapsible = true,
): Bound {
  const rows: { row: HTMLElement; get(): Value }[] = [];
  const list = h("div", { class: "grid gap-2" });
  const box = h("fieldset", { class: "grid min-w-0 gap-2" });
  if (field.label) box.append(h("legend", { class: "label mb-1.5" }, field.label));
  if (field.hint && field.label) box.append(h("p", { class: "-mt-1 mb-1 text-xs text-faint" }, field.hint));
  box.append(list);

  const add = (v: Value, open = false) => {
    const item = make(v);
    const controls = h("div", { class: "flex shrink-0 gap-1" });
    const btn = (text: string, title: string, fn: () => void) => {
      const b = h("button", { type: "button", class: SMALL_BTN, title, "aria-label": title }, text);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn();
      });
      controls.append(b);
    };
    let row: HTMLElement;
    if (collapsible) {
      const summary = h("summary", { class: "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm" });
      const text = h("span", { class: "min-w-0 truncate" });
      const refresh = () => (text.textContent = item.title() || "(new · 新条目)");
      refresh();
      item.el.addEventListener("input", refresh);
      summary.append(text, controls);
      row = h("details", { class: "rounded-md border border-rule bg-paper open:bg-surface/50" }, summary, h("div", { class: "border-t border-rule p-4" }, item.el));
      (row as HTMLDetailsElement).open = open;
    } else {
      row = h("div", { class: "flex items-start gap-2" }, h("div", { class: "min-w-0 grow" }, item.el), controls);
    }
    const entry = { row, get: item.get };
    btn("↑", "Move up · 上移", () => move(entry, -1));
    btn("↓", "Move down · 下移", () => move(entry, 1));
    btn("×", "Remove · 删除", () => {
      if (collapsible && !confirm("Remove this item? 删除这一项？")) return;
      rows.splice(rows.indexOf(entry), 1);
      row.remove();
    });
    rows.push(entry);
    list.append(row);
  };
  const move = (entry: (typeof rows)[number], by: number) => {
    const i = rows.indexOf(entry);
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    rows.splice(i, 1);
    rows.splice(j, 0, entry);
    list.replaceChildren(...rows.map((r) => r.row));
  };

  for (const v of values) add(v);
  const adders = h("div", { class: "flex flex-wrap gap-2" });
  const options = field.kind === "typed" ? field.types!.map((t) => ({ label: t.label, v: { type: t.type } })) : [{ label: "", v: field.kind === "strings" ? "" : {} }];
  for (const o of options) {
    const b = h("button", { type: "button", class: SMALL_BTN }, `+ Add ${o.label || "· 添加"}`);
    b.addEventListener("click", () => add(structuredClone(o.v), true));
    adders.append(b);
  }
  box.append(adders);
  return { el: box, get: () => rows.map((r) => r.get()) };
}

// ---- Page -----------------------------------------------------------------

let photo: string | undefined;

async function start() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  if (error) history.replaceState(null, "", location.pathname);

  const res = await fetch("/api/me", { headers: { Accept: "application/json" } }).catch(() => undefined);
  const data = await res?.json().catch(() => undefined);
  $("status").classList.add("hidden");
  if (!data) {
    $("status").textContent = "Could not reach the server. Please try again later. 无法连接服务器，请稍后再试。";
    $("status").classList.remove("hidden");
    return;
  }
  if (data.error === "not_configured") return showSignIn(false, "not_configured");
  if (!data.signedIn) return showSignIn(true, error ?? data.error);
  showEditor(data);
}

function showSignIn(available: boolean, error?: string) {
  $("signin").classList.remove("hidden");
  if (error) {
    $("signin-error").textContent = ERRORS[error] ?? ERRORS.not_configured;
    $("signin-error").classList.remove("hidden");
  }
  $(available ? "email-form" : "none").classList.remove("hidden");

  $("email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $("email-form").querySelector("button")!;
    button.disabled = true;
    await fetch("/auth/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $<HTMLInputElement>("email").value }),
    }).catch(() => undefined);
    $("email-sent").classList.remove("hidden");
    setTimeout(() => (button.disabled = false), 60_000);
  });
}

function showEditor(data: { email: string; slug: string | null; isNew: boolean; data: Obj; body: string; photoUrl: string | null; pending: unknown }) {
  $("editor").classList.remove("hidden");
  $("who").textContent = data.email;
  if (!data.isNew) {
    $<HTMLAnchorElement>("view").href = `/board/${data.slug}`;
    $("view-wrap").classList.remove("hidden");
  }
  if (data.isNew && !data.pending) $("new").classList.remove("hidden");
  if (data.pending) $("pending").classList.remove("hidden");

  const form = $("form");
  const d = data.data;
  // A new profile states its own position; the editorial office confirms it.
  const role = data.isNew ? bind(ROLE, d.role) : undefined;

  if (role) {
    form.append(section("Position · 职位", role.el, "The editorial office will confirm it. 编辑部审核时会确认。"));
  } else {
    // Admin-only details, shown for reference.
    const fixed = h("dl", { class: "grid gap-x-8 gap-y-3 rounded-md bg-surface p-4 text-sm sm:grid-cols-3" });
    for (const [label, value] of [
      ["Position · 职位", d.role],
      ["Public email · 公开邮箱", d.email || "—"],
      ["Listing order · 排序", d.order],
    ]) fixed.append(h("div", {}, h("dt", { class: "label" }, String(label)), h("dd", { class: "mt-0.5 break-words" }, String(value ?? "—"))));
    form.append(
      section("Set by the editorial office · 由编辑部设置", fixed, "To change these, write to directory.admin@panorama-sg.com. 如需修改，请联系编辑部。"),
    );
  }

  // Photo
  const img = h("img", { alt: "", class: "aspect-[4/5] w-32 rounded-md bg-surface object-cover" }) as HTMLImageElement;
  if (data.photoUrl) img.src = data.photoUrl;
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-paper file:px-3 file:py-1.5 file:text-sm" }) as HTMLInputElement;
  const photoNote = h("p", { class: "mt-2 text-xs text-faint" }, "A portrait photo works best; it is cropped to 4:5. 建议竖版人像，网站按 4:5 裁切。");
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    photo = await shrink(f);
    img.src = photo;
  });
  form.append(section("Photo · 照片", h("div", { class: "flex items-end gap-5" }, img, h("div", {}, file, photoNote))));

  const main = group(FIELDS.slice(0, 6), d);
  form.append(section("Profile · 基本信息", main.el));
  // The section heading already names these lists.
  const ids = bind({ ...FIELDS[6], label: "" }, d.identifiers);
  const sections = bind({ ...FIELDS[7], label: "" }, d.sections);
  form.append(section("Academic IDs · 学术 ID", ids.el, FIELDS[6].hint));

  const bio = h("textarea", { rows: "10", class: INPUT }) as HTMLTextAreaElement;
  bio.value = data.body;
  form.append(
    section(
      "Biography · 个人简介",
      labelled({ key: "body", label: "Biography", kind: "text", hint: "Separate paragraphs with a blank line. *italic*, **bold** and [links](https://…) work. 段落之间空一行。" }, bio, false),
    ),
  );
  form.append(section("Profile sections · 个人页板块", sections.el));

  $("save").addEventListener("click", async () => {
    const status = $("save-status");
    const button = $<HTMLButtonElement>("save");
    const entry = { ...(main.get() as Obj), identifiers: ids.get(), sections: sections.get(), ...(role ? { role: role.get() } : {}) };
    button.disabled = true;
    status.textContent = "Submitting… 提交中…";
    const res = await fetch("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: entry, body: bio.value, ...(photo ? { photo: { base64: photo } } : {}) }),
    }).catch(() => undefined);
    const out = await res?.json().catch(() => undefined);
    button.disabled = false;
    if (res?.status === 401) {
      status.textContent = "You have been signed out. Copy anything you need, then reload and sign in again. 登录已过期，请重新登录。";
    } else if (!out?.ok) {
      status.textContent = `Not saved: ${out?.message ?? "please try again."} 未保存，请检查后重试。`;
    } else if (out.unchanged) {
      status.textContent = "Nothing has changed. 没有修改。";
    } else {
      photo = undefined;
      $("new").classList.add("hidden");
      $("pending").classList.remove("hidden");
      status.textContent = "Submitted. The editorial office will review it before it goes live. 已提交，审核通过后上线。";
    }
  });
}

function section(title: string, body: HTMLElement, note?: string) {
  const s = h("section", { class: "grid min-w-0 gap-4 md:grid-cols-12 md:gap-8" });
  const head = h("div", { class: "md:col-span-4" }, h("h2", { class: "text-base font-semibold" }, title));
  if (note) head.append(h("p", { class: "mt-1 text-sm text-muted" }, note));
  s.append(head, h("div", { class: "min-w-0 md:col-span-8" }, body));
  return s;
}

/** Re-encode the chosen photo as a JPEG at most 1600px on its long side. */
async function shrink(f: File): Promise<string> {
  const bitmap = await createImageBitmap(f);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

start();
