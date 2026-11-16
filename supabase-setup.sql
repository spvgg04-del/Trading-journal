-- Prime Journal – einmalig im Supabase SQL Editor ausführen (New query → einfügen → Run)

-- 1) Tabelle für alle Journal-Daten (Trades, Playbooks, Notizen, Einstellungen, News)
create table if not exists public.docs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col        text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);

-- 2) Nur du siehst und änderst deine eigenen Daten
alter table public.docs enable row level security;

drop policy if exists "docs_select_own" on public.docs;
drop policy if exists "docs_insert_own" on public.docs;
drop policy if exists "docs_update_own" on public.docs;
drop policy if exists "docs_delete_own" on public.docs;

create policy "docs_select_own" on public.docs for select to authenticated using (auth.uid() = user_id);
create policy "docs_insert_own" on public.docs for insert to authenticated with check (auth.uid() = user_id);
create policy "docs_update_own" on public.docs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "docs_delete_own" on public.docs for delete to authenticated using (auth.uid() = user_id);

-- 3) Privater Speicher für Chart-Screenshots
insert into storage.buckets (id, name, public)
values ('shots', 'shots', false)
on conflict (id) do nothing;

drop policy if exists "shots_select_own" on storage.objects;
drop policy if exists "shots_insert_own" on storage.objects;
drop policy if exists "shots_delete_own" on storage.objects;

create policy "shots_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
