// ページをまたいで、編集中のキャラクターを受け渡す（ブラウザのセッションストレージ）。
//
// Creator UI は 3 つのページ（index.html → customize.html → export.html）に分かれている。
// 正本は Character 1 個のままで、ここはそれをページ間で運ぶだけである。
// 変更のたびに保存 JSON の形で書き、ページを開いたときに読み直す。別の形の写しは持たない。
// タブを閉じると消える（保存はあくまで「保存」ボタンでファイルにする）。

const KEY = 'investimaker.session.v1';

export interface StoredUi {
  major?: string;
  sub?: Record<string, string>;
  /** 編集対象。Instance の ID、または 'expression' / 'pose'。 */
  target?: string | null;
  advancedOpen?: boolean;
  alwaysAdvanced?: boolean;
  recentColors?: string[];
  /** 【検証用】通知の置き場所。 */
  notices?: string;
}

export interface Stored {
  /** 編集中のキャラクター（保存 JSON の文字列）。まだなければ null。 */
  character: string | null;
  /** 最後に保存・読込した時点の内容（保存していない変更の判定用）。 */
  savedSnapshot: string | null;
  ui: StoredUi;
  /** 次のページで 1 回だけ出す知らせ。 */
  flash: string | null;
}

const EMPTY: Stored = { character: null, savedSnapshot: null, ui: {}, flash: null };

export function readStore(): Stored {
  try {
    const text = sessionStorage.getItem(KEY);
    return text ? { ...EMPTY, ...(JSON.parse(text) as Partial<Stored>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** 書けたかどうかを返す（ストレージが使えない環境では false）。 */
export function writeStore(stored: Stored): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
