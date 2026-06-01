import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card, CardBlock, FeedView, WorkspaceView } from "./types";
import { useActiveCard } from "./state/activeCard";
import { usePushToTalk } from "./state/pushToTalk";

type Tab = "review" | "queued" | "working" | "done";
type Inspector = "new-feed" | "add-source" | null;
type Screen = "feed" | "workspace";
type WorkspaceTab = "feed" | "global";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Request failed: ${response.status}`);
  return value as T;
}

function post<T>(url: string, value: unknown = {}): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}

function FormattedText({ text = "" }: { text?: string }) {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s<]+|`[^`]+`|\n)/g);
  return (
    <>
      {parts.map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
        if (part === "\n") return <br key={index} />;
        if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
        return part;
      })}
    </>
  );
}

function visibleCards(feed: FeedView, tab: Tab): Card[] {
  const pass = feed.config.currentPass;
  if (tab === "review") {
    return feed.cards
      .filter((card) => (card.status === "to_review_new" || card.status === "to_review_updated") && card.readyForPass <= pass)
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === "to_review_updated" ? -1 : 1;
        return (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt);
      });
  }
  if (tab === "queued") return feed.cards.filter((card) => card.status === "queued");
  if (tab === "working") return feed.cards.filter((card) => card.status === "working");
  return feed.cards.filter((card) => card.status === "done");
}

function countFor(feed: FeedView, tab: Tab): number {
  const feedWork = tab === "queued" || tab === "working"
    ? feed.work.filter((work) => work.cardId === "__feed__" && work.status === tab).length
    : 0;
  return visibleCards(feed, tab).length + feedWork;
}

function Block({ feedId, cardId, block, onChanged }: { feedId: string; cardId: string; block: CardBlock; onChanged: () => void }) {
  const [value, setValue] = useState(block.value ?? "");
  useEffect(() => setValue(block.value ?? ""), [block.value]);

  const save = async () => {
    if (value === (block.value ?? "")) return;
    await post(`/api/feeds/${feedId}/cards/${cardId}/blocks/${block.id}`, { value });
    onChanged();
  };

  if (block.type === "editable_text") {
    return (
      <section className="block block-editor">
        {block.label && <h3>{block.label}</h3>}
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => void save()} rows={Math.max(4, value.split("\n").length + 1)} />
      </section>
    );
  }
  if (block.type === "profile" && block.profile) {
    return (
      <section className="block block-profile">
        <a className="profile-portrait" href={block.profile.href} target="_blank" rel="noreferrer" aria-label={`Open ${block.profile.name} profile`}>
          <img
            src={block.profile.imageUrl}
            alt=""
            onError={(event) => {
              if (block.profile?.fallbackImageUrl && event.currentTarget.src !== block.profile.fallbackImageUrl) {
                event.currentTarget.src = block.profile.fallbackImageUrl;
              }
            }}
          />
        </a>
        <div className="profile-copy">
          <a className="profile-name" href={block.profile.href} target="_blank" rel="noreferrer">{block.profile.name}</a>
          {block.profile.subtitle && <span className="profile-subtitle">{block.profile.subtitle}</span>}
          {block.profile.links && (
            <div className="profile-links">
              {block.profile.links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>)}
            </div>
          )}
        </div>
      </section>
    );
  }
  if (block.type === "evidence") {
    return (
      <section className="block block-evidence">
        {block.label && <h3>{block.label}</h3>}
        <ul>{block.items?.map((item, index) => <li key={index}>{typeof item === "string" ? item : item.label}</li>)}</ul>
      </section>
    );
  }
  if (block.type === "checklist") {
    return (
      <section className="block block-checklist">
        {block.label && <h3>{block.label}</h3>}
        <ul>{block.items?.map((item, index) => <li key={index}><span className="checkmark">○</span>{typeof item === "string" ? item : item.label}</li>)}</ul>
      </section>
    );
  }
  if (block.type === "options") {
    return (
      <section className="block block-options">
        {block.label && <h3>{block.label}</h3>}
        {block.items?.map((item, index) => typeof item === "string"
          ? <div className="option" key={index}>{item}</div>
          : <div className="option" key={index}><b>{item.label}</b>{item.detail && <span>{item.detail}</span>}</div>)}
      </section>
    );
  }
  if (block.type === "diff") {
    return (
      <section className="block block-diff">
        {block.label && <h3>{block.label}</h3>}
        <div className="diff-before">{block.before}</div>
        <div className="diff-after">{block.after}</div>
      </section>
    );
  }
  if (block.type === "clarification") {
    return <section className="block block-clarification"><h3>{block.label ?? "Needs your input"}</h3><p><FormattedText text={block.text} /></p></section>;
  }
  if (block.type === "receipt") {
    return <section className="block block-receipt"><h3>{block.label ?? "Done"}</h3><p><FormattedText text={block.text} /></p></section>;
  }
  return <section className={`block block-${block.type}`}>{block.label && <h3>{block.label}</h3>}<p><FormattedText text={block.text} /></p></section>;
}

function CardView({
  card,
  active,
  onActivate,
  onChanged,
  onApprove,
  onDismiss,
}: {
  card: Card;
  active: boolean;
  onActivate: () => void;
  onChanged: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  return (
    <article className={`attention-card ${active ? "is-active" : ""}`} data-card-id={card.id} onClick={onActivate} onMouseEnter={onActivate}>
      <div className="card-rule" />
      <header className="card-head">
        <span className={`kind-dot ${card.kind === "feed_improvement" ? "proposal" : ""}`} />
        <div>
          <div className="eyebrow">{card.eyebrow}</div>
          <h2>{card.title}</h2>
        </div>
      </header>
      <p className="why">{card.why}</p>
      <div className="blocks">
        {card.blocks.map((block) => <Block key={block.id} feedId={card.feedId} cardId={card.id} block={block} onChanged={onChanged} />)}
      </div>
      {card.proposedAction && (card.status === "to_review_new" || card.status === "to_review_updated") && (
        <footer className="card-action">
          <div>
            <span className="action-label">Proposed next move</span>
            <b>{card.proposedAction.label}</b>
          </div>
          <div className="action-buttons">
            <button className="button ghost" onClick={(event) => { event.stopPropagation(); onDismiss(); }}>Dismiss <kbd>X</kbd></button>
            <button className="button primary" onClick={(event) => { event.stopPropagation(); onApprove(); }}>Approve <kbd>A</kbd></button>
          </div>
        </footer>
      )}
    </article>
  );
}

function TopBar({ state, onFeed, onInspector, onWorkspace }: { state: WorkspaceView; onFeed: (id: string) => void; onInspector: (value: Inspector) => void; onWorkspace: (tab?: WorkspaceTab) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <>
      <div className="feed-bar" ref={menuRef}>
        <button className="menu-trigger" onClick={() => setOpen(!open)} aria-label="Open feed navigation">☰</button>
        <strong>{state.active.config.name}</strong>
        {open && (
          <div className="feed-menu">
            <div className="menu-title">Feeds</div>
            {state.feeds.map((feed) => (
              <button key={feed.id} className={feed.id === state.active.config.id ? "selected" : ""} onClick={() => { onFeed(feed.id); setOpen(false); }}>
                <span>{feed.name}</span><small>{feed.purpose}</small>
              </button>
            ))}
            <div className="menu-rule" />
            <button onClick={() => { onInspector("new-feed"); setOpen(false); }}>＋ Create a feed</button>
            <button onClick={() => { onInspector("add-source"); setOpen(false); }}>＋ Add a source</button>
            <button onClick={() => { onWorkspace("feed"); setOpen(false); }}>⌘ Feed setup</button>
            <button onClick={() => { onWorkspace("global"); setOpen(false); }}>⌘ Global prompts</button>
          </div>
        )}
      </div>
    </>
  );
}

function WorkspaceEditor({ label, content, onSave }: { label: string; content: string; onSave: (content: string) => Promise<unknown> }) {
  const [value, setValue] = useState(content);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(content), [content]);
  const changed = value.trimEnd() !== content.trimEnd();
  return (
    <section className="workspace-editor">
      <div className="workspace-editor-head">
        <h3>{label}</h3>
        <button className="button ghost" disabled={!changed || saving} onClick={() => void (async () => {
          setSaving(true);
          try {
            await onSave(value);
          } catch {
            // The workspace surfaces the API error in its toast.
          } finally {
            setSaving(false);
          }
        })()}>{saving ? "Saving…" : "Save"}</button>
      </div>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={Math.max(7, Math.min(20, value.split("\n").length + 2))} />
    </section>
  );
}

function PromptWorkspace({ state, tab, onTab, onBack, onInspector, onSaved }: { state: WorkspaceView; tab: WorkspaceTab; onTab: (tab: WorkspaceTab) => void; onBack: () => void; onInspector: (value: Inspector) => void; onSaved: (message: string) => void }) {
  const [feedWorkspace, setFeedWorkspace] = useState<any>(null);
  const [globalWorkspace, setGlobalWorkspace] = useState<any>(null);
  const feedId = state.active.config.id;
  const reloadFeed = useCallback(async () => setFeedWorkspace(await api(`/api/feeds/${feedId}/how`)), [feedId]);
  const reloadGlobal = useCallback(async () => setGlobalWorkspace(await api("/api/global-prompts")), []);
  useEffect(() => { void reloadFeed(); }, [reloadFeed]);
  useEffect(() => { if (tab === "global") void reloadGlobal(); }, [reloadGlobal, tab]);
  const save = async (callback: () => Promise<unknown>, message: string, reload: () => Promise<void>) => {
    try {
      await callback();
      await reload();
      onSaved(message);
    } catch (error) {
      onSaved(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  return (
    <main className="workspace-page">
      <button className="workspace-back" onClick={onBack}>← Back to feed</button>
      <div className="workspace-title">
        <div>
          <div className="panel-kicker">Prompts & sources</div>
          <h1>{tab === "feed" ? `${state.active.config.name} setup` : "Global prompts"}</h1>
        </div>
        {tab === "feed" && <button className="button ghost" onClick={() => onInspector("add-source")}>＋ Add a source</button>}
      </div>
      <nav className="workspace-tabs">
        <button className={tab === "feed" ? "active" : ""} onClick={() => onTab("feed")}>This feed</button>
        <button className={tab === "global" ? "active" : ""} onClick={() => onTab("global")}>Global prompts</button>
      </nav>
      {tab === "feed" ? !feedWorkspace ? <p>Loading feed setup…</p> : (
        <div className="workspace-stack">
          <WorkspaceEditor label="Feed policy" content={feedWorkspace.policy} onSave={(content) => save(() => post(`/api/feeds/${feedId}/policy`, { content }), "Feed policy saved", reloadFeed)} />
          <section className="workspace-section">
            <div className="workspace-section-head"><h2>Source recipes</h2><span>{feedWorkspace.sources.length}</span></div>
            {feedWorkspace.sources.map((source: any) => <WorkspaceEditor key={source.id} label={source.name} content={source.content} onSave={(content) => save(() => post(`/api/feeds/${feedId}/sources/${encodeURIComponent(source.id)}`, { content }), "Source recipe saved", reloadFeed)} />)}
          </section>
          <section className="workspace-section">
            <h2>Home thread</h2>
            <pre>{JSON.stringify(feedWorkspace.thread, null, 2)}</pre>
          </section>
        </div>
      ) : !globalWorkspace ? <p>Loading global prompts…</p> : (
        <div className="workspace-stack">
          <WorkspaceEditor label="Global policy" content={globalWorkspace.globalPolicy} onSave={(content) => save(() => post("/api/global-policy", { content }), "Global policy saved", reloadGlobal)} />
          <section className="workspace-section">
            <div className="workspace-section-head"><h2>Prompt layers</h2><span>{globalWorkspace.prompts.length}</span></div>
            {globalWorkspace.prompts.map((prompt: any) => <WorkspaceEditor key={prompt.name} label={prompt.name} content={prompt.content} onSave={(content) => save(() => post(`/api/global-prompts/${encodeURIComponent(prompt.name)}`, { content }), "Global prompt saved", reloadGlobal)} />)}
          </section>
        </div>
      )}
    </main>
  );
}

function InspectorPanel({ value, state, onClose, onChanged }: { value: Inspector; state: WorkspaceView; onClose: () => void; onChanged: (feed?: string) => void }) {
  const [text, setText] = useState("");
  const feedId = state.active.config.id;

  useEffect(() => {
    setText("");
  }, [value, feedId]);

  if (!value) return null;
  const create = value === "new-feed";
  const submit = async () => {
    if (!text.trim()) return;
    if (create) {
      const config = await post<any>("/api/feeds", { brief: text });
      onChanged(config.id);
    } else {
      await post(`/api/feeds/${feedId}/sources`, { brief: text });
      onChanged();
    }
    onClose();
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <section className="inspector setup-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <div className="panel-kicker">{create ? "New feed" : "New source"}</div>
        <h2>{create ? "What should this feed notice?" : "What else should this feed pay attention to?"}</h2>
        <p>Describe it naturally. Codex can refine the recipe with you in the feed thread.</p>
        <textarea autoFocus rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder={create ? "Track the models I am actually using and show me meaningful changes in where each one is winning…" : "Also look at the product planning Slack channel and pull in decisions or unresolved questions that affect Q3…"} />
        <button className="button primary large" onClick={() => void submit()}>{create ? "Create feed" : "Add source"}</button>
      </section>
    </div>
  );
}

function Dock({ feed, card, onSubmit, dictation }: { feed: FeedView; card?: Card; onSubmit: (instruction: string) => void; dictation: WorkspaceView["dictation"] }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    const instruction = inputRef.current?.value.trim();
    if (!instruction) return;
    onSubmit(instruction);
    setValue("");
  };
  const { isPushingToTalk } = usePushToTalk(inputRef, submit, dictation.activationCode);
  return (
    <div className="dock">
      <form className="dock-inner" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="dock-context"><span>{isPushingToTalk ? "Listening to" : "Speaking to"}</span><b>{card?.title ?? feed.config.name}</b></div>
        <div className="dock-row">
          <textarea ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={1} placeholder={card ? "Tell Codex what to do with this card…" : "Tell Codex what to do with this feed…"} />
          <button className="button primary" type="submit">Send</button>
        </div>
        <div className="dock-hints"><kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>X</kbd> dismiss · hold <kbd>{dictation.activationLabel}</kbd> to dictate · <kbd>Enter</kbd> send</div>
      </form>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<WorkspaceView | null>(null);
  const [feedId, setFeedId] = useState(new URLSearchParams(location.search).get("feed") ?? "inbox");
  const [screen, setScreen] = useState<Screen>(new URLSearchParams(location.search).get("screen") === "workspace" ? "workspace" : "feed");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(new URLSearchParams(location.search).get("workspace") === "global" ? "global" : "feed");
  const [tab, setTab] = useState<Tab>("review");
  const [inspector, setInspector] = useState<Inspector>(null);
  const [toast, setToast] = useState("");
  const [undoCleanup, setUndoCleanup] = useState<{ feedId: string; cardId: string } | null>(null);
  const [undoQueuedWork, setUndoQueuedWork] = useState<{ feedId: string; workId: string } | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async (nextFeed = feedId) => setState(await api(`/api/state?feed=${encodeURIComponent(nextFeed)}`)), [feedId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("change", () => void refresh());
    return () => events.close();
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 1_200);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const feed = state?.active;
  const cards = useMemo(() => feed ? visibleCards(feed, tab) : [], [feed, tab]);
  const cardIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const { activeCardId, setActiveCardId, navTo } = useActiveCard(pageRef, cardIds);
  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];

  const changeFeed = (id: string) => {
    setFeedId(id);
    setTab("review");
    const url = new URL(location.href);
    url.searchParams.set("feed", id);
    history.replaceState({}, "", url);
  };

  const openWorkspace = (nextTab: WorkspaceTab = "feed") => {
    setWorkspaceTab(nextTab);
    setScreen("workspace");
    const url = new URL(location.href);
    url.searchParams.set("screen", "workspace");
    url.searchParams.set("workspace", nextTab);
    history.replaceState({}, "", url);
  };

  const closeWorkspace = () => {
    setScreen("feed");
    const url = new URL(location.href);
    url.searchParams.delete("screen");
    url.searchParams.delete("workspace");
    history.replaceState({}, "", url);
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const withRefresh = async (callback: () => Promise<unknown>, message: string) => {
    try {
      await callback();
      showToast(message);
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  };

  const instruct = (instruction: string) => {
    if (!feed) return;
    const url = activeCard
      ? `/api/feeds/${feed.config.id}/cards/${activeCard.id}/instructions`
      : `/api/feeds/${feed.config.id}/instructions`;
    void (async () => {
      try {
        const work = await post<{ id: string }>(url, { instruction });
        const queued = { feedId: feed.config.id, workId: work.id };
        setUndoQueuedWork(queued);
        window.setTimeout(() => setUndoQueuedWork((current) => current?.workId === queued.workId ? null : current), 5_000);
        showToast("Queued for Codex");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error));
      }
    })();
  };
  const approve = (card = activeCard) => card && feed && void withRefresh(() => post(`/api/feeds/${feed.config.id}/cards/${card.id}/approve`), "Approved and queued for Codex");
  const dismiss = (card = activeCard) => {
    if (!card || !feed) return;
    const cleanup = { feedId: feed.config.id, cardId: card.id };
    void (async () => {
      try {
        await post(`/api/feeds/${feed.config.id}/cards/${card.id}/dismiss`);
        setUndoCleanup(cleanup);
        window.setTimeout(() => setUndoCleanup((current) => current?.cardId === cleanup.cardId ? null : current), 5_000);
        showToast("Cleanup queued for Codex");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "j") navTo(1);
      if (event.key.toLowerCase() === "k") navTo(-1);
      if (event.key.toLowerCase() === "a") approve();
      if (event.key.toLowerCase() === "x") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!state || !feed) return <main className="loading">Loading attention…</main>;

  if (screen === "workspace") return (
    <>
      <TopBar state={state} onFeed={changeFeed} onInspector={setInspector} onWorkspace={openWorkspace} />
      <PromptWorkspace state={state} tab={workspaceTab} onTab={(nextTab) => { setWorkspaceTab(nextTab); const url = new URL(location.href); url.searchParams.set("workspace", nextTab); history.replaceState({}, "", url); }} onBack={closeWorkspace} onInspector={setInspector} onSaved={showToast} />
      <InspectorPanel value={inspector} state={state} onClose={() => setInspector(null)} onChanged={(next) => { if (next) changeFeed(next); void refresh(next); }} />
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  const updated = cards.filter((card) => card.status === "to_review_updated");
  const fresh = cards.filter((card) => card.status !== "to_review_updated");
  const feedWork = feed.work.filter((work) => work.cardId === "__feed__" && work.status === tab);
  return (
    <>
      <TopBar state={state} onFeed={changeFeed} onInspector={setInspector} onWorkspace={openWorkspace} />
      <nav className="tabs">
        {(["review", "queued", "working", "done"] as Tab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "review" ? "To review" : item === "queued" ? "Queued for Codex" : item === "working" ? "Working" : "Done"}
            <span>{countFor(feed, item)}</span>
          </button>
        ))}
        <button className="tab-quiet" onClick={() => openWorkspace("feed")}>Prompts & sources</button>
      </nav>
      <main className="page" ref={pageRef}>
        {tab === "review" && updated.length > 0 && <div className="section-label">Updated for review <span>{updated.length}</span></div>}
        {cards.map((card, index) => (
          <>
            {tab === "review" && index === updated.length && fresh.length > 0 && <div className="section-label" key={`${card.id}-label`}>New <span>{fresh.length}</span></div>}
            <CardView key={card.id} card={card} active={card.id === activeCard?.id} onActivate={() => setActiveCardId(card.id)} onChanged={() => void refresh()} onApprove={() => approve(card)} onDismiss={() => dismiss(card)} />
          </>
        ))}
        {feedWork.map((work) => (
          <article className="attention-card feed-work-card" key={work.id}>
            <div className="card-rule" />
            <header className="card-head">
              <span className="kind-dot proposal" />
              <div><div className="eyebrow">Feed instruction · {work.status}</div><h2>{work.instruction}</h2></div>
            </header>
            <p className="why">{work.status === "queued" ? "Ready for the home Codex thread to drain." : "The home Codex thread is working through this feed-level instruction."}</p>
          </article>
        ))}
        {!cards.length && !feedWork.length && <div className="empty"><h2>Nothing here right now.</h2><p>{tab === "review" ? "A quiet feed is allowed. Wake the feed thread when you want Codex to collect or drain pending work." : "Move back to To review when you are ready for the next pass."}</p></div>}
        <section className={`end-cap ${feed.readyNextPass ? "" : "actions-only"}`}>
          {feed.readyNextPass > 0 && <div>
            <span>End of this pass</span>
            <h2>{`${feed.readyNextPass} updated card${feed.readyNextPass === 1 ? "" : "s"} ready when you are.`}</h2>
          </div>}
          <div className="end-actions">
            {feed.readyNextPass > 0 && <button className="button primary" onClick={() => void withRefresh(() => post(`/api/feeds/${feed.config.id}/next-pass`), "Started the next pass")}>Review ready cards</button>}
            <button className="button ghost" onClick={() => void withRefresh(() => post(`/api/feeds/${feed.config.id}/compound`), "Learning pass queued for Codex")}>Compound learnings</button>
          </div>
        </section>
      </main>
      <Dock feed={feed} card={activeCard} onSubmit={instruct} dictation={state.dictation} />
      <InspectorPanel value={inspector} state={state} onClose={() => setInspector(null)} onChanged={(next) => { if (next) changeFeed(next); void refresh(next); }} />
      {toast && <div className="toast">{toast}{undoCleanup && <button onClick={() => void withRefresh(() => post(`/api/feeds/${undoCleanup.feedId}/cards/${undoCleanup.cardId}/undo-dismiss`), "Cleanup undone").then(() => setUndoCleanup(null))}>Undo</button>}{undoQueuedWork && <button onClick={() => void withRefresh(() => post(`/api/feeds/${undoQueuedWork.feedId}/work/${undoQueuedWork.workId}/cancel`), "Instruction cancelled").then(() => setUndoQueuedWork(null))}>Undo</button>}</div>}
    </>
  );
}
