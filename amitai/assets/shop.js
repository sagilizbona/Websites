(function () {
  const cfg = window.SITE_CONFIG || {};
  const products = window.PRODUCTS || [];

  const $ = (id) => document.getElementById(id);
  $("shop-name").textContent = cfg.shopName || "";
  $("shop-tagline").textContent = cfg.tagline || "";
  $("footer-name").textContent = cfg.shopName || "";
  $("year").textContent = new Date().getFullYear();
  document.title = (cfg.shopName || "") + " – מוצרים בהדפסת תלת־ממד";

  const contact = [];
  if (cfg.whatsapp) contact.push(`<a href="https://wa.me/${cfg.whatsapp}" target="_blank" rel="noopener">וואטסאפ</a>`);
  if (cfg.email) contact.push(`<a href="mailto:${cfg.email}">${cfg.email}</a>`);
  $("footer-contact").innerHTML = contact.length ? "לשאלות והזמנות: " + contact.join(" · ") : "";

  const fmtPrice = (p) => (p === "" || p == null ? "" : Number(p).toLocaleString("he-IL") + " ₪");

  function orderLink(p) {
    const text = `היי, אני מעוניין/ת להזמין: ${p.name} (${fmtPrice(p.price)})`;
    const num = cfg.whatsapp ? cfg.whatsapp : "";
    return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  }

  function mediaEl(m) {
    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m.src;
      if (m.poster) v.poster = m.poster;
      v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.setAttribute("playsinline", ""); v.preload = "metadata";
      return v;
    }
    const img = document.createElement("img");
    img.src = m.src; img.alt = ""; img.loading = "lazy";
    return img;
  }

  function gallery(p) {
    const box = document.createElement("div");
    box.className = "media";
    const items = p.media && p.media.length ? p.media : [];
    let i = 0;
    let current = null;
    const dots = document.createElement("div");
    dots.className = "dots";

    function show(n) {
      if (!items.length) return;
      i = (n + items.length) % items.length;
      if (current) current.remove();
      current = mediaEl(items[i]);
      current.alt = p.name;
      box.prepend(current);
      [...dots.children].forEach((d, k) => d.classList.toggle("on", k === i));
    }

    if (items.length > 1) {
      items.forEach(() => dots.appendChild(document.createElement("span")));
      const prev = Object.assign(document.createElement("button"), { className: "nav prev", innerHTML: "&#8250;", ariaLabel: "הקודם" });
      const next = Object.assign(document.createElement("button"), { className: "nav next", innerHTML: "&#8249;", ariaLabel: "הבא" });
      prev.onclick = () => show(i - 1);
      next.onclick = () => show(i + 1);
      box.append(prev, next, dots);

      let x0 = null;
      box.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
      box.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) show(dx > 0 ? i + 1 : i - 1);
        x0 = null;
      });
    }
    show(0);
    return box;
  }

  const grid = $("grid");
  if (!products.length) {
    grid.outerHTML = '<p class="empty">עוד אין מוצרים. מוסיפים מוצרים מעמוד הניהול.</p>';
    return;
  }

  products.forEach((p) => {
    const card = document.createElement("article");
    card.className = "card";
    card.appendChild(gallery(p));

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="card-top"><h2></h2><span class="price"></span></div>
      <p class="desc"></p>
      <a class="btn" target="_blank" rel="noopener">להזמנה בוואטסאפ</a>`;
    body.querySelector("h2").textContent = p.name;
    body.querySelector(".price").textContent = fmtPrice(p.price);
    body.querySelector(".desc").textContent = p.description || "";
    body.querySelector("a").href = orderLink(p);
    card.appendChild(body);
    grid.appendChild(card);
  });
})();
