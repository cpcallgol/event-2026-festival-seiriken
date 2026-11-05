-- 紅華祭 整理券アプリ Supabase版 DB定義 v12：運営画面のログインをなくす
-- 011_contest.sql を実行したあとに、SQL Editor に全文を貼り付けて1回だけ実行します。
-- 運営用の関数（public.admin_*）を、ログインしていない人（anon）も呼べるようにする。
-- 運営画面のURLを知らなくても、公開鍵を使えばだれでも運営の操作ができるようになる（承知のうえでの設定）。
-- 表を直接読み書きできないこと、private の関数を呼べないこと、受付済みの取消に7桁の取消用パスワードが要ることは変わらない。
-- 何度実行しても同じ結果になります。データは変更しません。
-- 001〜011 のどれかを実行し直したときは、そのあとでこのファイルも実行し直してください（運営用の関数が、またログインが必要な状態に戻るため）。

create or replace function private.require_staff() returns void
language plpgsql stable set search_path = '' as $$
begin
end $$;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('grant execute on function %s to anon', f);
  end loop;
end $$;
