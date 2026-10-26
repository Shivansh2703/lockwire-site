// Counts page views and button clicks: no cookies, no ids, nothing about the visitor. Off when the site has no Worker URL or the visitor asked not to be tracked.
const base = import.meta.env.PUBLIC_ASSISTANT_URL;
const off = !base || navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";

export function hit(e) {
  if (!off) navigator.sendBeacon?.(base.replace(/\/$/, "") + "/hit", JSON.stringify({ e }));
}

if (!off) {
  hit("view");
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest?.("a[href], [data-copy]");
    if (!a) return;
    if (a.hasAttribute("data-copy")) hit("copy_email");
    else if (a.href.startsWith("https://github.com/")) hit("try_free");
    else if (a.href.startsWith("mailto:") && a.href.includes("subject=48-hour")) hit("cta_check");
  });
}
