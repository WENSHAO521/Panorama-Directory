/*
  Live preview for the /admin editor: renders a scholar the way their profile
  page (/board/<slug>) lays them out, so editors see the result while typing.
  Decap exposes React's createElement as window.h and createClass globally;
  this file is plain JS so it needs no build step. Styles: preview.css.
*/
(function () {
  if (!window.CMS) return;
  var h = window.h;

  // *Journal* → <i>Journal</i>, the venue convention used in the content files.
  function italics(text) {
    return String(text || "")
      .split(/(\*[^*]+\*)/)
      .map(function (part, i) {
        return /^\*[^*]+\*$/.test(part) ? h("i", { key: i }, part.slice(1, -1)) : part;
      });
  }

  function publication(item, i) {
    var link = item.link || {};
    return h(
      "li",
      { className: "cite", key: i },
      h("span", { className: "cite-label" }, item.label),
      h(
        "div",
        null,
        h("span", { className: "cite-title" }, item.title),
        item.authors ? " " + item.authors + "." : null,
        item.venue ? h("span", { className: "cite-venue" }, " ", italics(item.venue)) : null,
        link.href ? h("a", { className: "cite-link", href: link.href }, link.text || link.href) : null
      )
    );
  }

  function card(item, i) {
    return h(
      "li",
      { className: "card", key: i },
      item.title ? h("h4", null, item.title) : null,
      (item.meta || []).map(function (m, j) {
        return h("div", { className: "card-meta", key: j }, m);
      }),
      (item.text || []).map(function (t, j) {
        return h("p", { key: j }, t);
      }),
      item.list && item.list.length
        ? h("ul", null, item.list.map(function (t, j) { return h("li", { key: j }, t); }))
        : null,
      (item.entries || []).map(function (e, j) {
        return h("div", { className: "card-entry", key: j }, h("b", null, e.title), e.meta ? " " + e.meta : null);
      })
    );
  }

  function section(sec, i) {
    var items = sec.items || [];
    var grid = sec.layout === "grid";
    return h(
      "section",
      { className: "block", key: i },
      sec.eyebrow ? h("div", { className: "kicker" }, sec.eyebrow) : null,
      sec.title ? h("h3", null, sec.title) : null,
      h(
        "ul",
        { className: grid ? "cards cols-" + (sec.columns || 2) : "cites" },
        items.map(function (item, j) {
          return item.type === "card" ? card(item, j) : publication(item, j);
        })
      )
    );
  }

  var ScholarPreview = createClass({
    render: function () {
      var d = this.props.entry.get("data").toJS();
      var photo = d.photo ? this.props.getAsset(d.photo) : null;
      var photoUrl = photo ? photo.toString() : "";
      var sub = d.headline && d.headline !== d.affiliation ? d.headline : null;

      return h(
        "div",
        { className: "page" },
        h("div", { className: "nav" }, h("b", null, "Panorama Scholarly Group"), h("span", null, "Editorial Board"), h("span", null, "Directory")),
        h(
          "header",
          { className: "hero" },
          h("div", { className: "photo" + (photoUrl ? "" : " empty"), style: photoUrl ? { backgroundImage: "url(" + photoUrl + ")" } : null }, photoUrl ? null : "还没有照片"),
          h(
            "div",
            { className: "who" },
            h("div", { className: "kicker" }, d.role || "职位"),
            h("h1", null, d.name || "姓名", d.nativeName ? h("span", { className: "native" }, d.nativeName) : null),
            h("div", { className: "aff" }, d.affiliation || "单位"),
            sub ? h("div", { className: "aff sub" }, sub) : null,
            d.identifiers && d.identifiers.length
              ? h("div", { className: "badges" }, d.identifiers.map(function (id, i) {
                  return h("a", { key: i, href: id.href }, h("b", null, id.label), " ", id.value);
                }))
              : null,
            d.keywords && d.keywords.length
              ? h("div", { className: "tags" }, d.keywords.map(function (k, i) { return h("span", { key: i }, k); }))
              : null
          )
        ),
        h(
          "main",
          { className: "body" },
          d.summary ? h("p", { className: "summary" }, d.summary) : null,
          d.body ? h("div", { className: "prose" }, this.props.widgetFor("body")) : null,
          (d.sections || []).map(section),
          d.email ? h("div", { className: "email" }, "Email · ", d.email) : null
        )
      );
    },
  });

  CMS.registerPreviewStyle("/admin/preview.css");
  CMS.registerPreviewTemplate("scholars", ScholarPreview);
})();
