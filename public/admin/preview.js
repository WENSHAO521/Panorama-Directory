/*
  The proof beside the form in /admin: a scholar's profile laid out the
  way /board/<slug> renders it (src/pages/board/[slug].astro and
  ProfileSection.astro), so editors see the page they are about to publish.
  Decap exposes React's createElement as window.h and createClass globally;
  plain JS, no build step. Styles: preview.css.
*/
(function () {
  if (!window.CMS) return;
  var h = window.h;

  // Mirrors ALL_JOURNALS and the cover cloth colours in src/lib/scholars.ts.
  var JOURNALS = [
    "AI & Future Society",
    "Journal of Engineering Systems and Applications",
    "Health Nexus",
    "Health Nexus: Digital Health and Medical AI",
    "Climate Sustainability & Global Systems",
    "Journal of Sport and Exercise Studies",
    "Rural Governance & Green Development",
    "Contemporary Review of Political Thought",
    "International Review of Education and Learning Sciences",
    "Journal of Law, Psychology, and Communication Studies",
    "Journal of Social Cognition and Communication",
    "PoliEcoM Administration Review",
    "Global Review of Humanities, Arts, and Society",
    "Journal of Dance and Embodied Structure",
    "Resonance: Journal of Global Music Studies",
    "Three Teachings Studies",
    "Silence",
  ];
  var CLOTH = {
    "Global Review of Humanities, Arts, and Society": "#d9cfbf",
    "Health Nexus": "#1f4a4a",
    Silence: "#e8e6e1",
    "Journal of Social Cognition and Communication": "#0f1a33",
  };
  function key(t) {
    return String(t || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  }
  var BY_KEY = {};
  JOURNALS.forEach(function (j) { BY_KEY[key(j)] = j; });

  // Journals named exactly by an appointment card title (or its entries).
  function journalsOf(d) {
    var found = {};
    (d.sections || []).forEach(function (sec) {
      (sec.items || []).forEach(function (item) {
        if (item.type !== "card") return;
        [item.title].concat((item.entries || []).map(function (e) { return e.title; })).forEach(function (t) {
          var j = BY_KEY[key(t)];
          if (j) found[j] = true;
        });
      });
    });
    return JOURNALS.filter(function (j) { return found[j]; });
  }

  // *Journal* → <i>Journal</i>, the venue convention used in the content files.
  function italics(text) {
    return String(text || "")
      .split(/(\*[^*]+\*)/)
      .map(function (part, i) {
        return /^\*[^*]+\*$/.test(part) ? h("i", { key: i }, part.slice(1, -1)) : part;
      });
  }

  function slugOf(entry, name) {
    var s = entry.get("slug");
    if (s) return s;
    return String(name || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function heading(kicker, title, count) {
    return h(
      "div",
      { className: "sec-head" },
      kicker ? h("p", { className: "kicker" }, kicker) : null,
      h("h2", null, title, count !== undefined ? h("span", { className: "count" }, "(" + count + ")") : null)
    );
  }

  function publication(item, i) {
    var link = item.link || {};
    return h(
      "li",
      { className: "pub", key: i },
      h("span", { className: "pub-label" }, item.label),
      h(
        "div",
        { className: "pub-body" },
        h("h3", null, item.title || "未填写题目"),
        item.authors ? h("p", null, italics(item.authors)) : null,
        item.venue ? h("p", { className: "venue" }, italics(item.venue)) : null,
        link.href ? h("a", { className: "link", href: link.href }, link.text || link.href) : null
      )
    );
  }

  function card(item, i) {
    return h(
      "div",
      { className: "card" + (item.centered ? " centered" : ""), key: i },
      item.title ? h("h3", null, item.title) : null,
      item.entries && item.entries.length
        ? h("dl", null, item.entries.map(function (e, j) {
            return h("div", { key: j }, h("dt", null, e.title), h("dd", null, e.meta));
          }))
        : null,
      (item.meta || []).map(function (m, j) { return h("p", { className: "card-meta", key: j }, italics(m)); }),
      (item.text || []).map(function (t, j) { return h("p", { className: "card-text", key: j }, italics(t)); }),
      item.list && item.list.length
        ? h("ul", null, item.list.map(function (t, j) { return h("li", { key: j }, italics(t)); }))
        : null
    );
  }

  function section(sec, i) {
    var items = (sec.items || []).filter(Boolean);
    if (!items.length) return null;
    var list = sec.layout === "list";
    var cols = sec.columns === 3 || sec.compact ? 3 : 2;
    return h(
      "section",
      { className: "sec", key: i },
      heading(sec.eyebrow || "Research Focus", sec.title || "Areas of Expertise", list ? items.length : undefined),
      list
        ? h("ol", { className: "pubs" }, items.map(function (it, j) { return it.type === "publication" ? publication(it, j) : null; }))
        : h("div", { className: "cards cols-" + cols }, items.map(function (it, j) { return it.type === "card" ? card(it, j) : null; }))
    );
  }

  function fact(label, value, k) {
    return h("div", { className: "fact", key: k }, h("dt", null, label), h("dd", null, value));
  }

  var ScholarProof = createClass({
    render: function () {
      var entry = this.props.entry;
      var d = entry.get("data").toJS();
      var photo = d.photo ? this.props.getAsset(d.photo) : null;
      var photoUrl = photo ? photo.toString() : "";
      var journals = journalsOf(d);
      var slug = slugOf(entry, d.name);
      var anchors = [{ t: "Biography" }].concat(
        (d.sections || []).filter(function (s) { return s && (s.items || []).length; }).map(function (s) { return { t: s.title || "Areas of Expertise" }; })
      );

      var facts = [fact("Position", d.role || "—", "p"), fact("Affiliation", d.affiliation || "—", "a")];
      if (journals.length) {
        facts.push(
          fact(journals.length === 1 ? "Journal" : "Journals", journals.map(function (j) {
            return h("p", { className: "journal", key: j }, h("span", { className: "cloth", style: { background: CLOTH[j] || "#0e2a47" } }), h("i", null, j));
          }), "j")
        );
      }
      (d.identifiers || []).forEach(function (id, i) {
        facts.push(fact(id.label, h("a", { className: "link idnum", href: id.href }, id.label === "ORCID" ? h("span", { className: "orcid" }) : null, id.value), "id" + i));
      });
      if (d.email) facts.push(fact("Email", h("a", { className: "link", href: "mailto:" + d.email }, d.email), "e"));

      return h(
        "div",
        { className: "proof" },
        h(
          "div",
          { className: "slip" },
          h("span", { className: "slip-tag" }, "校样"),
          h("span", { className: "slip-url" }, "/board/" + (slug || "…")),
          h("span", { className: "slip-note" }, "发布后约 1–2 分钟上线")
        ),
        h(
          "div",
          { className: "page" },
          h(
            "aside",
            { className: "aside" },
            h("div", { className: "photo" + (photoUrl ? "" : " empty"), style: photoUrl ? { backgroundImage: "url(" + photoUrl + ")" } : null }),
            h("dl", { className: "facts" }, facts)
          ),
          h(
            "div",
            { className: "main" },
            h(
              "header",
              { className: "head" },
              h("p", { className: "kicker" }, d.role || "职位"),
              h("h1", null, d.name || "姓名", d.nativeName ? h("span", { className: "native", lang: "zh" }, d.nativeName) : null),
              h("p", { className: "aff" }, d.headline || d.affiliation || "单位"),
              d.keywords && d.keywords.length
                ? h("ul", { className: "tags" }, d.keywords.map(function (k, i) { return h("li", { key: i }, k); }))
                : null,
              h(
                "div",
                { className: "actions" },
                d.email ? h("span", { className: "btn" }, "Contact researcher") : null,
                h("ul", { className: "anchors" }, anchors.map(function (a, i) { return h("li", { key: i }, a.t); }))
              )
            ),
            h(
              "section",
              { className: "sec" },
              heading("Profile", "Biography"),
              d.body ? h("div", { className: "bio" }, this.props.widgetFor("body")) : h("p", { className: "bio empty" }, "还没有个人简介")
            ),
            (d.sections || []).map(section)
          )
        )
      );
    },
  });

  CMS.registerPreviewStyle("/admin/preview.css");
  CMS.registerPreviewTemplate("scholars", ScholarProof);
})();
