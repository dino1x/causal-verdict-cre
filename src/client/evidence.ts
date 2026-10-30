// Evidence providers for the browser: scenario fixtures, or real feeds (live via /api/feeds, else the bundled capture).
import type { EvidenceProvider, Fixtures, FeedSource } from "../engine/pipeline";
import type { KolPost, KolVoice } from "../data/scenarioFixtures";
import feedJson from "../data/feedSnapshots.json";

export type EvidenceMode = "scenario" | "real";
export const FEED_SNAPSHOT = feedJson as unknown as Fixtures & { referenceTime: string; captured_at: string; channels: string[]; sources: FeedSource[]; bundle_sha256: string };

/** Posts the user pasted are labelled user-supplied and get a neutral voice weight. */
function userVoices(posts: KolPost[]): KolVoice[] {
  return [...new Set(posts.map((p) => p.handle))].map((handle) => ({ handle, channel: posts.find((p) => p.handle === handle)!.channel, followers: null, weight: 0.5 }));
}

function merge(base: Fixtures, userPosts: KolPost[], sources: FeedSource[]): { fixtures: Fixtures; sources: FeedSource[] } {
  if (!userPosts.length) return { fixtures: base, sources };
  return {
    fixtures: { ...base, posts: [...base.posts, ...userPosts], voices: [...base.voices, ...userVoices(userPosts).filter((v) => !base.voices.some((b) => b.handle === v.handle))] },
    sources: [...sources, { feed: "user", target: "pasted posts", ok: true, items: userPosts.length, detail: "supplied by the user in the Causality tab" }],
  };
}

export function realFeedProvider(live: boolean, userPosts: KolPost[], channels: string[]): EvidenceProvider {
  return async (tokens, referenceTime) => {
    const fromSnapshot = (why: string) => {
      const same = FEED_SNAPSHOT.referenceTime === referenceTime;
      const base: Fixtures = same ? FEED_SNAPSHOT : { voices: [], posts: [], whales: [], news: [] };
      const src: FeedSource[] = same
        ? FEED_SNAPSHOT.sources.map((s) => ({ ...s, detail: `${s.detail} [captured ${FEED_SNAPSHOT.captured_at}; ${why}]` }))
        : [{ feed: "onchain", target: "all feeds", ok: false, items: 0, detail: `${why}; bundled feed capture is for ${FEED_SNAPSHOT.referenceTime}, this run is ${referenceTime} — evidence unavailable, not invented` }];
      return { mode: "real" as const, ...merge(base, userPosts, src) };
    };
    if (!live) return fromSnapshot("replay mode");
    try {
      const r = await fetch("/api/feeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens, referenceTime, channels }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b = await r.json();
      return { mode: "real" as const, ...merge(b, userPosts, b.sources) };
    } catch (e) {
      return fromSnapshot(`feed proxy unreachable (${(e as Error).message})`);
    }
  };
}
