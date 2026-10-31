/*
  Richer list rows for the Decap editor.
  Decap shows each collapsed list item as one plain summary string. For
  publications config.yml joins label | title | authors | venue with " | ";
  this script splits that string into spans so admin.css can lay the row out
  like the citation on the public page. It also lets a click anywhere on the
  summary open or close the item, and translates Decap's untranslated
  "Add …" button. Nothing here touches saved data.
*/
(function () {
  var SEP = " | ";

  function venueNodes(text) {
    // "*Journal*, 1(5)" -> Journal in italics, like the public page.
    var frag = document.createDocumentFragment();
    text.split(/(\*[^*]+\*)/).forEach(function (part) {
      if (!part) return;
      if (/^\*[^*]+\*$/.test(part)) {
        var em = document.createElement("em");
        em.textContent = part.slice(1, -1);
        frag.appendChild(em);
      } else frag.appendChild(document.createTextNode(part));
    });
    return frag;
  }

  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    if (typeof text === "string") s.textContent = text;
    else if (text) s.appendChild(text);
    return s;
  }

  function render(label) {
    var own = label.firstChild && label.firstChild.nodeType === 3 ? label.firstChild : null;
    var src = own ? own.nodeValue : "";
    if (label.getAttribute("data-src") === src && label.querySelector(".pd-row")) return;
    label.setAttribute("data-src", src);
    var old = label.querySelector(".pd-row");
    if (old) old.remove();

    var row = span("pd-row");
    row.setAttribute("aria-hidden", "true");
    var item = label.parentElement;
    if (src.indexOf(SEP) !== -1) {
      var parts = src.split(SEP);
      var tag = parts.shift().trim();
      var venue = (parts.pop() || "").trim();
      var authors = (parts.pop() || "").trim();
      var title = parts.join(SEP).trim();
      if (tag) row.appendChild(span("pd-row-tag" + (/^\d{4}$/.test(tag) ? " is-year" : ""), tag));
      else row.appendChild(span("pd-row-tag is-empty", ""));
      var body = span("pd-row-body");
      body.appendChild(span("pd-row-title", title || "（未填写题目）"));
      if (authors || venue) {
        var meta = span("pd-row-meta");
        if (authors) meta.appendChild(span("pd-row-authors", authors));
        if (venue) meta.appendChild(span("pd-row-venue", venueNodes(venue)));
        body.appendChild(meta);
      }
      row.appendChild(body);
      item && item.setAttribute("data-row", "pub");
    } else {
      var m = src.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
      var body2 = span("pd-row-body");
      if (m) {
        body2.appendChild(span("pd-row-title", m[2]));
        body2.appendChild(span("pd-row-meta", m[1]));
      } else body2.appendChild(span("pd-row-title", src));
      row.appendChild(body2);
      item && item.setAttribute("data-row", "plain");
    }
    label.appendChild(row);
  }

  function scan() {
    document.querySelectorAll('[class*="-NestedObjectLabel"]').forEach(render);
    document.querySelectorAll('[class*="-StyledDropdownButton"], [class*="-AddButton"]').forEach(fixAddLabel);
  }

  // Decap's add buttons say "Add 条目" (no Chinese string for typed lists) or
  // "新增学术 id" (it lower-cases the label). Make them "添加…" with the
  // label's own casing.
  function fixAddLabel(button) {
    var t = button.firstChild;
    if (!t || t.nodeType !== 3) return;
    var text = t.nodeValue.replace(/^(Add\s+|新增)/, "添加");
    var field = button.closest('[aria-label="list field"]');
    var label = field && field.querySelector("label");
    if (label) {
      (label.textContent.match(/[A-Za-z]+/g) || []).forEach(function (word) {
        text = text.replace(new RegExp("\\b" + word + "\\b", "gi"), word);
      });
    }
    if (text !== t.nodeValue) t.nodeValue = text;
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Click the summary to open or close the item.
  document.addEventListener("click", function (e) {
    var label = e.target.closest && e.target.closest('[class*="-NestedObjectLabel"]');
    if (!label) return;
    var bar = label.parentElement && label.parentElement.querySelector('[class*="-StyledListItemTopBar"] > button');
    if (bar) bar.click();
  });
})();
