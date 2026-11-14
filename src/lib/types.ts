export type Ws = 'real' | 'sample';

export interface Church { name: string; pastor: string; defaultServiceName: string; sample?: boolean }

export interface Snapshot {
  serviceId: string; name: string; date: string; itemIds: string[];
  items: { id: string; type: string; title: string; key: string; arr: string[]; memo: string; slides: { id: string; text: string; label?: string }[] }[];
}

export interface Week {
  id: string; date: string; name: string; passage: string; sermonTitle: string; announcements: string[];
  sermonNotes: string; sermonVideoUrl: string; prayerLeader: string;
  wc: { serviceId: string; links: { passage: string | null; title: string | null; notice: string | null; prayer?: string | null } } | null;
  final: { at: number; snap: Snapshot } | null;
  copiedFrom: string | null; createdAt: number; updatedAt: number;
  recs?: Recs | null;
}

export interface Rec { title: string; artist: string; type: string; reason: string; mood: string; era: string; youtubeUrl: string; sheetMusicUrl: string }
export interface Recs { at: number; sample: boolean; basis: string; theme: string; keyMessage: string; items: Rec[]; sources: { uri: string; title: string }[] }
export interface PraiseFlowStatus { sample?: boolean; running: boolean; ready: boolean | null; providerLabel?: string; installed?: boolean }

export interface SummaryItem { id: string; type: string; title: string; key: string; bpm: number; memo: string; arr: string[]; slideCount: number; labels: string[]; empty: boolean }

export interface WeekStatus {
  linked: boolean; connected: boolean | null; missing?: boolean; error?: string;
  summary?: {
    id: string; name: string; date: string; note: string; isCurrent: boolean; items: SummaryItem[]; songCount: number;
    songsWithoutLyrics: string[]; songsWithoutKey: string[]; placeholders: { itemId: string; title: string; text: string }[]; slideTotal: number;
  };
  final?: { state: 'none' | 'same' | 'changed'; at?: number; changes?: string[] };
}

export interface Overview {
  church: Church | null; weeks: Week[]; sample: boolean; settings: { wcUrl: string };
  wc: { ok: boolean; offline?: boolean; error?: string; services?: { id: string; name: string; date: string; count: number }[]; currentServiceId?: string };
}

export interface SyncResult { ok: boolean; offline?: boolean; error?: string; done?: string[]; skipped?: boolean }

export interface Song {
  id: string; type: string; title: string; key: string; arr: string[]; memo: string; labels: string[]; lyrics: string;
  slideCount: number; lastUsed: string | null; meta: { writer?: string; source?: string; distinguish?: string };
}

export interface AppInfo { id: string; name: string; desc: string; icon: string; color: string; port: number; openPath: string; installed: boolean; running: boolean }
