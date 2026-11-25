export const fmtDateTime = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) : '—';

export const fmtMinutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`);

/** Only https GitHub URLs are rendered as links (data comes from the network; never allow javascript: etc.). */
export const safeGithubUrl = (u: string): string | undefined => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'github.com' ? x.toString() : undefined;
  } catch { return undefined; }
};

export const ERROR_TEXT: Record<string, string> = {
  invalid_repo: 'リポジトリ名が不正です',
  not_allowed: 'このリポジトリは許可リスト外です（サーバー側の ALLOWED_REPOS を確認）',
  rate_limited: 'GitHub のレート制限に達しました',
  not_found: 'リポジトリが見つかりません（公開リポジトリのみ対応）',
  private_repo: '非公開リポジトリは対象外です',
  upstream_error: 'GitHub またはサーバーでエラーが発生しました',
  bad_response: '想定外のレスポンスを受信したため取り込みを中止しました',
  network: '通信できませんでした',
  timeout: '時間内に応答がありませんでした',
  method_not_allowed: '許可されていないメソッドです',
};
