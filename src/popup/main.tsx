// Toolbar popup: the current site's status, what's on right now, and a link to settings.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { hostFromUrl } from "../core/hosts";
import { systemZone } from "../core/time";
import { originalFromBlockUrl } from "../shared/blockUrl";
import { ColorDot, Pill } from "../ui/components";
import { useAppState, useNow } from "../ui/hooks";
import { siteStatus } from "../ui/siteStatus";
import { headerSubtitle, stateLabel, statusOf } from "../ui/status";

const optionsUrl = (route = "/") => chrome.runtime.getURL(`options/options.html#${route}`);
const open = (route?: string) => {
  void chrome.tabs.create({ url: optionsUrl(route) });
  window.close();
};

function useCurrentHost(): string | null {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const url = tab?.pendingUrl || tab?.url || "";
      const blocked = originalFromBlockUrl(chrome.runtime.getURL("block/block.html"), url);
      setHost(hostFromUrl(blocked ?? url));
    });
  }, []);
  return host;
}

function Popup() {
  const state = useAppState();
  const now = useNow(5000);
  const host = useCurrentHost();
  if (!state) return null;
  const zone = systemZone();
  const statuses = state.sets.map((set) => ({ set, status: statusOf(set, state, now, zone) }));
  const on = statuses.filter(({ status }) => status.state === "active" || status.state === "paused");
  const site = host ? siteStatus(host, state, now, zone) : null;

  return (
    <div class="popup">
      <div>
        <h1>Night Blocker</h1>
        <p class="hint">{headerSubtitle(state.sets.length, statuses.filter((s) => s.status.state === "active").length)}</p>
      </div>
      {host && site && (
        <section class="card">
          <div class="row"><span class="site grow">{host}</span><span class="pill" style={{ "--c": "var(--primary)" }}>{site.headline}</span></div>
          {site.detail && <p class="small" style={{ whiteSpace: "pre-line" }}>{site.detail}</p>}
          {site.sets.length > 0 && <p class="hint">In: {site.sets.join(", ")}</p>}
        </section>
      )}
      {on.length > 0 && (
        <div>
          {on.map(({ set, status }) => (
            <button type="button" class="set-row" onClick={() => open(`/set/${encodeURIComponent(set.id)}`)}>
              <ColorDot color={set.color} size={12} />
              <span class="grow">{set.name}<br /><span class="hint">{status.text}</span></span>
              <Pill text={stateLabel(status.state, set.mode)} color={`var(--state-${status.state})`} />
            </button>
          ))}
        </div>
      )}
      <button type="button" class="primary wide" onClick={() => open()}>Open settings</button>
    </div>
  );
}

render(<Popup />, document.getElementById("root")!);
