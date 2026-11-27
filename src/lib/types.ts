export type Ws = 'real' | 'sample';

export interface Church { name: string; pastor: string; defaultServiceName: string; theology?: string; sample?: boolean }

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

export interface SummaryItem { id: string; type: string; title: string; key: string; bpm: number; memo: string; arr: string[]; slideCount: number; labels: string[]; empty: boolean; slides?: { text: string; label: string; media: string }[] }

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

export interface AppInfo { id: string; name: string; desc: string; icon: string; color: string; port: number; openPath: string; installed: boolean; running: boolean; desktop?: boolean; needsInstall?: boolean }

export type MemberStatus = 'active' | 'inactive' | 'absent' | 'moved' | 'deceased' | 'other';
export interface Member {
  id: string; name: string; gender: '' | '남' | '여'; birth: string; lunar: boolean; lunarLeap?: boolean; phone: string; address: string;
  role: string; group: string; baptism: string; baptismDate?: string; baptismPlace?: string; baptismBy?: string; registeredAt: string; status: MemberStatus; familyId: string; relation: string; memo: string;
  createdAt: number; updatedAt: number;
}
export interface Visit { id: string; memberIds: string[]; date: string; kind: string; planned: boolean; note: string; createdAt: number; updatedAt: number }
export interface People { members: Member[]; visits: Visit[]; attendance: Record<string, string[]> }

export type Fund = '일반재정' | '특별재정' | '지정재정';
export interface Tx { id: string; date: string; type: 'income' | 'expense'; fund: Fund; category: string; name: string; memberId: string; amount: number; note: string; srcId?: string; createdAt: number; updatedAt: number }
export interface FinanceSettings { categories: Record<'income' | 'expense', Record<Fund, string[]>>; receipt: { regNo: string; address: string; representative: string }; receiptOverride?: Record<string, boolean> }
/** 기부금 영수증 발급 대장: 한 번 발급한 번호는 바뀌지 않는다 */
export interface ReceiptIssue { no: number; key: string; name: string; total: number; issuedAt: number; canceled?: boolean; history: { at: number; action: 'issue' | 'reissue' | 'cancel'; total: number }[] }
export interface ReceiptBook { seq: number; items: Record<string, ReceiptIssue> }
export interface Finance { settings: FinanceSettings; tx: Tx[]; budgets: Record<string, Record<string, number>>; receipts?: Record<string, ReceiptBook> }

export interface ChurchEvent { id: string; date: string; endDate: string; time: string; title: string; kind: string; place: string; memo: string }
export interface Minutes { id: string; date: string; meeting: string; title: string; place: string; attendees: string; content: string; decisions: string; todos?: string; transcript?: string; chair: string; recorder: string; audio?: { file: string; name: string; size: number; at: number }; stt?: { at: number; model: string; seconds: number }; recording?: { startedAt: number; seq: number; bytes: number; seconds?: number; at?: number }; ai?: { at: number; via: string }; createdAt: number; updatedAt: number }
export interface Cert { id: string; no: string; type: string; date: string; purpose: string; memberId: string; snap: { name: string; gender: string; birth: string; address: string; role: string; registeredAt: string; baptism: string; baptismDate: string; baptismPlace: string; baptismBy: string }; createdAt: number }
export interface GcalCal { id: string; where: string; name: string; googleName: string; color: string; hidden: boolean; fetchedAt: number; error: string; count: number }
export interface ServeRole { id: string; name: string; count: number; pool: string[] }
export interface Serve { roles: ServeRole[]; plan: Record<string, Record<string, string[]>> }
export interface Admin { serve: Serve; events: ChurchEvent[]; minutes: Minutes[]; certs: Cert[]; meetingTypes: string[]; gcals: GcalCal[]; gcalEvents: (ChurchEvent & { cal?: string })[] }
