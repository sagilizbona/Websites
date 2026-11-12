(function () {
  const cfg = window.SITE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const LS = "shop-admin-gh";

  // ---------- state ----------
  let products = JSON.parse(JSON.stringify(window.PRODUCTS || []));
  let gh = loadGh();
  let editingId = null;
  let formMedia = []; // {type, src, poster?, _file?, _preview?}
  let busy = false;

  // ---------- GitHub settings ----------
  function loadGh() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) {}
    const d = cfg.github || {};
    return {
      token: saved.token || "",
      repo: saved.repo || (d.owner && d.repo ? `${d.owner}/${d.repo}` : ""),
      branch: saved.branch || d.branch || "main",
      folder: (d.folder || "").replace(/^\/+|\/+$/g, ""),
    };
  }
  function saveGh() {
    try { localStorage.setItem(LS, JSON.stringify({ token: gh.token, repo: gh.repo, branch: gh.branch })); } catch (e) {}
  }
  const connected = () => Boolean(gh.token && gh.repo);

  $("gh-token").value = gh.token;
  $("gh-repo").value = gh.repo;
  $("gh-branch").value = gh.branch;

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  async function api(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${gh.token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!res.ok && res.status !== 404) {
      let msg = res.status + "";
      try { msg += " – " + (await res.json()).message; } catch (e) {}
      throw new Error(msg);
    }
    return res.status === 404 ? null : res.json();
  }

  const full = (path) => (gh.folder ? gh.folder + "/" : "") + path;

  async function getFile(path) {
    return api(`contents/${full(path)}?ref=${encodeURIComponent(gh.branch)}&t=${Date.now()}`);
  }

  async function putFile(path, base64, message) {
    const existing = await getFile(path);
    return api(`contents/${full(path)}`, {
      method: "PUT",
      body: JSON.stringify({ message, content: base64, branch: gh.branch, ...(existing ? { sha: existing.sha } : {}) }),
    });
  }

  function b64FromText(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function textFromB64(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function b64FromBlob(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function parseProductsJs(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    return JSON.parse(text.slice(start, end + 1));
  }
  function serializeProducts(list) {
    const clean = list.map((p) => ({
      ...p,
      media: p.media.map(({ _file, _preview, ...m }) => m),
    }));
    return "// הקובץ הזה נוצר ומתעדכן אוטומטית מעמוד הניהול (admin.html).\nwindow.PRODUCTS = " +
      JSON.stringify(clean, null, 2) + ";\n";
  }

  async function connect() {
    gh.token = $("gh-token").value.trim();
    gh.repo = $("gh-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    gh.branch = $("gh-branch").value.trim() || "main";
    saveGh();
    if (!connected()) { refreshUi(); return; }
    setStatus($("gh-status"), "מתחבר…");
    try {
      const f = await getFile("products.js");
      if (f) products = parseProductsJs(textFromB64(f.content));
      setStatus($("gh-status"), "מחובר ✓ – שמירה תעלה את השינויים ישר לאתר.", "ok");
    } catch (e) {
      setStatus($("gh-status"), "החיבור נכשל: " + e.message, "err");
    }
    refreshUi();
  }

  $("gh-connect").onclick = connect;
  $("gh-disconnect").onclick = () => {
    gh.token = ""; $("gh-token").value = ""; saveGh();
    setStatus($("gh-status"), "נותק.");
    refreshUi();
  };

  // ---------- media handling ----------
  function extOf(name, fallback) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(name || "");
    return (m ? m[1] : fallback).toLowerCase();
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Shrink large photos so the site stays fast.
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 600 * 1024) return file;
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
    } catch (e) {
      return file;
    }
  }

  async function addFiles(files) {
    for (const raw of files) {
      const isVideo = raw.type.startsWith("video/");
      const isImage = raw.type.startsWith("image/");
      if (!isVideo && !isImage) continue;
      if (isVideo && raw.size > 50 * 1024 * 1024) {
        alert(`הסרטון "${raw.name}" גדול מדי (מעל 50MB). כדאי לקצר או לכווץ אותו.`);
        continue;
      }
      const file = isImage ? await shrinkImage(raw) : raw;
      const ext = isImage ? extOf(file.name, "jpg") : extOf(raw.name, "mp4");
      formMedia.push({
        type: isVideo ? "video" : "image",
        src: `media/${uid()}.${ext}`,
        _file: file,
        _preview: URL.createObjectURL(file),
      });
    }
    renderThumbs();
  }

  const drop = $("drop");
  const fileInput = $("f-files");
  drop.onclick = () => fileInput.click();
  drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ""; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };

  function previewEl(m) {
    const src = m._preview || m.src;
    if (m.type === "video" && m.poster && !m._preview) {
      const img = document.createElement("img");
      img.src = m.poster; img.alt = "";
      return img;
    }
    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m._preview ? src : src + "#t=0.1";
      if (m.poster) v.poster = m.poster;
      v.muted = true; v.playsInline = true; v.preload = "metadata";
      return v;
    }
    const img = document.createElement("img");
    img.src = src; img.alt = "";
    return img;
  }

  function renderThumbs() {
    const box = $("thumbs");
    box.innerHTML = "";
    formMedia.forEach((m, i) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.appendChild(previewEl(m));
      if (m.type === "video") t.insertAdjacentHTML("beforeend", '<span class="tag">וידאו</span>');
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "×"; x.title = "הסרה";
      x.onclick = () => { formMedia.splice(i, 1); renderThumbs(); };
      t.appendChild(x);
      box.appendChild(t);
    });
  }

  // ---------- form ----------
  function resetForm() {
    editingId = null;
    formMedia = [];
    $("form").reset();
    $("form-title").textContent = "הוספת מוצר חדש";
    $("cancel-btn").hidden = true;
    renderThumbs();
  }

  function editProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    $("f-name").value = p.name;
    $("f-price").value = p.price;
    $("f-desc").value = p.description || "";
    formMedia = p.media.map((m) => ({ ...m }));
    $("form-title").textContent = "עריכת מוצר";
    $("cancel-btn").hidden = false;
    renderThumbs();
    $("form").scrollIntoView({ behavior: "smooth" });
  }

  $("cancel-btn").onclick = resetForm;

  $("form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = $("f-name").value.trim();
    const price = Number($("f-price").value);
    if (!name) return;
    if (!formMedia.length && !confirm("לא נוספו תמונות או סרטונים. לשמור בכל זאת?")) return;

    const product = {
      id: editingId || uid(),
      name,
      price,
      description: $("f-desc").value.trim(),
      media: formMedia,
    };
    const next = editingId
      ? products.map((p) => (p.id === editingId ? product : p))
      : [...products, product];

    const ok = await publish(next, (editingId ? "עדכון מוצר: " : "מוצר חדש: ") + name, $("save-status"));
    if (ok) resetForm();
  };

  // ---------- list ----------
  function renderList() {
    const ul = $("plist");
    ul.innerHTML = "";
    if (!products.length) {
      ul.innerHTML = '<li class="hint">עוד אין מוצרים.</li>';
    }
    products.forEach((p, i) => {
      const li = document.createElement("li");
      const pic = document.createElement("div");
      pic.className = "pic";
      if (p.media[0]) pic.appendChild(previewEl(p.media[0]));
      const info = document.createElement("div");
      info.className = "info";
      info.innerHTML = "<strong></strong><span></span>";
      info.querySelector("strong").textContent = p.name;
      info.querySelector("span").textContent = `${p.price} ₪ · ${p.media.length} קבצים`;
      const acts = document.createElement("div");
      acts.className = "acts";
      const mk = (label, cls, fn, disabled) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn small " + cls; b.textContent = label; b.onclick = fn; b.disabled = !!disabled;
        acts.appendChild(b);
      };
      mk("▲", "ghost", () => move(i, -1), i === 0);
      mk("▼", "ghost", () => move(i, 1), i === products.length - 1);
      mk("עריכה", "ghost", () => editProduct(p.id));
      mk("מחיקה", "danger", () => remove(p.id));
      li.append(pic, info, acts);
      ul.appendChild(li);
    });
  }

  async function move(i, d) {
    const next = products.slice();
    [next[i], next[i + d]] = [next[i + d], next[i]];
    await publish(next, "שינוי סדר מוצרים", $("save-status"));
  }

  async function remove(id) {
    const p = products.find((x) => x.id === id);
    if (!p || !confirm(`למחוק את "${p.name}"?`)) return;
    await publish(products.filter((x) => x.id !== id), "מחיקת מוצר: " + p.name, $("save-status"));
    if (editingId === id) resetForm();
  }

  // ---------- publish ----------
  async function publish(next, message, statusEl) {
    if (!connected()) {
      products = next;
      refreshUi();
      setStatus(statusEl, "נשמר בדפדפן. כדי לעדכן את האתר – ראו הוראות בתחתית הרשימה.", "ok");
      return true;
    }
    busy = true;
    $("save-btn").disabled = true;
    try {
      const pending = next.flatMap((p) => p.media.filter((m) => m._file));
      for (let k = 0; k < pending.length; k++) {
        setStatus(statusEl, `מעלה קובץ ${k + 1} מתוך ${pending.length}…`);
        await putFile(pending[k].src, await b64FromBlob(pending[k]._file), "העלאת מדיה: " + message);
        delete pending[k]._file; // uploaded; keep _preview for this session
      }
      setStatus(statusEl, "שומר את רשימת המוצרים…");
      await putFile("products.js", b64FromText(serializeProducts(next)), message);
      products = next;
      setStatus(statusEl, "נשמר ✓ האתר יתעדכן תוך דקה–שתיים.", "ok");
      return true;
    } catch (e) {
      setStatus(statusEl, "השמירה נכשלה: " + e.message, "err");
      return false;
    } finally {
      busy = false;
      $("save-btn").disabled = false;
      refreshUi();
    }
  }

  // ---------- offline export ----------
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $("download-btn").onclick = () =>
    download(new Blob([serializeProducts(products)], { type: "text/javascript" }), "products.js");
  $("download-media-btn").onclick = () => {
    products.flatMap((p) => p.media).filter((m) => m._file)
      .forEach((m, i) => setTimeout(() => download(m._file, m.src.split("/").pop()), i * 400));
  };

  function refreshUi() {
    $("gh-summary").textContent = connected()
      ? `מחובר ל-GitHub ✓ (${gh.repo} · ${gh.branch})`
      : "חיבור לשמירה אוטומטית (GitHub) – לא מחובר";
    const pending = products.flatMap((p) => p.media).filter((m) => m._file);
    $("offline-box").hidden = connected();
    $("pending-list").textContent = pending.length
      ? "קבצים חדשים להעתקה לתיקייה media:\n" + pending.map((m) => "• " + m.src.split("/").pop()).join("\n")
      : "";
    renderList();
  }

  if (!connected()) $("gh-box").open = true;
  refreshUi();
  if (connected()) connect();
})();
