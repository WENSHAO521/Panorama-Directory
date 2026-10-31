/*
  Richer list rows for the Decap editor.
  Decap shows each collapsed list item as one plain summary string. For
  publications config.yml joins label | title | authors | venue with " | ";
  this script splits that string into spans so admin.css can lay the row out
  like the citation on the public page. It also:
  - shows the value on rows of single-value lists (Decap shows the label);
  - lets a click anywhere on the summary open or close the item;
  - asks before deleting a row (Decap deletes at once, with no undo);
  - fixes a few untranslated or awkward Decap strings.
  Nothing here touches saved data.
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

  // A list of single values (要点、段落、登录邮箱…) has no summary: Decap shows
  // the field's label on every row. Show the value itself instead.
  function singleValue(item, src) {
    var body = item && item.lastElementChild;
    if (!body || body === item.querySelector('[class*="-NestedObjectLabel"]')) return null;
    var controls = body.querySelectorAll('[class*="-ControlContainer"]');
    if (controls.length !== 1) return null;
    var lab = controls[0].querySelector("label");
    var name = lab ? lab.firstChild && lab.firstChild.nodeType === 3 ? lab.firstChild.nodeValue : lab.textContent : "";
    if (name.trim() !== src.trim()) return null;
    var input = controls[0].querySelector("input, textarea");
    return input ? input.value : null;
  }

  function render(label) {
    var own = label.firstChild && label.firstChild.nodeType === 3 ? label.firstChild : null;
    var src = own ? own.nodeValue : "";
    var single = singleValue(label.parentElement, src);
    var key = single === null ? src : src + "\u0000" + single;
    if (label.getAttribute("data-src") === key && label.querySelector(".pd-row")) return;
    label.setAttribute("data-src", key);
    var old = label.querySelector(".pd-row");
    if (old) old.remove();

    var row = span("pd-row");
    row.setAttribute("aria-hidden", "true");
    var item = label.parentElement;
    if (single !== null) {
      var one = span("pd-row-body");
      one.appendChild(span("pd-row-title is-value", single.trim() || "（空）"));
      row.appendChild(one);
      item && item.setAttribute("data-row", "single");
    } else if (src.indexOf(SEP) !== -1) {
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
      // "ORCID: 0009-…" -> number as the title, the ID's name beneath.
      var m = src.match(/^([^:：]{1,40})[:：](.*)$/);
      var body2 = span("pd-row-body");
      var name = m ? m[1].trim() : "";
      var value = m ? m[2].trim() : "";
      if (m && value) {
        body2.appendChild(span("pd-row-title", value));
        if (name) body2.appendChild(span("pd-row-meta", name));
      } else body2.appendChild(span("pd-row-title", (m ? name : src.trim()) || "（未填写）"));
      row.appendChild(body2);
      item && item.setAttribute("data-row", "plain");
    }
    label.appendChild(row);
  }

  function scan() {
    document.querySelectorAll('[class*="-NestedObjectLabel"]').forEach(render);
    document.querySelectorAll('[class*="-StyledDropdownButton"], [class*="-AddButton"]').forEach(fixAddLabel);
    document.querySelectorAll('[class*="-ListCardTitle"]').forEach(renderListCard);
    var back = document.querySelector('[class*="-BackCollection"]');
    if (back) fixText(back);
  }

  // Scholar list (table view): "Name\nRole" -> bold name, grey role.
  function renderListCard(el) {
    var own = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
    var src = own ? own.nodeValue : "";
    if (el.getAttribute("data-src") === src && el.querySelector(".pd-card")) return;
    el.setAttribute("data-src", src);
    var old = el.querySelector(".pd-card");
    if (old) old.remove();
    var lines = src.split("\n");
    var card = span("pd-card");
    card.setAttribute("aria-hidden", "true");
    card.appendChild(span("pd-card-name", lines[0] || ""));
    if (lines[1]) card.appendChild(span("pd-card-role", lines.slice(1).join(" ")));
    el.appendChild(card);
  }

  // "正在集合“学者”中编写" -> "编辑学者"; "…中创建" -> "新建学者".
  function fixText(el) {
    var t = el.firstChild;
    if (!t || t.nodeType !== 3) return;
    var v = t.nodeValue
      .replace(/^正在集合“(.+)”中编写$/, "编辑$1")
      .replace(/^正在集合“(.+)”中创建$/, "新建$1");
    if (v !== t.nodeValue) t.nodeValue = v;
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

  // Typing in a single-value row updates its summary.
  document.addEventListener("input", function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
    });
  });

  // Delete removes the row at once and Decap has no undo, so ask first.
  document.addEventListener(
    "click",
    function (e) {
      var btn = e.target.closest && e.target.closest('[class*="-StyledListItemTopBar"] > button:last-child');
      if (!btn) return;
      var item = btn.closest('[class*="-SortableListItem"]');
      var title = item && item.querySelector(':scope > [class*="-NestedObjectLabel"] .pd-row-title');
      var name = title ? title.textContent.trim() : "";
      if (!window.confirm(name ? "删除“" + name + "”？" : "删除这一条？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // Click the summary to open or close the item.
  document.addEventListener("click", function (e) {
    var label = e.target.closest && e.target.closest('[class*="-NestedObjectLabel"]');
    if (!label) return;
    var bar = label.parentElement && label.parentElement.querySelector('[class*="-StyledListItemTopBar"] > button');
    if (bar) bar.click();
  });
})();
