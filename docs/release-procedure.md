# v0.1 リリース手順案（案のみ。実行は家主の承認後）

**これは手順案であり、実行していません。** mainへのマージ、PR 作成、タグ作成、Netlify 設定の変更は、すべて家主の承認が必要です。まだ正式リリース済みではありません。

## 0. 前提と重要な注意
- ブラウザ内のデータ（localStorage）は**オリジン（ドメイン）単位**です。本番ドメイン（現在 `https://deft-halva-0ad17e.netlify.app/`）を変えない限り、本番ブランチを切り替えても**既存のブラウザ内データは維持されます**。プレビュー/ブランチデプロイの URL は別オリジンなので、データは共有されません。
- 切り替え・ロールバックの前に、必ず「データ管理」でバックアップをダウンロードしてください。
- データ形式はスキーマ v2。**v2 で保存したデータは、v1 時代のコード（Phase 1B 以前）では読み取り専用になります**（新しいスキーマとして上書きを拒否するため）。したがってロールバック先は Phase 1C（`f596c5a`）以降のデプロイにしてください。それより前に戻す必要がある場合は、バックアップの復元、または移行前の控え（`adc:premigration:v1`）の手動復元が必要です。
- ブランチは積み重なっています（phase0 → 1a → 1b → 1c → 1d → 1e → 1f）。`main` はまだ初期コミット（802c221）のままです。

## 1. 事前確認（家主）
1. docs/release-checklist.md の未チェック項目を確認。
2. Phase 1F のプレビューで docs/netlify-cache-verification.md の手順 4（キャッシュ確認）を実施し、結果を判断（不合格ならキャッシュ変更を戻す）。
3. docs/test-plan.md の「Phase 1E 実環境受入手順」（実施済み）と Phase 1F の確認項目。
4. 最終アプリ版のバックアップをダウンロード。

## 2. main への統合手順案
1. PR を作成（ベース `main`、比較 `feature/phase1f-final-polish`）。全フェーズの履歴を1つの PR で取り込む。
2. 統合方法: **マージコミット（Create a merge commit）を推奨**。各フェーズのコミット（家主が実環境で検証した `9e225b0` `81129ec` `f596c5a` `0824ec9` など）が履歴に残るため。スカッシュにすると履歴が1つにまとまり読みやすいが、検証済みの SHA が main の履歴に残らない。
3. PR 上で Netlify のデプロイプレビューが成功することを確認してからマージ。
4. マージ後、`main` の最新コミットを記録する。
5. 取り込み済みの feature ブランチは、リリース確認が終わるまで削除しない。

```bash
# 参考（家主の承認後。GitHub の画面で行っても同じ）
git fetch origin
git checkout main && git pull --ff-only
git merge --no-ff origin/feature/phase1f-final-polish -m "Merge AI Dev Control v0.1"
git push origin main
```

## 3. Netlify の本番ブランチを main に戻す手順案
現在の本番ブランチは、検証のため feature ブランチ（Phase 1x）に向いている想定です（**実際の設定は未確認**。管理画面で確認）。
1. 先に、`main`（マージ後）のデプロイが成功することを、ブランチデプロイまたはデプロイプレビューで確認。
2. Netlify: Site configuration → Build & deploy → Continuous deployment → Branches and deploy contexts（名称は変わり得る）で、**Production branch を `main` に変更**（家主が実施）。
3. 再デプロイを実行（Deploys → Trigger deploy）。
4. 本番 URL で確認: 画面が開く、**既存のブラウザ内データが残っている**、GitHub 手動同期が成功する、バックアップのダウンロード。
5. 環境変数（`ALLOWED_REPOS`、必要なら `GITHUB_TOKEN`）が本番コンテキストに設定されているか確認。
6. ブランチデプロイは、不要なら無効化（任意）。

## 4. リリースタグ作成手順案
1. 本番の最終確認が済んだ main のコミットにタグを付ける（例 `v0.1.0`）。
2. 注釈付きタグを推奨。

```bash
# 参考（家主の承認後）
git checkout main && git pull --ff-only
git tag -a v0.1.0 -m "AI Dev Control v0.1.0" <確認済みのmainのコミットSHA>
git push origin v0.1.0
```
3. GitHub の Releases でリリースノート（docs/release-notes-v0.1.md を基に、**確認済み・未確認の区別を維持**）を作成。
4. タグを付けるまでは「正式リリース」と記載しない。

## 5. ロールバック手順案
状況別に、データを守る順に実施します。**force push、`reset --hard` は使いません。**
1. **まずデータの保全**: 画面が開けるなら「データ管理」でバックアップをダウンロード。開けない場合はブラウザの開発者ツールで localStorage の `adc:local:v1`、`adc:local:v1:prev`、`adc:premigration:v1`、`adc:corrupt-copy:*` を控える。
2. **Netlify 側の即時ロールバック**: Deploys から、問題発生前の正常なデプロイを選び「Publish deploy」で公開に戻す（機能の有無・名称は管理画面で確認。未確認）。戻し先は Phase 1C（`f596c5a`）以降にする（データ形式 v2 のため）。
3. **キャッシュ起因の問題**（古い同期結果が返るなど）: ハンドラーのキャッシュ変更だけを戻す。`src/lib/github/handler.ts` を Phase 1E のコミット（`0824ec9`）の状態に戻す PR を作成してデプロイ。デプロイで CDN のキャッシュは破棄される（公式ドキュメント）。
4. **main の変更を取り消す**: マージコミットを `git revert -m 1 <merge-sha>` で打ち消す PR を作成（履歴を書き換えない）。
5. **タグを付けた後に問題が見つかった場合**: タグは削除せず、修正して新しいタグ（例 `v0.1.1`）を作る。削除は家主の承認が必要。
6. 復旧後、バックアップから必要に応じて復元し、整合性の警告が出ないことを確認。
