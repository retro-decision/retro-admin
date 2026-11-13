# Retro 命運酒館｜管理後台

獨立網頁後台，用瀏覽器登入即可管理命運酒館。不必先打開手機 App。

- 正式專案：現有 Supabase `hrqxdfwuucrknqznrpse`（沿用，沒有另開專案）
- 預設 Pages 網址：https://retro-decision.github.io/retro-admin/
- 前端只用 anon / publishable key，授權靠 RLS 與 `is_admin()`。**絕對不要把 `service_role` 放進這個 repo、環境變數範例或前端。**

## 功能

- Google 登入。只有 `help_admins` / `is_admin()` 為 true 的帳戶可以進入。
- 非管理員只會看到拒絕頁，不會看到任何檢舉、帖文或封鎖資料。
- 檢舉列表：未處理／全部、標為已處理、永久刪帖。
- 全部帖文：瀏覽命運酒館所有帖文（最新優先，可載入更多），以標題／內文搜尋，並可按語言區、狀態篩選。詳情可見完整內文、圖片、投票選項，以及該帖全部留言（含回覆串）。管理員會看到真實作者／留言者顯示名稱與用戶 ID（即使匿稱發文或留言者是發問者）；可用此 ID 封鎖。可永久刪帖、封鎖作者、刪除單一留言或封鎖留言者。刪留言只刪該則，不會刪帖；該則的回覆會保留並變成獨立留言（`parent_id` 為 ON DELETE SET NULL）。
- 永久刪帖沿用現有管理員刪帖：對 `help_posts` 做 DELETE，既有 FK CASCADE 會清掉選項、投票、留言、乾杯、追蹤、通知與相關檢舉。刪前需確認。
- 封鎖／解鎖帳戶（表 `account_blocks`）。封鎖時須選擇禁言時長：1、3、7、10、30、90、365 天或永久。封鎖後該用戶在時限內不能再發帖、留言、投票、乾杯、追蹤或檢舉（資料庫 RLS + trigger 強制）。不會禁止登入，也不會刪除個人決定或雲端備份。到期後會自動解除；管理員亦可提早解鎖。名單與操作紀錄都在「封鎖帳戶」頁，並顯示禁言時長、到期時間（香港時間）與狀態（封鎖中／已到期／已解鎖）。

## 本機啟動

```bash
npm install
cp .env.example .env   # 可省略：程式內已有同一個公開 anon key 作為後備
npm run dev
```

瀏覽器打開 http://localhost:5173/ 。先完成下方「營運尚須完成的步驟」，否則登入後會被拒絕，或 OAuth 會因 redirect URL 未加入 allowlist 而失敗。

```bash
npm run build    # 會跑 TypeScript 檢查
npm run preview  # 預覽 production build（路徑為 /retro-admin/）
```

## 資料庫 migration

檔案：

- `supabase/migrations/20261113093908_account_blocks_and_tavern_enforcement.sql`（封鎖帳戶與酒館寫入強制）
- `supabase/migrations/20261113104500_help_comments_delete_admin.sql`（管理員可刪單一留言：`help_comments_delete_admin`，條件為 `is_admin()`）
- `supabase/migrations/20261113124600_account_blocks_timed_mutes.sql`（禁言時長、到期時間、自動到期解除，以及 `public.my_tavern_mute()`）

請由營運在正式專案（`hrqxdfwuucrknqznrpse`）用 SQL Editor 整份執行尚未套用的檔案，或用你慣用的 CLI。**不要把 `service_role` 放進這個前端。** 套用後不會自動加入管理員。

重點：

- 表 `public.account_blocks`（`user_id`, `blocked_at`, `blocked_by`, `reason`, `duration_days`, `expires_at`, `unblocked_at`, `unblocked_by`, `unblock_reason`）。`duration_days` 只允許 1、3、7、10、30、90、365；兩者皆為 NULL 代表永久。`expires_at` 由資料庫依 `blocked_at + duration_days` 寫入，避免客戶端時鐘誤差。解鎖是標示解除，列會保留作為紀錄。同一用戶同時只能有一筆未解鎖列；插入新封鎖前會先把已到期但尚未標記的列標為 `unblock_reason = expired`。有效封鎖 = `unblocked_at` 為空且（`expires_at` 為空或仍未到期）。
- `private.is_account_blocked(uuid)`、`private.enforce_tavern_not_blocked()`、`private.account_blocks_guard_write()`（SECURITY DEFINER，放在未暴露的 `private` schema）。
- 前端可呼叫 `public.is_account_blocked()`（無參數，只查目前登入者），以及 `public.my_tavern_mute()`（只回傳自己是否被禁言、時長與到期時間，不含管理員 ID 或內部原因）。
- 對 `help_posts` / `help_options` / `help_comments` / `help_votes` / `help_comment_cheers` / `help_post_follows` / `help_reports` 的寫入政策加上封鎖檢查，並加 trigger。
- 管理員刪帖沒有另做 RPC，沿用已存在的 `help_posts_delete_admin` 政策。

## 營運尚須完成的步驟

### 1) 套用 migration

在正式專案 SQL Editor 依序執行 `supabase/migrations/` 內尚未套用的 SQL（封鎖相關、以及管理員刪留言政策）。

### 2) 加入管理員白名單

`help_admins` 目前是 0 行。Daniel 需先用 Google 登入一次（App 或這個後台皆可），再到 Dashboard → Authentication → Users 複製 UUID，執行 `docs/ops-whitelist.sql`（把 placeholder uid 換成真實 uid）：

```sql
INSERT INTO public.help_admins (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000000', 'Daniel Tam')
ON CONFLICT (user_id) DO NOTHING;
```

### 3) 把 Auth redirect URL 加入 allowlist

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs，加入：

```
http://localhost:5173/
http://localhost:5173/**
http://127.0.0.1:5173/
http://127.0.0.1:5173/**
https://retro-decision.github.io/retro-admin
https://retro-decision.github.io/retro-admin/
https://retro-decision.github.io/retro-admin/**
```

Site URL 可維持現有設定（手機 App 用）。若 Google Cloud 的 OAuth client 已有 `https://hrqxdfwuucrknqznrpse.supabase.co/auth/v1/callback`，通常不必再改。

### 4) GitHub Pages

組織目前是 GitHub Free。Private repo 的 Pages 需要付費方案，所以這個 repo 用 **public**（前端只有本來就公開的 anon key，沒有 service role）。非管理員即使打開網站也看不到資料。

目前以 `gh-pages` 分支作為 Pages 來源（Settings → Pages → Deploy from a branch → `gh-pages` / root）。更新網站時在本機執行：

```bash
npm run build
cp dist/index.html dist/404.html
# 將 dist/ 內容推到 gh-pages 分支
```

若要改為每次 push `main` 自動部署，把 `docs/github-workflows/deploy-pages.yml` 複製到 `.github/workflows/deploy-pages.yml`（需要有 `workflow` scope 的 GitHub token 才能推這個路徑），然後在 Settings → Pages 將 Source 改為 GitHub Actions。

### 5) Sign in with Apple（v1 暫緩）

v1 只做 Google 網頁登入。若要加 Apple 網頁登入，需要額外的 Apple Developer 設定，包括：

- 建立 Web Services ID
- Return URL 設為 `https://hrqxdfwuucrknqznrpse.supabase.co/auth/v1/callback`
- 在 Supabase Auth Apple provider 填入 Services ID 與密鑰

手機 App 既有的 iOS Sign in with Apple 不受影響。

## 手機 App 提示

被禁言的用戶在命運酒館動態牆會看到持續橫幅，寫明禁言天數與解除時間（永久則寫明永久禁言），並列出暫時無法發帖、留言、投票、乾杯、追蹤或檢舉。嘗試這些動作時，也不再顯示泛用的「連線異常」而改為同一則清楚提示。對方仍可瀏覽帖文。實作在 `pcjai94/retro` 的 `helpApi.ts`（`my_tavern_mute()`、`account_blocked` 錯誤對應）。

## 安全備註

- 管理員寫入（標已處理、刪帖、刪留言、封鎖／解鎖）必須在 `is_admin()` 為 true 時才會成功；非管理員在資料庫層會失敗，不只是前端隱藏按鈕。
- `help_reports` 的 SELECT 政策本來就允許檢舉人看自己的列。前端會先確認 `is_admin()` 才載入列表，避免把一般用戶自己的檢舉當成管理資料顯示。
