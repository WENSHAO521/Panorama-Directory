/*
  The repository's ruleset only accepts changes to `main` through a pull
  request. Most of /admin already works that way: saves become a draft
  branch + PR (editorial workflow) and "发布" merges that PR. But a few
  actions make Decap move `main` itself, and GitHub refuses them with
  "Repository rule violations found":
    - deleting a published scholar (删除内容),
    - uploading or deleting a photo in the photo library (媒体).

  Decap does those by building a commit and then PATCHing
  git/refs/heads/main to it. This file catches that one request and routes the
  same commit through a pull request instead: it pushes the commit to a
  temporary branch, opens a PR, merges it, deletes the branch, and hands
  Decap back a normal "ref updated" response. Nothing else is touched.

  Load it before decap-cms.js.
*/
(function () {
  var REPO = "/repos/WENSHAO521/Panorama-Directory/";
  var BASE = "main";
  var realFetch = window.fetch.bind(window);

  function isMainRefUpdate(url, init) {
    var method = ((init && init.method) || "GET").toUpperCase();
    if (method !== "PATCH") return false;
    var u = String(url);
    var at = u.indexOf(REPO + "git/refs/heads/");
    return at !== -1 && decodeURIComponent(u.slice(at + REPO.length + "git/refs/heads/".length)).split("?")[0] === BASE;
  }

  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
  }

  async function viaPullRequest(url, init) {
    var api = String(url).slice(0, String(url).indexOf(REPO) + REPO.length);
    var headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json");
    async function call(path, method, body) {
      var res = await realFetch(api + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
      var data = res.status === 204 ? null : await res.json().catch(function () { return null; });
      if (!res.ok) {
        var err = new Error((data && data.message) || "GitHub " + res.status);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    var sha = JSON.parse(init.body || "{}").sha;
    var commit = await call("git/commits/" + sha, "GET");
    var title = (commit && commit.message ? commit.message : "Update from /admin").split("\n")[0];
    var branch = "admin-change/" + Date.now();

    await call("git/refs", "POST", { ref: "refs/heads/" + branch, sha: sha });
    var pr;
    try {
      pr = await call("pulls", "POST", {
        title: title,
        head: branch,
        base: BASE,
        body: "Made in /admin (" + title + "). Merged automatically, because the repository only accepts changes to main through pull requests.",
      });
      var merged = await call("pulls/" + pr.number + "/merge", "PUT", { merge_method: "squash", commit_title: title + " (#" + pr.number + ")", sha: sha });
      await call("git/refs/heads/" + encodeURIComponent(branch), "DELETE").catch(function () {});
      return json(200, { ref: "refs/heads/" + BASE, object: { sha: merged.sha, type: "commit" } });
    } catch (e) {
      // Leave an open PR in place so the change is not lost, and say where it is.
      var where = pr ? "已建立 PR #" + pr.number + "，请在 GitHub 上合并：" + pr.html_url : "未能建立 PR";
      if (!pr) await call("git/refs/heads/" + encodeURIComponent(branch), "DELETE").catch(function () {});
      return json(e.status || 422, { message: (e.message || "失败") + "。" + where });
    }
  }

  window.fetch = function (url, init) {
    var target = url && typeof url === "object" && "url" in url ? url.url : url;
    if (init && isMainRefUpdate(target, init)) return viaPullRequest(target, init);
    return realFetch(url, init);
  };
})();
