-- Схема для общего сервера персонажей. Выполнить один раз: Supabase → SQL Editor → New query → Run.
-- Повторный запуск безопасен.

-- ---------- таблицы ----------
create table if not exists public.characters (
  id         text primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  name       text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint characters_data_size check (octet_length(data::text) < 100000),
  constraint characters_name_len  check (char_length(name) between 1 and 80)
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- ---------- права на строки (RLS) ----------
alter table public.characters enable row level security;
alter table public.admins     enable row level security;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select using (user_id = auth.uid());

-- смотреть может любой, у кого есть ссылка (в том числе без входа)
drop policy if exists characters_read on public.characters;
create policy characters_read on public.characters for select using (true);

-- создавать: только вошедший, только на себя, не больше 5 персонажей на игрока (админ без лимита)
drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (public.is_admin() or (select count(*) from public.characters c where c.owner_id = auth.uid()) < 5)
  );

-- менять и удалять: владелец или админ; владельца подменить нельзя
drop policy if exists characters_update on public.characters;
create policy characters_update on public.characters for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists characters_delete on public.characters;
create policy characters_delete on public.characters for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- ---------- хранилище артов ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arts', 'arts', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- смотреть арты может любой; загружать — только в свою папку <user id>/…; удалять — свои (или админ)
drop policy if exists arts_read on storage.objects;
create policy arts_read on storage.objects for select using (bucket_id = 'arts');

drop policy if exists arts_insert on storage.objects;
create policy arts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'arts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists arts_delete on storage.objects;
create policy arts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'arts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- сделать себя администратором ----------
-- 1) один раз войди на сайт через Discord;
-- 2) Supabase → Authentication → Users → скопируй свой UID;
-- 3) выполни (подставь UID):
--    insert into public.admins (user_id) values ('ТВОЙ-UID');
