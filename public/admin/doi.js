/*
  "DOI 自动填写" for publication rows in the /admin editor: paste a DOI, press
  the button, and the row's 标签 / 题目 / 作者 / 期刊 / 链接 fill in from
  Crossref or DataCite via /api/lookup (worker/lookup.ts), the same lookup the
  scholars' /edit page uses.

  A Decap widget can only change its own value, so the filled values are typed
  into the row's other inputs the way a person would (one input event each),
  and Decap saves them as usual. The DOI box itself is only a helper: preSave
  below drops it, so the content files keep the shape src/content.config.ts
  expects.
*/
(function () {
  if (!window.CMS) return;
  var h = window.h;

  // Field labels in config.yml → path in the looked-up row.
  var TARGETS = [
    ["标签", "label"],
    ["题目", "title"],
    ["作者", "authors"],
    ["期刊", "venue"],
    ["网址", "link.href"],
    ["显示文字", "link.text"],
  ];

  function pick(obj, path) {
    return path.split(".").reduce(function (v, k) {
      return v && v[k];
    }, obj);
  }

  // The nearest ancestor that also holds this row's 题目 field.
  function rowOf(el) {
    for (var at = el.parentElement; at; at = at.parentElement) {
      var labels = at.querySelectorAll("label[for]");
      for (var i = 0; i < labels.length; i++) if (labels[i].textContent.trim().indexOf("题目") === 0) return at;
    }
    return null;
  }

  // React only notices a value set through the native setter plus an event.
  function type(input, value) {
    var proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  async function fill(row, item) {
    var labels = row.querySelectorAll("label[for]");
    for (var t = 0; t < TARGETS.length; t++) {
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].textContent.trim().indexOf(TARGETS[t][0]) !== 0) continue;
        var input = document.getElementById(labels[i].htmlFor);
        if (!input || !/^(INPUT|TEXTAREA)$/.test(input.tagName)) continue;
        type(input, pick(item, TARGETS[t][1]) || "");
        // Each change re-renders the list; let it land before the next one.
        await wait(40);
        break;
      }
    }
  }

  var DoiControl = createClass({
    getInitialState: function () {
      return { busy: false, message: "" };
    },
    lookup: async function () {
      var doi = String(this.props.value || "").trim();
      if (!doi) return this.setState({ message: "请先粘贴 DOI。" });
      var row = rowOf(this.root);
      if (!row) return this.setState({ message: "找不到这一条的输入框，请手动填写。" });
      this.setState({ busy: true, message: "查询中…" });
      var out;
      try {
        var res = await fetch("/api/lookup?doi=" + encodeURIComponent(doi), { headers: { Accept: "application/json" } });
        out = await res.json();
      } catch (e) {
        out = { message: "无法连接查询服务。" };
      }
      if (!out || !out.ok) return this.setState({ busy: false, message: (out && out.message) || "未找到。" });
      await fill(row, out.item);
      this.setState({ busy: false, message: "已填写，请核对：" + out.item.title });
    },
    render: function () {
      var self = this;
      return h(
        "div",
        {
          className: "pd-doi",
          ref: function (el) {
            self.root = el;
          },
        },
        h(
          "div",
          { className: "pd-doi-row" },
          h("input", {
            id: this.props.forID,
            type: "text",
            className: this.props.classNameWrapper,
            value: this.props.value || "",
            placeholder: "10.1000/xyz123 或 https://doi.org/…",
            spellCheck: false,
            autoComplete: "off",
            onFocus: this.props.setActiveStyle,
            onBlur: this.props.setInactiveStyle,
            onChange: function (e) {
              self.props.onChange(e.target.value);
            },
            onKeyDown: function (e) {
              if (e.key === "Enter") {
                e.preventDefault();
                self.lookup();
              }
            },
          }),
          h("button", { type: "button", className: "pd-doi-button", disabled: this.state.busy, onClick: this.lookup }, this.state.busy ? "查询中…" : "自动填写")
        ),
        this.state.message ? h("p", { className: "pd-doi-message" }, this.state.message) : null
      );
    },
  });

  CMS.registerWidget("doi", DoiControl);

  // Drop the helper DOI box from every row before the entry is saved.
  CMS.registerEventListener({
    name: "preSave",
    handler: function (args) {
      var data = args.entry.get("data");
      var sections = data.get("sections");
      if (!sections || !sections.map) return data;
      return data.set(
        "sections",
        sections.map(function (sec) {
          var items = sec && sec.get && sec.get("items");
          if (!items || !items.map) return sec;
          return sec.set(
            "items",
            items.map(function (item) {
              return item && item.has && item.has("doi") ? item.delete("doi") : item;
            })
          );
        })
      );
    },
  });
})();
